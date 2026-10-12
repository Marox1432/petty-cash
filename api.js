/* The Petty Cash app's connection to the Apps Script door, plus on-device storage of the link and PIN.
   Browser: PC.createApi / PC.ApiError. Node tests: require('./api.js'). */
(function (root, factory) {
  var isNode = typeof module === 'object' && module.exports;
  var api = factory(isNode ? require('./logic.js') : root.PC.logic, root);
  if (isNode) { module.exports = api; }
  else { root.PC = root.PC || {}; root.PC.createApi = api.createApi; root.PC.ApiError = api.ApiError; }
})(typeof self !== 'undefined' ? self : this, function (logic, root) {
  'use strict';

  var KEY_LINK = 'pc.s', KEY_PIN = 'pc.pin', KEY_SNAP = 'pc.snap', DEFAULT_TIMEOUT_MS = 30000;

  /** Codes: the server's (NOT_SETUP BAD_PIN LOCKED BAD_REQUEST SERVER) plus NO_LINK NO_PIN NETWORK TIMEOUT BAD_RESPONSE. */
  function ApiError(code, message, extra) {
    var e = new Error(message);
    e.name = 'ApiError';
    e.code = code;
    if (extra) { Object.keys(extra).forEach(function (k) { e[k] = extra[k]; }); }
    Object.setPrototypeOf(e, ApiError.prototype);
    return e;
  }
  ApiError.prototype = Object.create(Error.prototype, { constructor: { value: ApiError } });

  function createApi(opts) {
    opts = opts || {};
    var fetchFn = opts.fetchFn || function (u, o) { return root.fetch(u, o); };
    var storage = opts.storage;
    var mem = {};
    var storageOk = true;
    var timing = null;

    try {                                                  // can this browser keep anything between visits?
      storage.setItem('pc.probe', '1'); storage.removeItem('pc.probe');
    } catch (e) { storageOk = false; }

    function read(k) {
      if (Object.prototype.hasOwnProperty.call(mem, k)) { return mem[k]; }
      if (!storageOk) { return null; }
      try { return storage.getItem(k); } catch (e) { storageOk = false; return null; }
    }
    function write(k, v) {
      mem[k] = v;
      if (!storageOk) { return; }
      try { storage.setItem(k, v); } catch (e) { storageOk = false; }
    }
    function erase(k) {
      delete mem[k];
      try { storage.removeItem(k); } catch (e) { /* nothing to remove from */ }
    }

    function adoptId(id) { if (!id) { return false; } write(KEY_LINK, id); return true; }

    function call(action, data, o) {
      o = o || {};
      var id = read(KEY_LINK);
      if (!id) { return Promise.reject(new ApiError('NO_LINK', 'This device is not set up yet.')); }
      var pin = o.pin !== undefined ? o.pin : read(KEY_PIN);
      if (!pin) { return Promise.reject(new ApiError('NO_PIN', 'Enter your PIN.')); }

      var t0 = Date.now();
      var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
      var timer;
      var timeout = new Promise(function (_, reject) {
        timer = setTimeout(function () {
          if (ctrl) { ctrl.abort(); }
          reject(new ApiError('TIMEOUT', 'No answer from the server.'));
        }, o.timeoutMs || DEFAULT_TIMEOUT_MS);
      });
      var request = Promise.resolve().then(function () {
        return fetchFn(logic.endpointUrl(id), {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },   // a "simple" request: no CORS preflight
          credentials: 'omit',
          redirect: 'follow',
          body: JSON.stringify({ pin: pin, action: action, data: data === undefined ? null : data }),
          signal: ctrl ? ctrl.signal : undefined
        });
      }).then(function (res) {
        return Promise.resolve(res.text()).then(function (text) {
          var body;
          try { body = JSON.parse(text); } catch (e) {
            throw new ApiError('BAD_RESPONSE', 'Unexpected reply from Google (HTTP ' + res.status + ').');
          }
          if (!body || typeof body !== 'object' || typeof body.ok !== 'boolean') {
            throw new ApiError('BAD_RESPONSE', 'Unexpected reply from the server (HTTP ' + res.status + ').');
          }
          if (!body.ok) {
            throw new ApiError(body.code || 'SERVER', body.message || 'Something went wrong.',
              { retryAfterSec: body.retryAfterSec, attemptsLeft: body.attemptsLeft });
          }
          timing = { total: Date.now() - t0, server: typeof body.ms === 'number' ? body.ms : null };
          return body.data;
        });
      }, function () {
        throw new ApiError('NETWORK', 'Could not reach the server.');
      });
      return Promise.race([request, timeout]).then(
        function (v) { clearTimeout(timer); return v; },
        function (e) { clearTimeout(timer); throw e; });
    }

    return {
      adoptSetupHash: function (hash) { return adoptId(logic.parseSetupHash(hash)); },
      adoptLink: function (text) { return adoptId(logic.parseLinkText(text)); },
      hasLink: function () { return !!read(KEY_LINK); },
      hasPin: function () { return !!read(KEY_PIN); },
      setPin: function (pin) { write(KEY_PIN, String(pin)); },
      clearPin: function () { erase(KEY_PIN); },
      forget: function () { erase(KEY_LINK); erase(KEY_PIN); erase(KEY_SNAP); },
      /** Keeps the last numbers on this device so the next open can show them at once while fresh ones load. */
      saveSnapshot: function (form) { try { write(KEY_SNAP, JSON.stringify(form)); } catch (e) { /* keep going without it */ } },
      readSnapshot: function () {
        var text = read(KEY_SNAP);
        if (!text) { return null; }
        try {
          var f = JSON.parse(text);
          return (f && typeof f === 'object' && typeof f.balance === 'number' && typeof f.month === 'string') ? f : null;
        } catch (e) { return null; }
      },
      /** {total, server}: how long the last successful request took in all, and how much of that was the sheet. */
      lastTiming: function () { return timing; },
      call: call,
      get storageOk() { return storageOk; }
    };
  }

  return { createApi: createApi, ApiError: ApiError };
});
