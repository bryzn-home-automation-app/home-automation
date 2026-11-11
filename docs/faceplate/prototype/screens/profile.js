/* Profile — the theme switchgear (Light / Dark / Auto), palette and colour pickers, the Alerts/Phone switch pairs,
   the weather-rule builder (times, "Check the forecast now"), and Edit profile's live preview. */
(function () {
  var screen = document.querySelector('.screen[data-route="profile"]');
  if (!screen || !window.Proto) return;
  var P = window.Proto;
  var q = function (sel, root) { return (root || screen).querySelector(sel); };
  var qa = function (sel, root) { return Array.prototype.slice.call((root || screen).querySelectorAll(sel)); };
  var set = function (key, text) { qa('[data-pf="' + key + '"]').forEach(function (el) { el.textContent = text; }); };

  /* ---- theme: three positions; Auto is light until sunset at 5:31 PM ---- */
  var HELP = {
    light: 'Always light, day and night.',
    dark: 'Always dark, day and night.',
    auto: 'Follows sunrise and sunset at home. Dark from 5:31 PM today.'
  };
  var mode = 'auto';
  function showMode(m) { mode = m; P.selectTab('profile-theme', m); set('theme-help', HELP[m]); }

  /* ---- who is signed in follows the role being previewed: Bryan (Admin), Mai (Member), Alex (Guest) ---- */
  var WHO = {
    admin: { name: 'Bryan', ini: 'BR', who: '--person-bryan', tab: 'sky', handle: '@bryan', email: 'bryan@example.com', phone: '214-555-0142' },
    member: { name: 'Mai', ini: 'MA', who: '--person-mai', tab: 'rose', handle: '@mai', email: 'mai@example.com', phone: '' },
    guest: { name: 'Alex', ini: 'AL', who: '--person-alex', tab: 'teal', handle: '@alex', email: 'Guest pass until Wed, Dec 9', phone: '' },
  };
  var shownRole = 'admin';
  function showWho(role) {
    var w = WHO[role] || WHO.admin;
    shownRole = role;
    saved = { tab: w.tab, who: w.who };
    set('name', w.name); set('handle', w.handle); set('email', w.email); set('phone', w.phone);
    qa('[data-pf="phone"]').forEach(function (el) { el.hidden = !w.phone; });
    var nf = q('[data-pf-namefield]'); if (nf) nf.value = w.name;
    document.querySelectorAll('[data-pf="avatar"], [data-pf="edit-avatar"], .strip-avatar .avatar').forEach(function (av) {
      av.style.setProperty('--who', 'var(' + w.who + ')');
      // keep a status lamp or other child elements; only the initials change
      if (av.firstChild && av.firstChild.nodeType === 3) av.firstChild.nodeValue = w.ini; else av.insertBefore(document.createTextNode(w.ini), av.firstChild);
    });
    document.querySelectorAll('.strip-avatar').forEach(function (a) { a.setAttribute('aria-label', 'Your profile, ' + w.name); });
  }

  P.onChange(function (state) {
    var expected = mode === 'dark' ? 'dark' : 'light';
    if (state.theme !== expected) showMode(state.theme);  // the strip's moon/sun key leaves Auto
    if (state.role !== shownRole) showWho(state.role);
    var guest = state.role === 'guest';
    set('role', { admin: 'Admin', member: 'Member', guest: 'Guest' }[state.role] || 'Admin');
    set('verdict', guest ? 'Visiting as a guest.' : 'Alerts reach this iPhone.');
    set('verdict-note', guest ? 'Pick a theme here. Alerts and linking a phone are for the household.'
      : "7 kinds of alert and 3 weather checks can buzz it, and it tells the house when you're home.");
  });

  /* ---- time pickers: every 15 minutes, in plain clock words ---- */
  function clock(h, m) {
    if (h === 0 && m === 0) return 'Midnight';
    if (h === 12 && m === 0) return 'Noon';
    return ((h % 12) || 12) + ':' + (m < 10 ? '0' : '') + m + (h < 12 ? ' AM' : ' PM');
  }
  function short(v) { var p = v.split(':'), h = +p[0], m = +p[1]; var c = clock(h, m); return /^(Noon|Midnight)$/.test(c) ? c.toLowerCase() : c.replace(':00', ''); }
  qa('select[data-pf-time]').forEach(function (sel) {
    var want = sel.dataset.pfTime;
    sel.textContent = '';
    for (var h = 0; h < 24; h++) for (var m = 0; m < 60; m += 15) {
      var v = (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
      var o = document.createElement('option'); o.value = v; o.textContent = clock(h, m); if (v === want) o.selected = true;
      sel.appendChild(o);
    }
  });
  function sentence(edit) {
    var t = qa('select[data-pf-time]', edit);
    if (t.length < 2) return;
    var a = t[0].value.split(':'), b = t[1].value.split(':');
    var mins = ((+b[0] * 60 + +b[1]) - (+a[0] * 60 + +a[1]) + 1440) % 1440 || 1440;
    var hrs = Math.round(mins / 15) / 4;
    q('.pf-rule-when', edit).innerHTML = 'Checked every day at <b>' + short(t[0].value) + '</b>, looking ahead to <b>' + short(t[1].value) + '</b> (' + hrs + (hrs === 1 ? ' hour' : ' hours') + ').';
  }
  screen.addEventListener('change', function (ev) {
    var edit = ev.target.closest('[data-pf-edit]');
    if (!edit) return;
    sentence(edit);
    var pv = q('[data-pf-preview]', edit); if (pv) pv.hidden = true;
    P.toast('Saved');
  });

  /* ---- switch pairs: Phone needs Alerts; a weather rule opens its editor when it's on ---- */
  function nameOf(sw) { return (sw.getAttribute('aria-label') || '').split(':')[0]; }
  function setSwitch(sw, on) { sw.setAttribute('aria-checked', String(on)); sw.classList.toggle('is-on', on); }
  function lock(row) {
    var inSw = q('[data-pf-in]', row), push = q('[data-pf-push]', row);
    var on = inSw.getAttribute('aria-checked') === 'true';
    push.classList.toggle('is-locked', !on);
    if (on) push.removeAttribute('aria-disabled'); else push.setAttribute('aria-disabled', 'true');
    var rule = row.closest('.pf-rule');
    if (rule) { var ed = q('[data-pf-edit]', rule); if (ed) ed.hidden = !on; }
  }
  qa('.pf-type').forEach(lock);

  /* ---- Edit profile ---- */
  var saved = { tab: 'sky', who: '--person-bryan' };
  function preview(who) { var av = q('[data-pf="edit-avatar"]'); if (av) av.style.setProperty('--who', 'var(' + who + ')'); }

  document.addEventListener('click', function (ev) {
    var t = ev.target;
    if (!screen.contains(t)) return;

    // a readout that leads to its settings: pick the tab and bring it up under the top strip
    var go = t.closest('[data-pf-goto]');
    if (go) {
      ev.preventDefault();
      P.selectTab('profile-view', go.getAttribute('data-pf-goto'));
      var seg = q('[data-tabs="profile-view"]');
      var still = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (seg) window.scrollTo({ top: seg.getBoundingClientRect().top + window.pageYOffset - 72, behavior: still ? 'auto' : 'smooth' });
      return;
    }

    var key = t.closest('[data-tabs="profile-theme"] [data-tab]');
    if (key) { mode = key.dataset.tab; set('theme-help', HELP[mode]); P.setTheme(mode === 'dark' ? 'dark' : 'light'); return; }

    var pal = t.closest('[data-tabs="profile-palette"] [data-tab]');
    if (pal) {
      // a palette is an enamel finish (tokens.css): surfaces tint, ink and status colours stay put
      var root = document.documentElement;
      if (pal.dataset.tab === 'default') root.removeAttribute('data-palette'); else root.dataset.palette = pal.dataset.tab;
      set('palette-name', pal.getAttribute('aria-label'));
      P.toast(pal.getAttribute('aria-label') + ' finish on');
      return;
    }

    var col = t.closest('[data-tabs="profile-colour"] [data-tab]');
    if (col) { preview(col.dataset.pfWho); set('colour-name', col.getAttribute('aria-label')); return; }

    if (t.closest('[data-open-modal="profile-edit"]')) {
      P.selectTab('profile-colour', saved.tab); preview(saved.who);
      var b = q('[data-tabs="profile-colour"] [data-tab="' + saved.tab + '"]'); if (b) set('colour-name', b.getAttribute('aria-label'));
      return;
    }
    if (t.closest('[data-pf-save]')) {
      var on = q('[data-tabs="profile-colour"] .is-active');
      if (on) { saved = { tab: on.dataset.tab, who: on.dataset.pfWho }; }
      var name = (q('[data-pf-namefield]').value || 'Bryan').trim() || 'Bryan';
      var initials = name.split(/\s+/).length > 1 ? name.split(/\s+/).map(function (w) { return w[0]; }).join('').slice(0, 2) : name.slice(0, 2);
      set('name', name);
      document.querySelectorAll('[data-pf="avatar"], .strip-avatar .avatar').forEach(function (av) {
        av.style.setProperty('--who', 'var(' + saved.who + ')'); av.textContent = initials.toUpperCase();
      });
      return;
    }

    var sw = t.closest('[data-pf-in], [data-pf-push]');
    if (sw) {
      var row = sw.closest('.pf-type');
      var isOn = sw.getAttribute('aria-checked') === 'true';
      if (sw.hasAttribute('data-pf-in')) {
        var push = q('[data-pf-push]', row);
        if (!isOn) setSwitch(push, false);
        else if (sw.closest('.pf-rule')) setSwitch(push, true);
        lock(row);
        P.toast(nameOf(sw) + (isOn ? ' alerts on' : ' alerts off'));
      } else {
        P.toast(nameOf(sw) + (isOn ? ' will buzz your phone' : " won't buzz your phone"));
      }
      return;
    }

    if (t.closest('[data-pf-device]')) {
      var dev = q('[data-pf-device]').getAttribute('aria-checked') === 'true';
      set('device-help', dev ? 'On. Your alerts go to 2 devices' : 'Off for this iPhone. Your other device still gets them');
      P.toast(dev ? 'Alerts are on for this device' : 'Alerts are off for this device');
      return;
    }

    if (t.closest('[data-pf-reset]')) {
      var DEFAULTS = [[1, 1], [1, 1], [1, 1], [1, 1], [1, 1], [1, 1], [1, 1], [1, 0], [1, 0], [1, 0], [1, 0], [1, 0]];
      qa('[data-tab-panel="profile-view:alerts"] .pf-type').forEach(function (r, i) {
        if (!DEFAULTS[i]) return;
        setSwitch(q('[data-pf-in]', r), !!DEFAULTS[i][0]); setSwitch(q('[data-pf-push]', r), !!DEFAULTS[i][1]); lock(r);
      });
      P.toast('Alert types are back to the defaults');
      return;
    }

    var check = t.closest('[data-pf-check]');
    if (check) {
      var pv = q('[data-pf-preview]', check.closest('[data-pf-edit]'));
      var wasOpen = pv && !pv.hidden;
      if (pv) pv.hidden = false;
      P.toast(wasOpen ? 'Checked again just now' : 'Checked the forecast');
    }
  });
})();
