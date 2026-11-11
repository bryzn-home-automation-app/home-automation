/* Alerts — open an alert to read it (and mark it read), filter by kind / severity / unread / search,
   mark everything read, and keep the counters (here and on the Alerts keys) honest. */
(function () {
  var screen = document.querySelector('.screen[data-route="alerts"]');
  if (!screen || !window.Proto) return;
  var P = window.Proto;
  var q = function (sel, root) { return (root || screen).querySelector(sel); };
  var qa = function (sel, root) { return Array.prototype.slice.call((root || screen).querySelectorAll(sel)); };
  var SEVS = ['problem', 'warn', 'info', 'ok'];
  var LAMP = { problem: 'lamp--problem', warn: 'lamp--warn', info: 'lamp--info', ok: 'lamp--ok' };
  var initialVerdict = { text: q('[data-al="verdict"]').textContent, note: q('[data-al="verdict-note"]').textContent };

  function roleAllows(el) {
    var role = P.state.role;
    for (var n = el; n && n !== screen; n = n.parentElement) {
      var r = n.getAttribute && n.getAttribute('data-role-only');
      if (!r) continue;
      if (role === 'guest' && (r.indexOf('admin') > -1 || r.indexOf('member') > -1)) return false;
      if (role === 'member' && r.indexOf('admin') > -1) return false;
    }
    return true;
  }
  function items() { return qa('li[data-cat]').filter(roleAllows); }
  function rowOf(li) { return li.querySelector('.row'); }
  function isUnread(li) { return rowOf(li).classList.contains('is-unread'); }
  function set(key, text) { var el = q('[data-al="' + key + '"]'); if (el) el.textContent = text; }

  function recount() {
    var all = items();
    var unread = all.filter(isUnread);
    var week = all.filter(function (li) { return +li.dataset.day <= 6; });
    var today = all.filter(function (li) { return li.dataset.day === '0'; });
    set('unread', String(unread.length));
    set('unread-note', unread.length ? 'since\n' + oldestLabel(unread) : 'all read');
    set('week', String(week.length));
    var todayUnread = today.filter(isUnread).length;
    set('today-note', (todayUnread ? todayUnread + ' unread' : 'All read') + '. Newest at 8:05 AM');
    SEVS.forEach(function (s) {
      var n = week.filter(function (li) { return li.dataset.sev === s; }).length;
      set(s, String(n));
      var lamp = q('[data-al-lamp="' + s + '"]');
      lamp.classList.toggle(LAMP[s], n > 0);
      lamp.parentElement.classList.toggle('is-zero', n === 0);
    });
    // the verdict follows what is still unread
    var lamp = q('[data-al="verdict-lamp"]');
    var worth = unread.filter(function (li) { return li.dataset.sev === 'warn' || li.dataset.sev === 'problem'; });
    var hasProblem = unread.some(function (li) { return li.dataset.sev === 'problem'; });
    lamp.className = 'lamp ' + (unread.length === 0 ? 'lamp--ok' : hasProblem ? 'lamp--problem' : worth.length ? 'lamp--warn' : 'lamp--info');
    if (unread.length === 3 && worth.length === 1) {
      set('verdict', initialVerdict.text); set('verdict-note', initialVerdict.note);
    } else if (unread.length === 0) {
      set('verdict', 'All caught up.');
      set('verdict-note', 'Nothing unread. New alerts land here as they happen, and on your phone if you turned that on.');
    } else {
      set('verdict', unread.length + ' unread, ' + (worth.length === 0 ? 'nothing urgent.' : worth.length === 1 ? 'one worth a look.' : worth.length + ' worth a look.'));
      // each alert that can start unread carries a short phrase, so the note stays a sentence, not a list of titles
      var bits = unread.map(function (li) { return li.dataset.alShort || li.querySelector('.row-title').textContent; });
      var said = bits.length === 1 ? bits[0] : bits.slice(0, -1).join(', ') + ' and ' + bits[bits.length - 1];
      set('verdict-note', 'Still unread: ' + said + '.');
    }
    var btn = q('[data-al-markall]');
    if (unread.length === 0) btn.setAttribute('aria-disabled', 'true'); else btn.removeAttribute('aria-disabled');
    shell(unread.length);
  }
  function oldestLabel(unread) {
    var li = unread[unread.length - 1];
    var day = li.closest('.al-day').querySelector('.tl-day .mono').textContent.replace(/^(\w+), \w+ \d+$/, '$1');
    var time = li.querySelector('.row-trail .mono').textContent;
    return (li.dataset.day === '0' ? '' : day + ', ') + time;
  }

  // the unread count shown on the Alerts keys and plates in the shell
  function shell(n) {
    document.querySelectorAll('.strip-count, .navkey[data-nav="alerts"] .count, .padkey[data-nav="alerts"] .count, .rowkey--more .count').forEach(function (c) {
      c.textContent = String(n); c.hidden = n === 0;
    });
    var plate = document.querySelector('.strip-plate--alerts');
    if (plate) {
      plate.setAttribute('aria-label', 'Alerts, ' + n + ' unread');
      var v = plate.querySelector('.strip-plate-val'); if (v) v.textContent = String(n);
      var l = plate.querySelector('.lamp'); if (l) l.classList.toggle('lamp--info', n > 0);
    }
  }

  function markRead(li) {
    var row = rowOf(li);
    if (!row.classList.contains('is-unread')) return false;
    row.classList.remove('is-unread');
    var sr = row.querySelector('.sr-only'); if (sr && /Unread/.test(sr.textContent)) sr.remove();
    return true;
  }

  function filter() {
    var catBtn = q('[data-tabs="alerts-cat"] .is-active');
    var cat = catBtn ? catBtn.dataset.tab : 'all';
    var sevs = qa('[data-al-sev][aria-pressed="true"]').map(function (b) { return b.dataset.alSev; });
    var unreadOnly = q('[data-al-unread]').getAttribute('aria-checked') === 'true';
    var term = (q('[data-al-search]').value || '').trim().toLowerCase();
    var filtering = cat !== 'all' || sevs.length || unreadOnly || term;
    var shown = 0;
    qa('li[data-cat]').forEach(function (li) {
      var ok = (cat === 'all' || li.dataset.cat === cat) &&
        (!sevs.length || sevs.indexOf(li.dataset.sev) > -1) &&
        (!unreadOnly || isUnread(li)) &&
        (!term || li.textContent.toLowerCase().indexOf(term) > -1);
      li.hidden = !ok;
      if (ok && roleAllows(li)) shown++;
    });
    qa('.al-day').forEach(function (d) {
      d.hidden = !qa('li[data-cat]', d).some(function (li) { return !li.hidden && roleAllows(li); });
    });
    var older = q('.al-older');
    var olderHas = qa('li[data-cat]', older).some(function (li) { return !li.hidden && roleAllows(li); });
    older.hidden = !olderHas;
    if (filtering && olderHas) older.open = true;
    var empty = q('[data-al="empty"]');
    empty.hidden = shown > 0;
    if (!shown) {
      if (unreadOnly && cat === 'all' && !sevs.length && !term) {
        set('empty-title', "You're all caught up");
        set('empty-text', 'Nothing unread. New alerts from the house show up here as they happen.');
      } else {
        set('empty-title', 'Nothing matches');
        set('empty-text', 'Try All, or clear the search. Alerts from the house land here as they happen: power, weather, cameras, the Roomba and bills.');
      }
    }
  }

  document.addEventListener('click', function (ev) {
    if (!screen.contains(ev.target) && !ev.target.closest('[data-al-goto]')) return;
    var go = ev.target.closest('[data-al-goto]');
    if (go) { var g = go.dataset.alGoto.split(':'); P.selectTab(g[0], g[1]); return; }

    var row = ev.target.closest('.row[aria-controls]');
    if (row && screen.contains(row)) {
      var msg = document.getElementById(row.getAttribute('aria-controls'));
      var open = row.getAttribute('aria-expanded') !== 'true';
      row.setAttribute('aria-expanded', String(open));
      if (msg) msg.hidden = !open;
      if (markRead(row.closest('li'))) recount();   // touching an alert reads it, even the one that starts open
      return;
    }
    if (ev.target.closest('[data-al-markall]')) {
      var changed = items().filter(markRead).length;
      recount(); filter();
      P.toast(changed ? 'All alerts marked read' : 'Nothing left to mark');
      return;
    }
    if (ev.target.closest('[data-tabs="alerts-cat"] [data-tab], [data-al-sev], [data-al-unread]')) filter();
  });
  q('[data-al-search]').addEventListener('input', filter);

  // shoot.js / other screens can pick a category with Proto.selectTab: keep the list in step
  var select = P.selectTab;
  P.selectTab = function (group, name) { select(group, name); if (group === 'alerts-cat') filter(); };

  // "This week" counts the same alerts this person can see (guests don't get camera or server alerts)
  function week() {
    var fig = q('figure[data-chart="stack"]');
    if (!fig) return;
    var NAMES = { problem: 'Problem', warn: 'Heads-up', info: 'Info', ok: 'OK' };
    var parts = SEVS.map(function (s) { return { name: NAMES[s], tone: s, values: [0, 0, 0, 0, 0, 0, 0] }; });
    items().forEach(function (li) {
      var d = +li.dataset.day;
      if (d > 6) return;
      parts[SEVS.indexOf(li.dataset.sev)].values[6 - d]++;
    });
    fig.setAttribute('data-parts', JSON.stringify(parts));
    if (window.FP && window.FP.render) window.FP.render(fig);
  }

  var lastRole = null;
  P.onChange(function (state) { if (state.role !== lastRole) { lastRole = state.role; recount(); filter(); week(); } });
  recount(); filter();
})();
