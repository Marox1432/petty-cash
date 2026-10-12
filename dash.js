/* The Dashboard screen: the sheet's Dashboard tab for one month, drawn for a phone.
   Browser only. It needs PC.logic, and gets everything else (the connection, screen switching, the PIN screen) from the app through PC.initDash(host). */
(function () {
  'use strict';
  var PC = window.PC;
  var L = PC.logic;
  var NS = 'http://www.w3.org/2000/svg';
  var $ = function (id) { return document.getElementById(id); };
  var money = L.formatMoney;

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) { e.className = cls; }
    if (text !== undefined) { e.textContent = text; }
    return e;
  }
  function sv(name, attrs, text) {
    var e = document.createElementNS(NS, name);
    Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    if (text !== undefined) { e.textContent = text; }
    return e;
  }
  function clear(node) { while (node.firstChild) { node.removeChild(node.firstChild); } }

  PC.initDash = function (host) {
    var api = host.api;
    var st = { data: null, want: '', seq: 0, sel: -1, open: {}, pushed: false, drawn: '', chips: '' };

    /* ---------- status, loading ---------- */
    function setStatus(text, isError) { $('dashStatus').textContent = text || ''; $('dashStatus').className = 'msg' + (isError ? ' err' : ''); }
    function showBody(on) { $('dashBody').hidden = !on; }
    function showSpeed() {
      var t = api.lastTiming();
      if (!t) { return; }
      var sec = function (ms) { return (ms / 1000).toFixed(1) + ' s'; };
      $('dashSpeed').textContent = 'Last update ' + sec(t.total) + (t.server !== null ? ' · sheet ' + sec(t.server) : '');
    }
    function markMonth(name) {
      Array.prototype.forEach.call($('dashMonths').children, function (b) {
        b.setAttribute('aria-pressed', b.getAttribute('data-month') === name ? 'true' : 'false');
      });
    }

    function load(month) {
      var my = ++st.seq;
      $('dashRefresh').classList.add('spin');
      $('dashBody').classList.toggle('loading', !!st.data && !!month && month !== st.data.month);   // the old figures stay, dimmed, until the new ones arrive
      function done() { $('dashRefresh').classList.remove('spin'); $('dashBody').classList.remove('loading'); }
      return api.call('dash', { month: month }).then(function (d) {
        if (my !== st.seq) { return; }                       // a later choice has overtaken this answer
        done();
        st.data = d; st.want = d.month;
        if (d.month === host.homeMonth()) { api.saveDash(d); }   // only the current month is kept for the next quick open
        showBody(true);                                       // show first: the month row can only be scrolled into place while it is on screen
        draw(d);
        $('dashRetry').hidden = true;
        setStatus('', false);
        showSpeed();
      }, function (e) {
        if (my !== st.seq) { return; }
        done();
        if (e.code === 'BAD_PIN' || e.code === 'LOCKED' || e.code === 'NOT_SETUP') { host.pinProblem(e); return; }
        var down = e.code === 'NETWORK' || e.code === 'TIMEOUT';
        if (st.data) {                                       // the last figures are still on screen: keep them, say they may be old
          st.want = st.data.month; markMonth(st.data.month);
          $('dashRetry').hidden = true;
          setStatus(down ? 'No connection. Showing the last numbers.' : (e.message || 'Something went wrong.'), true);
        } else {
          showBody(false);
          setStatus(down ? 'No connection. Try again.' : (e.message || 'Something went wrong.'), true);
          $('dashRetry').hidden = false;
        }
      });
    }

    /* ---------- opening and leaving ---------- */
    function open() {
      st.want = ''; st.open = {}; st.sel = -1; st.data = null;
      host.show('dash');
      try { history.pushState({ pcDash: 1 }, ''); st.pushed = true; } catch (e) { st.pushed = false; }    // so the phone's back gesture comes here
      var last = api.readDash();
      if (last && last.month === host.homeMonth()) {          // quick open: the figures from last time now, fresh ones in a moment
        st.data = last; st.drawn = '';
        showBody(true); draw(last); setStatus('', false);
      } else {
        showBody(false); setStatus('Opening…', false);
      }
      $('dashRetry').hidden = true;
      return load('');
    }
    function close() { if (st.pushed) { history.back(); } else { host.show('home'); } }
    window.addEventListener('popstate', function () {
      st.pushed = false;
      if (host.isShowing()) { host.show('home'); }
    });
    function refresh() { if (host.isShowing()) { return load(st.data ? st.data.month : st.want); } }
    function reset() { st.seq++; st.data = null; st.want = ''; st.chips = ''; st.drawn = ''; clear($('dashMonths')); }

    $('dashBack').addEventListener('click', close);
    $('dashRefresh').addEventListener('click', refresh);
    $('dashRetry').addEventListener('click', function () { $('dashRetry').hidden = true; setStatus('Opening…', false); load(st.want); });
    $('dashMonths').addEventListener('click', function (ev) {
      var b = ev.target.closest('button[data-month]');
      if (!b) { return; }
      var m = b.getAttribute('data-month');
      if (st.data && m !== st.data.month) { st.sel = -1; st.open = {}; }
      st.want = m; markMonth(m);
      load(m);
    });

    /* ---------- drawing ---------- */
    function draw(d) {
      if (st.drawn !== d.month) { st.sel = -1; st.open = {}; }
      st.drawn = d.month;
      drawMonths(d);
      drawFigures(d.tiles);
      drawWeeks(d);
      drawWhere(d.where);
      drawEmployees(d);
    }

    function drawMonths(d) {
      var box = $('dashMonths'), key = d.months.join('|');
      if (st.chips !== key) {
        st.chips = key;
        clear(box);
        d.months.forEach(function (m) {
          var b = el('button', 'chip mchip', m);
          b.type = 'button'; b.setAttribute('data-month', m);
          box.appendChild(b);
        });
      }
      markMonth(d.month);
      var on = box.querySelector('[aria-pressed="true"]');
      if (on) { box.scrollLeft = Math.max(0, on.offsetLeft - (box.clientWidth - on.offsetWidth) / 2); }
    }

    function drawFigures(t) {
      var rem = $('dRemaining');
      rem.textContent = money(t.remaining);
      rem.classList.toggle('neg', t.remaining < 0);
      var pct = Math.min(100, Math.round((Number(t.usedPct) || 0) * 100));
      $('dUsedBar').setAttribute('data-pct', String(pct));
      $('dUsedBar').style.width = pct + '%';
      $('dUsedText').textContent = L.usedText(t.usedPct);
      $('dForwarded').textContent = money(t.forwarded);
      $('dReceived').textContent = money(t.received);
      $('dDisbursed').textContent = money(t.disbursed);
    }

    /* the weekly columns and the closing-balance line */
    function drawWeeks(d) {
      var weeks = d.weeks || [], svg = $('weekChart'), body = $('weekRows');
      clear(svg); clear(body);
      $('weekBlock').hidden = !weeks.length;
      $('weekEmpty').hidden = !!weeks.length;
      if (!weeks.length) { return; }

      var W = 360, H = 200, ML = 40, MR = 8, MT = 10, MB = 26, pw = W - ML - MR, ph = H - MT - MB;
      var all = [];
      weeks.forEach(function (w) { all.push(w.received, w.disbursed, w.closing); });
      var sc = L.niceScale(Math.min.apply(null, all), Math.max.apply(null, all), 4);
      var y = function (v) { return MT + ph - (v - sc.min) / (sc.max - sc.min) * ph; };
      var y0 = y(0), slot = pw / weeks.length, gw = Math.min(slot * 0.7, 44), bw = (gw - 2) / 2;

      svg.setAttribute('aria-label', 'Weekly chart for ' + d.month + ': fund received, disbursed and closing balance for ' + weeks.length +
        (weeks.length === 1 ? ' week' : ' weeks') + '. The same figures are in the table below.');
      var defs = sv('defs'), clip = sv('clipPath', { id: 'wkClip' });
      clip.appendChild(sv('rect', { x: ML, y: MT - 2, width: pw, height: y0 - MT + 2 }));    // columns stop at the baseline: only their top ends are rounded
      defs.appendChild(clip); svg.appendChild(defs);

      sc.ticks.forEach(function (t) {
        svg.appendChild(sv('line', { 'class': t === 0 ? 'zero' : 'grid', x1: ML, x2: W - MR, y1: y(t), y2: y(t) }));
        svg.appendChild(sv('text', { 'class': 'ytick', x: ML - 6, y: y(t) + 4, 'text-anchor': 'end' }, L.compactMoney(t)));
      });
      weeks.forEach(function (w, i) { svg.appendChild(sv('rect', { 'class': 'band', 'data-i': i, x: ML + i * slot, y: MT, width: slot, height: ph })); });

      var bars = sv('g', { 'clip-path': 'url(#wkClip)' });
      var pts = [];
      weeks.forEach(function (w, i) {
        var gx = ML + i * slot + (slot - gw) / 2;
        [['bar-in', w.received, gx], ['bar-out', w.disbursed, gx + bw + 2]].forEach(function (b) {
          var h = b[1] > 0 ? Math.max(2, y0 - y(b[1])) + 4 : 0;      // 4px of it sits under the clip so the base stays square
          bars.appendChild(sv('rect', { 'class': b[0], x: b[2], y: b[1] > 0 ? y0 - h + 4 : y0, width: bw, height: h, rx: 4 }));
        });
        pts.push((ML + i * slot + slot / 2).toFixed(1) + ',' + y(w.closing).toFixed(1));
      });
      svg.appendChild(bars);
      svg.appendChild(sv('polyline', { 'class': 'line-close', points: pts.join(' ') }));
      weeks.forEach(function (w, i) {
        var cx = ML + i * slot + slot / 2;
        svg.appendChild(sv('circle', { 'class': 'dot', cx: cx, cy: y(w.closing), r: 4.5 }));
        svg.appendChild(sv('text', { 'class': 'xtick', x: cx, y: H - 8, 'text-anchor': 'middle' }, L.weekShort(w.label)));
        var hit = sv('rect', { 'class': 'hit', 'data-i': i, x: ML + i * slot, y: MT, width: slot, height: ph + MB, tabindex: 0, role: 'button',
          'aria-label': w.label + ': received ' + money(w.received) + ', disbursed ' + money(w.disbursed) + ', closing balance ' + money(w.closing) });
        svg.appendChild(hit);

        var tr = el('tr');
        tr.setAttribute('data-i', i);
        tr.appendChild(el('td', 'wk-label', w.label));
        [w.received, w.disbursed, w.closing].forEach(function (v) { tr.appendChild(el('td', 'num' + (v < 0 ? ' neg' : ''), money(v))); });
        body.appendChild(tr);
      });
      selectWeek(st.sel < weeks.length ? st.sel : -1);
    }

    function selectWeek(i) {
      var weeks = (st.data && st.data.weeks) || [];
      st.sel = i;
      Array.prototype.forEach.call($('weekChart').querySelectorAll('.band'), function (b) { b.classList.toggle('on', +b.getAttribute('data-i') === i); });
      Array.prototype.forEach.call($('weekRows').children, function (tr) {
        if (+tr.getAttribute('data-i') === i) { tr.className = 'sel'; } else { tr.removeAttribute('class'); }
      });
      var w = weeks[i];
      $('weekRead').textContent = w
        ? w.label + ' · received ' + money(w.received) + ' · disbursed ' + money(w.disbursed) + ' · closing ' + money(w.closing)
        : 'Tap a week to see its figures.';
    }
    $('weekChart').addEventListener('click', function (ev) {
      var h = ev.target.closest('.hit');
      if (h) { selectWeek(+h.getAttribute('data-i')); }
    });
    $('weekChart').addEventListener('keydown', function (ev) {
      var h = ev.target.closest && ev.target.closest('.hit');
      if (h && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); selectWeek(+h.getAttribute('data-i')); }
    });
    $('weekRows').addEventListener('click', function (ev) {
      var tr = ev.target.closest('tr');
      if (tr) { selectWeek(+tr.getAttribute('data-i')); }
    });

    /* the ring: where the cash is */
    var WHERE = [['box', 'In the box now'], ['direct', 'Paid by me directly'], ['bills', 'Bills from employees'], ['withEmployees', 'Still with employees']];
    function drawWhere(w) {
      var svg = $('donut'), list = $('whereList'), R = 44, C = 2 * Math.PI * R;
      clear(svg); clear(list);
      svg.setAttribute('aria-label', 'Where the money is: ' + WHERE.map(function (p) { return p[1] + ' ' + money(w[p[0]]); }).join(', ') + '.');
      svg.appendChild(sv('circle', { 'class': 'track', cx: 60, cy: 60, r: R }));
      var arcs = L.donutArcs(WHERE.map(function (p) { return w[p[0]]; }), C, 2);
      arcs.forEach(function (a) {
        var c = sv('circle', { 'class': 'arc arc-' + a.i, 'data-i': a.i, cx: 60, cy: 60, r: R, transform: 'rotate(-90 60 60)',
          'stroke-dasharray': a.length.toFixed(3) + ' ' + (C - a.length).toFixed(3), 'stroke-dashoffset': (-(a.offset + 1)).toFixed(3) });
        c.appendChild(sv('title', {}, WHERE[a.i][1] + ': ' + money(w[WHERE[a.i][0]])));
        svg.appendChild(c);
      });
      WHERE.forEach(function (p, i) {
        var li = el('li');
        li.appendChild(el('i', 'sw sw-' + i));
        li.appendChild(el('span', 'lab', p[1]));
        li.appendChild(el('span', 'val' + (w[p[0]] < 0 ? ' neg' : ''), money(w[p[0]])));
        list.appendChild(li);
      });
      $('dAvailable').textContent = money(w.available);
    }

    /* the employees, each opening to the month's cash and bills */
    function entryList(cls, items, fallback) {
      var ul = el('ul', 'ents ' + cls);
      items.forEach(function (e) {
        var li = el('li');
        li.appendChild(el('span', 'when', L.shortDate(e.date)));
        var what = el('span', 'what', e.desc || fallback);
        if (e.mot && e.mot.toLowerCase() !== 'cash') { what.appendChild(el('span', 'mot', ' · ' + e.mot)); }
        li.appendChild(what);
        li.appendChild(el('span', 'amt', money(e.amount)));
        ul.appendChild(li);
      });
      return ul;
    }
    function drawEmployees(d) {
      var list = $('empList'), emps = d.employees || [];
      clear(list);
      $('empEmpty').hidden = !!emps.length;
      if (!emps.length) { $('empEmpty').textContent = 'No cash advances or bills in ' + d.month + '. They show up here once you record one.'; }
      $('empTotals').hidden = !emps.length;
      var others = d.others || 0;
      $('empOthers').hidden = !emps.length || !others;
      $('empOthers').textContent = others + ' more name' + (others === 1 ? '' : 's') + ' had no activity this month.';
      var t = d.totals || {};
      $('empTotals').textContent = 'Cash ' + money(t.cash) + ' · Bills ' + money(t.bills) + ' · Balance ' + money(t.balance);

      emps.forEach(function (e, i) {
        var li = el('li', 'emp'), id = 'emp-d-' + i, isOpen = !!st.open[e.name];
        li.setAttribute('data-status', L.statusKind(e.status));
        var head = el('button', 'emp-head');
        head.type = 'button'; head.setAttribute('aria-expanded', isOpen ? 'true' : 'false'); head.setAttribute('aria-controls', id);
        var top = el('span', 'emp-top');
        top.appendChild(el('span', 'emp-name', e.name));
        top.appendChild(el('span', 'emp-bal' + (e.balance < 0 ? ' neg' : ''), money(e.balance)));
        head.appendChild(top);
        var status = el('span', 'emp-status');
        status.appendChild(el('i', 'st-ico'));
        status.appendChild(document.createTextNode(e.status || ''));
        head.appendChild(status);
        if (e.progress !== null && e.progress !== undefined) {
          var meter = el('span', 'emp-meter');
          meter.setAttribute('role', 'img');
          meter.setAttribute('aria-label', Math.round(e.progress * 100) + '% of the cash is supported by bills');
          var fill = el('i'); fill.style.width = Math.round(e.progress * 100) + '%';
          meter.appendChild(fill); head.appendChild(meter);
        }
        head.appendChild(el('span', 'emp-nums', 'Cash ' + money(e.cash) + ' · Bills ' + money(e.bills)));
        li.appendChild(head);

        var detail = el('div', 'emp-detail');
        detail.id = id; detail.hidden = !isOpen;
        detail.appendChild(el('h3', '', 'Cash received (' + e.cashEntries.length + ')'));
        detail.appendChild(e.cashEntries.length ? entryList('ent-cash', e.cashEntries, 'Cash advance') : el('p', 'muted small', 'No cash received this month.'));
        detail.appendChild(el('h3', '', 'Bills submitted (' + e.billEntries.length + ')'));
        detail.appendChild(e.billEntries.length ? entryList('ent-bill', e.billEntries, 'Bill') : el('p', 'muted small', 'No bills yet.'));
        li.appendChild(detail);
        head.addEventListener('click', function () {
          var now = head.getAttribute('aria-expanded') !== 'true';
          head.setAttribute('aria-expanded', now ? 'true' : 'false');
          detail.hidden = !now;
          if (now) { st.open[e.name] = true; } else { delete st.open[e.name]; }
        });
        list.appendChild(li);
      });
    }

    return { open: open, refresh: refresh, reset: reset };
  };
})();
