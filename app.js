/* Petty Cash app: screens and interaction. Uses PC.logic (pure helpers) and PC.createApi (the connection). */
(function () {
  'use strict';
  var PC = window.PC;
  var L = PC.logic;
  var $ = function (id) { return document.getElementById(id); };

  var storage = null;
  try { storage = window.localStorage; } catch (e) { storage = null; }   // blocked in some private modes
  var api = PC.createApi({ storage: storage });

  var S = { pin: '', busy: false, pinBusy: false, lockUntil: 0, lockTimer: null, form: null, screen: '', refreshing: null, shownBalance: 0, raf: 0, type: 'expense', amount: '', today: '', msgTimer: 0 };

  function show(name) {
    S.screen = name;
    ['loading', 'setup', 'pin', 'home'].forEach(function (n) { $('screen-' + n).hidden = (n !== name); });
    $('storageNote').hidden = api.storageOk;
    if (name === 'home') { fitAmt(); }            // sizes need the screen to be showing
  }
  window.addEventListener('resize', function () { if (S.screen === 'home') { fitAmt(); } });

  /* ---------- setup ---------- */
  $('linkForm').addEventListener('submit', function (ev) {
    ev.preventDefault();
    if (api.adoptLink($('linkInput').value)) {
      $('linkInput').value = ''; $('linkMsg').textContent = ''; $('linkMsg').className = 'msg';
      boot();
    } else {
      $('linkMsg').className = 'msg err';
      $('linkMsg').textContent = "That isn't a Web app URL. Paste the address that ends in /exec, or open the setup link from the sheet.";
    }
  });

  /* ---------- PIN ---------- */
  function renderDots() {
    Array.prototype.forEach.call($('pinDots').children, function (d, i) { d.className = 'dot' + (i < S.pin.length ? ' on' : ''); });
  }
  function pinMessage(text, isError) { $('pinMsg').textContent = text; $('pinMsg').className = 'msg' + (isError ? ' err' : ''); }

  function showPin(message) {
    S.pin = ''; S.pinBusy = false;
    if (S.busy) { setBusy(false); }               // a save cut short by a refused PIN: unlock the form, keep what was typed
    renderDots();
    show('pin');
    pinMessage(message || '', !!message);
  }

  function pinPress(key) {
    if (S.screen !== 'pin' || S.pinBusy || S.lockUntil > Date.now()) { return; }
    if (key === 'back') { S.pin = S.pin.slice(0, -1); }
    else if (/^[0-9]$/.test(key) && S.pin.length < 6) { S.pin += key; }
    renderDots();
    if (S.pin.length === 6) { submitPin(S.pin); }
  }
  $('pinPad').addEventListener('click', function (ev) {
    var b = ev.target.closest('button[data-key]');
    if (b) { pinPress(b.getAttribute('data-key')); }
  });
  document.addEventListener('keydown', function (ev) {
    if (S.screen !== 'pin' || ev.ctrlKey || ev.metaKey || ev.altKey) { return; }
    if (/^[0-9]$/.test(ev.key)) { pinPress(ev.key); }
    else if (ev.key === 'Backspace') { pinPress('back'); }
  });
  $('forgetPin').addEventListener('click', forget);

  function submitPin(pin) {
    S.pinBusy = true;
    pinMessage('Checking…', false);
    api.call('ping', null, { pin: pin }).then(function () {
      api.setPin(pin);
      S.pin = '';
      return loadHome().then(function () { S.pinBusy = false; });
    }).catch(function (e) { S.pinBusy = false; pinFailed(e); });
  }

  function triesText(n) { return n === 1 ? '1 try left.' : n + ' tries left.'; }

  function pinFailed(e) {
    S.pin = ''; renderDots();
    if (e.code === 'BAD_PIN') {
      api.clearPin();
      var d = $('pinDots'); d.classList.remove('shake'); void d.offsetWidth; d.classList.add('shake');
      setTimeout(function () { d.classList.remove('shake'); }, 600);
      pinMessage('Wrong PIN.' + (typeof e.attemptsLeft === 'number' ? ' ' + triesText(e.attemptsLeft) : ''), true);
    } else if (e.code === 'LOCKED') {
      startLock(e.retryAfterSec || 900);
    } else if (e.code === 'NOT_SETUP') {
      pinMessage('No PIN is set yet. In the sheet, use Petty Cash > App: set PIN.', true);
    } else if (e.code === 'NETWORK' || e.code === 'TIMEOUT') {
      pinMessage('Could not reach the server. Check your connection and try again.', true);
    } else {
      pinMessage(e.message || 'Something went wrong.', true);
    }
  }

  function startLock(sec) {
    S.lockUntil = Date.now() + sec * 1000;
    $('pinPad').classList.add('locked');
    clearInterval(S.lockTimer);
    function tick() {
      var left = Math.ceil((S.lockUntil - Date.now()) / 1000);
      if (left <= 0) {
        clearInterval(S.lockTimer);
        $('pinPad').classList.remove('locked');
        S.lockUntil = 0;
        pinMessage('', false);
        if (api.hasPin()) { loadHome(); }
        return;
      }
      pinMessage('Locked. Try again in ' + Math.floor(left / 60) + ':' + (left % 60 < 10 ? '0' : '') + (left % 60), true);
    }
    tick();
    S.lockTimer = setInterval(tick, 250);
  }

  /* ---------- home ---------- */
  var TICKS = 72, NS = 'http://www.w3.org/2000/svg';
  var ticks = [];
  function svgEl(name, attrs) {
    var e = document.createElementNS(NS, name);
    Object.keys(attrs).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    return e;
  }
  (function buildRing() {
    var svg = $('ring').querySelector('svg');
    svg.appendChild(svgEl('circle', { cx: 100, cy: 100, r: 99, 'class': 'rim' }));
    svg.appendChild(svgEl('circle', { cx: 100, cy: 100, r: 77, 'class': 'face' }));
    for (var i = 0; i < TICKS; i++) {
      var a = (i * 360 / TICKS - 90) * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
      var t = svgEl('line', { x1: 100 + 83 * c, y1: 100 + 83 * s, x2: 100 + 95 * c, y2: 100 + 95 * s, 'class': 'tick' });
      t.style.setProperty('--i', i);
      svg.appendChild(t); ticks.push(t);
    }
  })();

  function reduceMotion() { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); }

  function setRing(st) {
    var n = st.fill > 0 ? Math.max(1, Math.round(st.fill * TICKS)) : 0;
    ticks.forEach(function (t, i) { t.classList.toggle('on', i < n); });
    $('ring').setAttribute('data-level', st.level);
  }

  /** Shrinks the balance to fit the face of the coin when it is a long number (the CSS size covers the usual ones). */
  function fitAmt() {
    var el = $('balAmt'), room = el.parentNode.clientWidth;
    el.style.fontSize = '';
    var w = el.offsetWidth;
    if (room > 0 && w > room) { el.style.fontSize = (parseFloat(getComputedStyle(el).fontSize) * room / w * 0.97) + 'px'; }
  }

  function countTo(to) {
    var el = $('balAmt'), from = S.shownBalance;
    S.shownBalance = to;
    el.classList.toggle('neg', to < 0);
    cancelAnimationFrame(S.raf);
    if (reduceMotion() || from === to) { el.textContent = L.formatMoney(to); fitAmt(); return; }
    var t0 = performance.now(), dur = 900;
    (function step(now) {
      var k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3);
      el.textContent = L.formatMoney(k < 1 ? from + (to - from) * e : to);
      fitAmt();
      if (k < 1) { S.raf = requestAnimationFrame(step); }
    })(t0);
  }

  function setBar(barId, valId, value, max) {
    var pct = max > 0 ? Math.round(value / max * 100) : 0;
    $(barId).setAttribute('data-pct', String(pct));
    $(barId).style.width = pct + '%';
    $(valId).textContent = L.formatMoney(value);
  }

  var SIGN = { receipt: '+', expense: '−', advance: '−', bill: '' };
  function renderRecent(list) {
    var ul = $('recent');
    ul.textContent = '';
    (list || []).forEach(function (r) {
      var li = document.createElement('li');
      li.setAttribute('data-kind', r.kind);
      var when = document.createElement('span'); when.className = 'when'; when.textContent = L.shortDate(r.date);
      var what = document.createElement('span'); what.className = 'what'; what.textContent = r.text || '';
      var amt = document.createElement('span');
      amt.className = 'amt' + (r.kind === 'receipt' ? ' in' : (r.kind === 'bill' ? ' memo' : ''));
      amt.textContent = (SIGN[r.kind] || '') + L.formatMoney(r.amount);
      if (r.kind === 'bill') { amt.title = 'Handed in against an advance, so it is not deducted again'; }
      li.appendChild(when); li.appendChild(what); li.appendChild(amt);
      ul.appendChild(li);
    });
    $('recentEmpty').hidden = !!(list && list.length);
  }

  /** Draws the whole home screen from a form snapshot. */
  function renderHome(f) {
    setRing(L.ringState(f.balance, f.totalAvailable));
    countTo(f.balance);
    $('month').textContent = f.month;
    $('ring').setAttribute('aria-label', 'Remaining ' + L.formatMoney(f.balance) + ' in ' + f.month);
    var tot = f.monthTotals || { received: 0, spent: 0 }, max = Math.max(tot.received, tot.spent);
    setBar('barReceived', 'valReceived', tot.received, max);
    setBar('barSpent', 'valSpent', tot.spent, max);
    renderRecent(f.recent);
    fillForm(f);
    if (f.sheetUrl) { $('openSheet').href = f.sheetUrl; $('openSheet').hidden = false; }
  }

  /** A small line under the numbers: how long the last update took, and how much of it was the sheet. */
  function showSpeed() {
    var t = api.lastTiming();
    if (!t) { return; }
    var sec = function (ms) { return (ms / 1000).toFixed(1) + ' s'; };
    $('speed').textContent = 'Last update ' + sec(t.total) + (t.server !== null ? ' \u00b7 sheet ' + sec(t.server) : '');
  }

  /** A fresh snapshot arrived: remember it on the device (for the next quick open) and note the timing. */
  function gotForm(form) {
    S.form = form;
    api.saveSnapshot(form);
    showSpeed();
  }

  function setStatus(text, isError) { $('homeStatus').textContent = text || ''; $('homeStatus').className = 'msg' + (isError ? ' err' : ''); }

  /** Loads the form snapshot with the saved PIN. Success shows home; a refused PIN goes back to the PIN screen. */
  function loadHome() {
    return api.call('form').then(function (form) {
      $('refreshBtn').classList.remove('spin');
      gotForm(form);
      $('retryBtn').hidden = true;
      $('homeBody').hidden = false;
      setStatus('', false);
      renderHome(form);
      show('home');
    }).catch(function (e) {
      $('refreshBtn').classList.remove('spin');
      if (e.code === 'BAD_PIN' || e.code === 'LOCKED' || e.code === 'NOT_SETUP') {
        showPin();
        pinFailed(e);
      } else {
        var down = e.code === 'NETWORK' || e.code === 'TIMEOUT';
        show('home');
        if (S.form) {                                // the last numbers are on screen: keep them, say they may be old
          $('retryBtn').hidden = true;
          setStatus(down ? 'No connection. Showing the last numbers.' : (e.message || 'Something went wrong.'), true);
        } else {
          $('homeBody').hidden = true;               // nothing to show or save into until the numbers arrive
          setStatus(down ? 'No connection. Try again.' : (e.message || 'Something went wrong.'), true);
          $('retryBtn').hidden = false;
        }
      }
    });
  }
  $('retryBtn').addEventListener('click', function () { $('retryBtn').hidden = true; setStatus('Opening…', false); loadHome(); });

  /** Reloads the numbers in place. Used when the app comes back into view, on the refresh button and on pull-down. */
  function refresh() {
    if (S.refreshing) { return S.refreshing; }
    $('refreshBtn').classList.add('spin');
    S.refreshing = api.call('form').then(function (form) {
      gotForm(form);
      $('retryBtn').hidden = true;
      $('homeBody').hidden = false;                // the first load may have failed: this is the way back in
      setStatus('', false);
      renderHome(form);
    }).catch(function (e) {
      if (e.code === 'BAD_PIN' || e.code === 'LOCKED' || e.code === 'NOT_SETUP') { showPin(); pinFailed(e); }
      else if (e.code === 'NETWORK' || e.code === 'TIMEOUT') { setStatus(S.form ? 'No connection. Showing the last numbers.' : 'No connection. Try again.', true); }
      else { setStatus(e.message || 'Something went wrong.', true); }
    }).then(function () { S.refreshing = null; $('refreshBtn').classList.remove('spin'); });
    return S.refreshing;
  }
  $('refreshBtn').addEventListener('click', refresh);
  document.addEventListener('visibilitychange', function () { if (!document.hidden && S.screen === 'home') { refresh(); } });
  window.addEventListener('online', function () { if (S.screen === 'home') { refresh(); } });

  // pull down from the top of the page to refresh
  var pull = { y0: null, dy: 0 };
  document.addEventListener('touchstart', function (e) {
    pull.dy = 0;
    pull.y0 = (S.screen === 'home' && window.scrollY <= 0 && e.touches.length === 1) ? e.touches[0].clientY : null;
  }, { passive: true });
  document.addEventListener('touchmove', function (e) {
    if (pull.y0 !== null && e.touches.length) { pull.dy = e.touches[0].clientY - pull.y0; }
  }, { passive: true });
  document.addEventListener('touchend', function () {
    if (pull.y0 !== null && pull.dy > 70) { refresh(); }
    pull.y0 = null; pull.dy = 0;
  });

  /* ---------- the entry form ---------- */
  var HINTS = {
    receipt: 'Money you received from your boss into the petty cash box. Adds to the balance.',
    expense: 'A bill you handled and paid yourself from the box. Deducted from the balance.',
    advance: 'Cash you handed to an employee. Deducted from the box now; they support it later with bills.',
    bill: 'A receipt an employee handed in. It offsets their cash advance and does not reduce the box again.'
  };
  var LABELS = { receipt: 'Fund received', expense: 'Expense', advance: 'Cash advance', bill: 'Bill submitted' };
  var SAVE_TEXT = { receipt: 'Save fund received', expense: 'Save expense', advance: 'Save cash advance', bill: 'Save bill' };

  function setType(t) {
    S.type = t;
    $('entry').setAttribute('data-type', t);
    Array.prototype.forEach.call($('types').children, function (b) { b.classList.toggle('on', b.getAttribute('data-type') === t); });
    $('hint').textContent = HINTS[t];
    $('rowEmp').hidden = (t === 'receipt');
    $('rowDesc').hidden = (t === 'receipt');
    $('rowRemarks').hidden = (t !== 'receipt');
    var empReq = (t === 'advance' || t === 'bill');
    $('lblEmp').innerHTML = (t === 'expense' ? 'Care of (optional)' : 'Employee <span class="req">*</span>');
    $('emp').placeholder = empReq ? 'Choose or type a name' : 'Whose card / who asked for it (optional)';
    if (t === 'advance') { $('lblDesc').textContent = 'Note (optional)'; $('desc').placeholder = 'e.g. Site visit allowance'; }
    else if (t === 'bill') { $('lblDesc').innerHTML = 'What the bill is for <span class="req">*</span>'; $('desc').placeholder = 'e.g. Petrol + meal'; }
    else { $('lblDesc').innerHTML = 'Description <span class="req">*</span>'; $('desc').placeholder = 'e.g. Petrol, Supplies, Water'; }
    $('save').textContent = SAVE_TEXT[t];
    checkOverdraw();
    if ($('msg').classList.contains('err')) { showMsg('', ''); }
  }
  $('types').addEventListener('click', function (ev) {
    var b = ev.target.closest('button[data-type]');
    if (b && !S.busy) { setType(b.getAttribute('data-type')); }
  });

  function checkOverdraw() {
    var f = S.form;
    var hint = f ? L.overdrawHint({ type: S.type, amount: S.amount, date: $('date').value, month: f.month, balance: f.balance }) : '';
    $('warn').textContent = hint;
    $('warn').hidden = !hint;
  }
  $('date').addEventListener('change', checkOverdraw);

  function renderAmount() {
    var el = $('amountDisplay');
    el.setAttribute('data-value', S.amount);
    el.textContent = S.amount === '' ? '0.00' : S.amount;
    el.classList.toggle('empty', S.amount === '');
    checkOverdraw();
  }
  function pressAmount(key) { if (S.busy) { return; } S.amount = L.keypadPress(S.amount, key); renderAmount(); }
  $('keypad').addEventListener('mousedown', function (ev) { ev.preventDefault(); });   // keep focus where it was, so Enter never re-presses a key
  $('keypad').addEventListener('click', function (ev) {
    var b = ev.target.closest('button[data-key]');
    if (b) { pressAmount(b.getAttribute('data-key')); }
  });
  document.addEventListener('keydown', function (ev) {
    if (S.screen !== 'home' || ev.ctrlKey || ev.metaKey || ev.altKey) { return; }
    var tag = (document.activeElement && document.activeElement.tagName) || '';
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') { return; }   // typing in a field never changes the amount
    var k = L.keyFromEvent(ev.key);
    if (k) { ev.preventDefault(); pressAmount(k); }
  });

  function fillChips(id, values, target) {
    var box = $(id);
    box.textContent = '';
    values.forEach(function (v) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'chip'; b.textContent = v;
      b.addEventListener('click', function () { if (!S.busy) { $(target).value = v; } });
      box.appendChild(b);
    });
  }

  /** Brings the form's lists and date in line with a fresh snapshot, without touching what was typed. */
  function fillForm(f) {
    var sel = $('mot'), keep = sel.value;
    sel.textContent = '';
    (f.mot || []).forEach(function (m) { var o = document.createElement('option'); o.value = m; o.textContent = m; sel.appendChild(o); });
    if (keep && (f.mot || []).indexOf(keep) >= 0) { sel.value = keep; }
    fillChips('chipsDesc', (f.descriptions || []).slice(0, 8), 'desc');
    fillChips('chipsEmp', f.employees || [], 'emp');
    // the date follows the day, unless it was changed by hand
    if (!S.today || $('date').value === S.today || !$('date').value) { $('date').value = f.today; }
    S.today = f.today;
    checkOverdraw();
  }

  function showMsg(textValue, kind) {
    var m = $('msg');
    clearTimeout(S.msgTimer);
    m.className = 'msg' + (kind ? ' ' + kind : '');
    m.textContent = textValue;
    if (kind === 'ok') { S.msgTimer = setTimeout(function () { if (m.classList.contains('ok')) { m.className = 'msg'; m.textContent = ''; } }, 7000); }
  }

  function coinDrop() {
    if (reduceMotion()) { return; }
    var d = document.createElement('div');
    d.className = 'coin-drop';
    $('ring').appendChild(d);
    var gone = function () { if (d.parentNode) { d.parentNode.removeChild(d); } };
    d.addEventListener('animationend', gone);
    setTimeout(gone, 1600);
  }

  /** Locks or unlocks the form around a save, so nothing typed meanwhile is lost or mixed into the entry that was sent. */
  function setBusy(on) {
    S.busy = on;
    $('save').disabled = on;
    $('save').textContent = on ? 'Saving\u2026' : SAVE_TEXT[S.type];
    $('entry').classList.toggle('busy', on);
    ['date', 'emp', 'desc', 'remarks'].forEach(function (id) { $(id).readOnly = on; });
    $('mot').disabled = on;
  }

  function saved(data, payload, amount) {
    var res = data.result || {};
    S.amount = ''; renderAmount();
    $('desc').value = ''; $('remarks').value = '';
    if (payload.type === 'expense') { $('emp').value = ''; }
    var m = $('msg');
    showMsg('Saved: ' + LABELS[payload.type] + ' ' + L.formatMoney(amount) + ' → ' + (res.sheetName || '') + '.', 'ok');
    if (res.employee) {
      var sub = document.createElement('span');
      sub.className = 'sub';
      sub.textContent = res.employee.name + ' — received ' + L.formatMoney(res.employee.received) +
        ' · bills ' + L.formatMoney(res.employee.bills) + ' · balance ' + L.formatMoney(res.employee.balance);
      m.appendChild(sub);
    }
    if (data.form) { gotForm(data.form); renderHome(data.form); }
    else { refresh(); }                       // saved, but no snapshot came back: fetch it (never resend the entry)
    coinDrop();
    if (navigator.vibrate) { try { navigator.vibrate(20); } catch (e) { /* not supported */ } }
    if ($('ring').getBoundingClientRect().top < 0) { window.scrollTo({ top: 0, behavior: reduceMotion() ? 'auto' : 'smooth' }); }
  }

  function saveFailed(e) {
    if (e.code === 'BAD_PIN' || e.code === 'LOCKED' || e.code === 'NOT_SETUP') { showPin(); pinFailed(e); return; }
    if (e.code === 'TIMEOUT' || e.code === 'NETWORK') {
      // the request may have reached the sheet: never retry by itself, and point at the list that shows the truth
      showMsg((e.code === 'TIMEOUT' ? 'No answer yet.' : 'The connection dropped.') +
        ' It may have been saved. Check Recent entries before saving again.', 'err');
      refresh();
      return;
    }
    showMsg(e.message || 'Something went wrong.', 'err');
  }

  $('entry').addEventListener('submit', function (ev) {
    ev.preventDefault();
    if (S.busy) { return; }
    var amount = S.amount.replace(/\.$/, '');
    if (!(Number(amount) > 0)) { showMsg('Enter an amount greater than zero.', 'err'); return; }
    if (navigator.onLine === false) { showMsg('No connection. Connect and try again; nothing was sent.', 'err'); return; }
    var payload = L.buildPayload({ type: S.type, date: $('date').value, amount: amount, mot: $('mot').value,
      description: $('desc').value, emp: $('emp').value, remarks: $('remarks').value });
    setBusy(true);
    showMsg('', '');
    api.call('add', payload, { timeoutMs: window.PC_TEST_TIMEOUT_MS || undefined }).then(function (data) {
      setBusy(false);
      saved(data, payload, Number(amount));
    }, function (e) {
      setBusy(false);
      saveFailed(e);
    });
  });
  setType('expense');

  function forget() {
    api.forget(); S.form = null; S.pin = '';
    clearInterval(S.lockTimer); S.lockUntil = 0; $('pinPad').classList.remove('locked');
    show('setup');
  }
  $('forget').addEventListener('click', forget);

  /* ---------- start ---------- */
  function boot() {
    if (location.hash) {
      api.adoptSetupHash(location.hash);
      try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* ignore */ }
    }
    if (!api.hasLink()) { show('setup'); return; }
    if (!api.hasPin()) { showPin(); return; }
    var last = api.readSnapshot();
    if (last) {                                  // quick open: the numbers from last time now, fresh ones in a moment
      S.form = last;
      $('retryBtn').hidden = true;
      $('homeBody').hidden = false;
      renderHome(last);
      show('home');
      $('refreshBtn').classList.add('spin');     // the refresh button turns while the new numbers load
    } else {
      show('loading');
    }
    loadHome();
  }
  PC.app = { refresh: refresh };
  window.addEventListener('hashchange', function () { if (location.hash) { boot(); } });
  // keep the app shell on the device (opens instantly and offline); a failure here only means no offline start
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () { /* not available in this browser */ }); });
  }
  boot();
})();
