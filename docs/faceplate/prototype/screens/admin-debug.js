/* Diagnostics — event detail dialog, event filters, jumps between tabs, the manual sync runs with a visible result,
   the sleep-screen test and the read-only query console. */
(function () {
  var screen = document.querySelector('section.screen[data-route="admin-debug"]');
  if (!screen || !window.Proto) return;
  var q = function (s, r) { return (r || screen).querySelector(s); };
  var qa = function (s, r) { return Array.prototype.slice.call((r || screen).querySelectorAll(s)); };
  var WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var TODAY = '2026-11-09', EARLIEST = '2026-10-26';
  var dayName = function (iso) { var p = iso.split('-').map(Number); var d = new Date(Date.UTC(p[0], p[1] - 1, p[2])); return WD[d.getUTCDay()] + ', ' + MO[p[1] - 1] + ' ' + p[2]; };
  var esc = function (s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); };

  /* ---------- the coverage strip: light as many of each day's 24 lights as it has hours ---------- */
  var mx = q('.dbg-matrix');
  if (mx) {
    var hrs = []; try { hrs = JSON.parse(mx.dataset.hours || '[]'); } catch (e) {}
    qa('.heat-cell', mx).forEach(function (c, i) { c.style.setProperty('--fill', String((hrs[i] || 0) / 24)); });
  }

  /* ---------- event detail dialog ---------- */
  var dlg = q('[data-modal="admin-debug-event"]');
  var LV = { ERROR: ['badge--problem', 'Problem'], WARN: ['badge--warn', 'Heads-up'], INFO: ['badge--info', 'Info'] };
  function fill(b) {
    q('[data-ev="cat"]', dlg).textContent = b.dataset.evCat;
    q('[data-ev="title"]', dlg).textContent = b.dataset.evMsg;
    q('[data-ev="when"]', dlg).textContent = b.dataset.evWhen;
    q('[data-ev="source"]', dlg).textContent = b.dataset.evSource;
    var lv = LV[b.dataset.evLevel] || LV.INFO, badge = q('[data-ev="level"]', dlg);
    badge.className = 'badge ' + lv[0]; badge.textContent = lv[1];
    var d = b.dataset.evDetails || '', pre = q('[data-ev="details"]', dlg);
    pre.textContent = d; pre.hidden = !d; q('[data-ev="nodetails"]', dlg).hidden = !!d;
  }

  /* ---------- event filters ---------- */
  var sel = { cat: 'all', level: 'all' };
  var earlier = q('.dbg-earlier'), empty = q('[data-debug-empty]'), tl = q('.dbg-timeline'), catSel = q('select[data-debug-catsel]');
  catSel.addEventListener('change', function () { sel.cat = catSel.value; apply(); });
  function apply() {
    var shown = 0, shownEarlier = 0;
    qa('.dbg-day').forEach(function (day) {
      var n = 0;
      qa('.tl-item', day).forEach(function (it) {
        var ok = (sel.cat === 'all' || it.dataset.cat === sel.cat) && (sel.level === 'all' || it.dataset.level === sel.level);
        it.parentElement.hidden = !ok;
        if (ok) n++;
      });
      day.hidden = n === 0;
      if (earlier.contains(day)) shownEarlier += n; else shown += n;
    });
    var any = shown + shownEarlier > 0;
    empty.hidden = any; tl.hidden = !any;
    earlier.hidden = shownEarlier === 0;
    q('.when-closed', earlier).textContent = 'Show ' + shownEarlier + ' earlier';
    if (!shown && shownEarlier) earlier.open = true;
  }

  function scrollToEl(el) {
    var y = el.getBoundingClientRect().top + window.scrollY - 72;
    window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
  }
  function goto(tab, o) {
    o = o || {};
    Proto.selectTab('admin-debug-tab', tab);
    if (tab === 'events') {
      sel.level = o.level || 'all'; sel.cat = o.cat || 'all';
      Proto.selectTab('admin-debug-level', sel.level); catSel.value = sel.cat;
      apply();
    }
    scrollToEl(q('.dbg-tabs'));
  }

  /* ---------- manual runs ---------- */
  var results = q('[data-debug-results]'), resultsEmpty = q('[data-debug-results-empty]');
  var from = q('[data-debug-from]'), to = q('[data-debug-to]'), runBtn = q('[data-debug-run]');
  var err = q('[data-debug-range-error]');
  function current(group) { var b = q('[data-tabs="' + group + '"] .is-active'); return b ? b.dataset.tab : ''; }
  function rangeError() {
    if (current('admin-debug-days') !== 'custom') return '';
    var a = from.value, b = to.value;
    if (!a || !b) return 'Choose start and end dates.';
    if (a > b) return 'Start date must be on or before end date.';
    if (b > TODAY) return "End date can't be in the future.";
    if (a < EARLIEST) return 'Start date is more than 14 days ago. CoServ keeps about two weeks.';
    return '';
  }
  function validate() {
    var m = rangeError();
    err.hidden = !m; q('span', err).textContent = m;
    runBtn.disabled = !!m;
    return !m;
  }
  function rowHtml(lamp, title, meta) {
    return '<div class="row row--compact"><span class="row-lead row-lead--lamp"><span class="lamp lamp--' + lamp + '"></span></span>' +
      '<span class="row-main"><span class="row-title row-title--regular">' + esc(title) + '</span><span class="row-meta">' + meta + '</span></span></div>';
  }
  function addRun(start, done, doneLamp, btn) {
    var li = document.createElement('li');
    li.innerHTML = rowHtml('info', start, '<span class="mono">5:00 PM</span> · running in the background');
    results.insertBefore(li, results.firstChild);
    results.hidden = false; resultsEmpty.hidden = true;
    if (btn) { btn.disabled = true; }
    setTimeout(function () {
      li.innerHTML = rowHtml(doneLamp, done, '<span class="mono">5:00 PM</span> · details in Events');
      if (btn) { btn.disabled = false; validate(); }
    }, 1500);
  }
  function runSync(btn) {
    if (!validate()) return;
    var what = current('admin-debug-what');
    var whatWord = what === 'both' ? 'Hourly and daily sync' : what === 'hourly' ? 'Hourly sync' : 'Daily sync';
    var custom = current('admin-debug-days') === 'custom';
    var a = custom ? from.value : '2026-11-08', b = custom ? to.value : '2026-11-08';
    var days = a === b ? dayName(a) : dayName(a) + ' – ' + dayName(b);
    var onlyOct28 = a === '2026-10-28' && b === '2026-10-28';
    var touchesOct28 = a <= '2026-10-28' && b >= '2026-10-28';
    var done, lamp = 'ok';
    if (!custom || (a === '2026-11-08' && b === '2026-11-08')) done = 'Finished for ' + days + ': already complete, nothing changed';
    else if (onlyOct28 && what !== 'daily') { done = 'Finished for ' + days + ': still 9 of 24 hours. CoServ has nothing newer'; lamp = 'warn'; }
    else if (touchesOct28 && what !== 'daily') { done = 'Finished for ' + days + ': every day complete except Oct 28 (9 of 24 hours)'; lamp = 'warn'; }
    else if (b === TODAY) { done = 'Finished for ' + days + ': today has no readings yet, the rest is complete'; lamp = 'warn'; }
    else done = 'Finished for ' + days + ': every day complete, nothing new';
    addRun(whatWord + ' started for ' + days, done, lamp, btn);
    Proto.toast(whatWord + ' started');
  }

  /* ---------- sleep test ---------- */
  var sleepOn = false;
  function toggleSleep(btn) {
    sleepOn = true;
    q('span', btn).textContent = 'Restart test';
    q('[data-debug-sleep-text]').textContent = 'On: hands off the mouse and keys. The countdown shows in 20 s and the app sleeps at 30 s. Waking puts it back to 10 minutes.';
    Proto.toast('Sleep test on: hands off for 30 s');
  }

  /* ---------- query console ---------- */
  var sql = q('[data-debug-sql]'), sqlErr = q('[data-debug-sql-error]'), sqlRes = q('[data-debug-sql-result]'), sqlMeta = q('[data-debug-sql-meta]');
  function runQuery() {
    var text = sql.value.replace(/--[^\n]*/g, '').trim();
    var ok = /^(select|with|explain|show)\b/i.test(text);
    sqlErr.hidden = ok; sqlRes.hidden = !ok; sqlMeta.hidden = !ok;
    if (ok) {
      var table = (text.match(/from\s+([a-z_]+)/i) || [])[1] || 'app_events';
      q('.mono', sqlMeta).textContent = table === 'app_events' ? '37 rows · 41 ms · 5:00 PM' : 'Ran at 5:00 PM · sample shows app_events';
      Proto.toast(table === 'app_events' ? '37 rows' : 'Query ran');
    }
  }
  sql.addEventListener('keydown', function (ev) {
    if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); runQuery(); }
  });
  [from, to].forEach(function (i) { i.addEventListener('input', validate); i.addEventListener('change', validate); });

  /* ---------- one click handler (runs before the shared runtime's) ---------- */
  screen.addEventListener('click', function (ev) {
    var t = ev.target;
    var evBtn = t.closest('[data-open-modal="admin-debug-event"]');
    if (evBtn && evBtn.dataset.evMsg) fill(evBtn);

    var g = t.closest('[data-debug-goto]');
    if (g) { ev.preventDefault(); goto(g.dataset.debugGoto, { level: g.dataset.debugLevel, cat: g.dataset.debugCat }); return; }

    if (t.closest('[data-debug-rerun]')) {
      Proto.selectTab('admin-debug-tab', 'sync');
      Proto.selectTab('admin-debug-days', 'custom');
      Proto.selectTab('admin-debug-what', 'both');
      from.value = '2026-10-28'; to.value = '2026-10-28'; validate();
      scrollToEl(q('#admin-debug-run'));
      return;
    }

    var chip = t.closest('[data-tabs="admin-debug-level"] [data-tab]');
    if (chip) { sel.level = chip.dataset.tab; apply(); }
    if (t.closest('[data-tabs="admin-debug-days"] [data-tab]')) setTimeout(validate, 0);

    var run = t.closest('[data-debug-run]');
    if (run) { runSync(run); return; }

    var job = t.closest('[data-debug-job]');
    if (job) {
      if (job.dataset.debugJob === 'alerts') { addRun('Alert check started', 'Alert check finished: nothing new to send', 'ok', job); Proto.toast('Alert check started'); }
      else { addRun('Forecast retraining started', 'Forecast retrained on 108 days. Next 7 days refreshed', 'ok', job); Proto.toast('Forecast retraining started'); }
      return;
    }

    var sleepBtn = t.closest('[data-debug-sleep]');
    if (sleepBtn) { toggleSleep(sleepBtn); return; }

    var tbl = t.closest('[data-sql-table]');
    if (tbl) {
      sql.value = 'SELECT * FROM ' + tbl.dataset.sqlTable + '\nORDER BY 1 DESC LIMIT 20';
      sql.focus({ preventScroll: true });
      scrollToEl(sql);
      Proto.toast('Query ready for ' + tbl.dataset.sqlTable);
      return;
    }
    if (t.closest('[data-debug-query]')) { runQuery(); return; }
  });
})();
