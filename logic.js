/* Pure helpers for the Petty Cash app. No DOM, no network: the browser uses them as PC.logic, Node tests require() them. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) { module.exports = api; }
  else { root.PC = root.PC || {}; root.PC.logic = api; }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function txt(v) { return v === undefined || v === null ? '' : String(v); }

  /** The amount being typed, as a string. keys: '0'..'9', '.', 'back', 'clear'. Anything else changes nothing. */
  function keypadPress(cur, key) {
    cur = txt(cur);
    if (key === 'clear') { return ''; }
    if (key === 'back') { return cur.slice(0, -1); }
    if (key === '.') {
      if (cur.indexOf('.') >= 0) { return cur; }
      return cur === '' ? '0.' : cur + '.';
    }
    if (typeof key === 'string' && /^[0-9]$/.test(key)) {
      var dot = cur.indexOf('.');
      if (dot >= 0) { return cur.length - dot - 1 >= 2 ? cur : cur + key; }   // two decimals at most
      if (cur === '0') { return key; }                                       // no leading zeros
      if (cur.length >= 7) { return cur; }                                   // seven integer digits at most
      return cur + key;
    }
    return cur;
  }

  /** A physical keyboard key (KeyboardEvent.key) as a keypad key, or null when it is not one we use. */
  function keyFromEvent(key) {
    if (typeof key !== 'string') { return null; }
    if (/^[0-9]$/.test(key)) { return key; }
    if (key === '.' || key === ',') { return '.'; }
    if (key === 'Backspace') { return 'back'; }
    if (key === 'Escape') { return 'clear'; }
    return null;
  }

  /** How full the cash-box ring is and what colour level it shows. */
  function ringState(remaining, total) {
    if (!isFinite(total) || total <= 0 || !isFinite(remaining)) { return { fill: 1, level: 'ok' }; }
    if (remaining < 0) { return { fill: 0, level: 'neg' }; }
    var ratio = remaining / total;
    return { fill: Math.min(1, ratio), level: ratio > 0.4 ? 'ok' : (ratio >= 0.15 ? 'low' : 'crit') };
  }

  /** The deployment id from a setup link's hash ("#s=<id>"), or null. */
  function parseSetupHash(hash) {
    var m = /^#s=([A-Za-z0-9_-]{20,})$/.exec(typeof hash === 'string' ? hash : '');
    return m ? m[1] : null;
  }

  /** The deployment id from whatever the user pasted: the Web app URL (.../exec) or the setup link (...#s=<id>). */
  function parseLinkText(text) {
    var t = txt(text).trim();
    var m = /^https:\/\/script\.google\.com\/macros\/s\/([A-Za-z0-9_-]{20,})\/exec\/?$/.exec(t);
    if (m) { return m[1]; }
    var i = t.indexOf('#');
    return i >= 0 ? parseSetupHash(t.slice(i)) : null;
  }

  function endpointUrl(id) { return 'https://script.google.com/macros/s/' + id + '/exec'; }

  /** The exact seven fields the server's add action expects. */
  function buildPayload(s) {
    var receipt = s.type === 'receipt';
    return {
      type: s.type, date: s.date, amount: s.amount, mot: txt(s.mot),
      description: receipt ? '' : txt(s.description),
      emp: receipt ? '' : txt(s.emp),
      remarks: receipt ? txt(s.remarks) : ''
    };
  }

  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  /** '2026-10-09' -> '9 Oct'; anything unreadable -> ''. */
  function shortDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(txt(iso));
    if (!m || +m[2] < 1 || +m[2] > 12) { return ''; }
    return (+m[3]) + ' ' + MON[+m[2] - 1];
  }

  /** '2026-10-05' -> 'Oct 2026'; unreadable -> ''. */
  function monthOf(iso) {
    var m = /^(\d{4})-(\d{2})-\d{2}$/.exec(txt(iso));
    return m && +m[2] >= 1 && +m[2] <= 12 ? MON[+m[2] - 1] + ' ' + m[1] : '';
  }

  /** The heads-up shown when an expense or cash advance in the displayed month would take the balance below zero; '' otherwise. */
  function overdrawHint(s) {
    var amt = Number(txt(s.amount).replace(/[,\s]/g, ''));
    var deducts = s.type === 'expense' || s.type === 'advance';
    if (!deducts || txt(s.amount).trim() === '' || !isFinite(amt) || amt <= 0) { return ''; }
    if (!monthOf(s.date) || monthOf(s.date) !== s.month || !(amt > s.balance)) { return ''; }
    return 'Heads-up: this takes the ' + s.month + ' balance below zero (' + formatMoney(s.balance - amt) + '). You can still save it.';
  }

  function formatMoney(n) {
    var v = Number(n);
    if (!isFinite(v) || v === 0) { v = 0; }
    return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  /** Round axis values from min to max that always include zero: {min, max, step, ticks}. `want` is the number of intervals aimed for. */
  function niceScale(minv, maxv, want) {
    want = want > 0 ? want : 4;
    var lo = Math.min(0, isFinite(minv) ? minv : 0), hi = Math.max(0, isFinite(maxv) ? maxv : 0);
    var range = hi - lo;
    if (!(range > 0)) { return { min: 0, max: 1, step: 1, ticks: [0, 1] }; }
    var raw = range / want, mag = Math.pow(10, Math.floor(Math.log10(raw))), step = mag * 10;
    [1, 2, 2.5, 5, 10].some(function (m) { if (m * mag >= raw - 1e-12) { step = m * mag; return true; } return false; });
    var nmin = Math.floor(lo / step + 1e-9) * step, nmax = Math.ceil(hi / step - 1e-9) * step, ticks = [];
    for (var i = 0; nmin + i * step <= nmax + step / 1e6; i++) { ticks.push(Math.round((nmin + i * step) * 1e9) / 1e9); }
    return { min: ticks[0], max: ticks[ticks.length - 1], step: step, ticks: ticks };
  }

  /** Short axis labels: 0, 128, 2.5k, 12.9k, 1.25M. */
  function compactMoney(n) {
    var v = Number(n);
    if (!isFinite(v)) { return '0'; }
    var a = Math.abs(v), sign = v < 0 ? '-' : '';
    var trim = function (x) { return String(Math.round(x * 100) / 100); };
    if (a >= 1e6) { return sign + trim(a / 1e6) + 'M'; }
    if (Math.round(a) >= 1000) { return sign + trim(a / 1000) + 'k'; }
    if (a === 0) { return '0'; }
    return sign + (a >= 10 ? String(Math.round(a)) : trim(a));
  }

  /** "99% of available cash used" (the sheet's wording). */
  function usedText(p) {
    var v = Number(p);
    return Math.round((isFinite(v) ? v : 0) * 100) + '% of available cash used';
  }

  /** The sheet's employee status as a short key: settled, due, owed or none. */
  function statusKind(status) {
    return { 'Fully liquidated': 'settled', 'Bills still due': 'due', 'Owed to employee': 'owed' }[txt(status)] || 'none';
  }

  /** "Week 2 (05-11 Oct)" -> "W2"; anything else -> its first six characters. */
  function weekShort(label) {
    var m = /^Week (\d+)/.exec(txt(label));
    return m ? 'W' + m[1] : txt(label).slice(0, 6);
  }

  /** Where each positive amount sits on a ring of circumference `circ`: [{i, offset, length}], with `gap` between neighbours. */
  function donutArcs(values, circ, gap) {
    var pos = values.map(function (v) { var n = Number(v); return isFinite(n) && n > 0 ? n : 0; });
    var total = pos.reduce(function (a, b) { return a + b; }, 0);
    if (!(total > 0)) { return []; }
    var live = pos.filter(function (v) { return v > 0; }).length, at = 0, out = [];
    pos.forEach(function (v, i) {
      if (!(v > 0)) { return; }
      var share = v / total * circ;
      out.push({ i: i, offset: at, length: live === 1 ? circ : Math.max(0.5, share - gap) });
      at += share;
    });
    return out;
  }

  return { niceScale: niceScale, compactMoney: compactMoney, usedText: usedText, statusKind: statusKind, weekShort: weekShort, donutArcs: donutArcs,
           keypadPress: keypadPress, keyFromEvent: keyFromEvent, ringState: ringState, parseSetupHash: parseSetupHash, parseLinkText: parseLinkText,
           endpointUrl: endpointUrl, buildPayload: buildPayload, formatMoney: formatMoney, shortDate: shortDate, monthOf: monthOf, overdrawHint: overdrawHint };
});
