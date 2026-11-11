/* Guest welcome — the badge follows what the guest types and picks; Check in validates and opens the lobby;
   a tap on someone at the house fills their card. */
(function () {
  var screen = document.querySelector('section.screen[data-route="guest-portal"]');
  if (!screen || !window.Proto) return;
  var $ = function (s) { return screen.querySelector(s); };
  var $$ = function (s) { return Array.prototype.slice.call(screen.querySelectorAll(s)); };
  var nameIn = $('[data-gp-name-input]'), codeIn = $('[data-gp-code]');
  var colour = { key: 'teal', name: 'teal', value: 'var(--person-alex)' };

  function initials(n) {
    var w = n.trim().split(/\s+/).filter(Boolean);
    if (!w.length) return '?';
    return (w.length > 1 ? w[0].charAt(0) + w[1].charAt(0) : w[0].slice(0, 2)).toUpperCase();
  }
  function paint() {
    var n = nameIn.value.trim(), shown = n || 'Your name', ini = initials(n);
    $$('[data-gp-name]').forEach(function (el) { el.textContent = shown; });
    $$('[data-gp-initials]').forEach(function (el) { el.textContent = ini; });
    $$('[data-gp-you-name]').forEach(function (el) { el.textContent = n || 'you'; });
    var face = $('[data-gp-you-face]'); if (face) { face.textContent = ini; face.style.setProperty('--who', colour.value); }
    $$('[data-gp-badge]').forEach(function (b) {
      b.style.setProperty('--who', colour.value);
      b.setAttribute('aria-label', 'Visitor badge for ' + (n || 'a guest') + ', in ' + colour.name);
    });
    var code = codeIn.value.trim().toUpperCase();
    $$('[data-gp-code-echo]').forEach(function (el) { el.textContent = code || '—'; });
  }
  function fieldError(which, msg) {
    var f = $('[data-gp-field="' + which + '"]'), err = f.querySelector('.field-error'), help = f.querySelector('.field-help');
    f.classList.toggle('is-invalid', !!msg);
    f.querySelector('input').setAttribute('aria-invalid', String(!!msg));
    err.hidden = !msg;
    if (help) help.hidden = !!msg;
    if (msg && which === 'name') f.querySelector('[data-gp-msg]').textContent = msg;
  }

  nameIn.addEventListener('input', function () { fieldError('name', null); paint(); });
  codeIn.addEventListener('input', function () { fieldError('code', null); paint(); });

  var PEOPLE = {
    bryan: { name: 'Bryan', ini: 'BR', tok: 'var(--person-bryan)', role: 'Lives here. Runs the house app', note: 'Home since Sun, 6:12 PM', state: 'Home', ok: true, app: 'Online now' },
    mai: { name: 'Mai', ini: 'MA', tok: 'var(--person-mai)', role: 'Lives here', note: 'Home since 7:39 AM', state: 'Home', ok: true, app: 'Online now' },
    linh: { name: 'Linh', ini: 'LI', tok: 'var(--person-linh)', role: 'Lives here', note: 'Out right now. Last seen at 3:02 PM', state: 'Away', ok: false, app: 'Not right now' },
    alex: { you: true, role: 'That’s you. A guest at the house', note: 'Checked in at 1:42 PM. Pass until Wed, Dec 9', state: 'Visiting', ok: true, app: 'Online now' }
  };

  document.addEventListener('click', function (ev) {
    if (!screen.contains(ev.target)) return;
    var sw = ev.target.closest('[data-tabs="guest-portal-colour"] [data-tab]');
    if (sw) {
      colour = { key: sw.dataset.tab, name: sw.getAttribute('aria-label').toLowerCase(), value: sw.style.getPropertyValue('--sw') };
      paint();
    }
    if (ev.target.closest('[data-gp-join]')) {
      var n = nameIn.value.trim(), c = codeIn.value.trim().toUpperCase().replace(/\s+/g, '');
      var nameMsg = !n ? 'Type your name to check in' : n.length < 2 ? 'Use at least 2 letters' : null;
      var codeBad = !/^MAPLE-?4821$/.test(c);
      fieldError('name', nameMsg);
      fieldError('code', codeBad ? 'bad' : null);
      if (nameMsg) { nameIn.focus(); return; }
      if (codeBad) { codeIn.focus(); return; }
      paint();
      Proto.selectTab('guest-portal-step', 'lobby');
      window.scrollTo(0, 0);
      Proto.toast('Checked in. Welcome, ' + n);
    }
    if (ev.target.closest('[data-gp-restart]')) {
      Proto.selectTab('guest-portal-step', 'checkin');
      window.scrollTo(0, 0);
      nameIn.focus();
    }
    var who = ev.target.closest('[data-gp-person]');
    if (who) {
      var p = PEOPLE[who.dataset.gpPerson];
      var nm = p.you ? (nameIn.value.trim() || 'You') : p.name;
      $('[data-gp-d-name]').textContent = nm;
      var face = $('[data-gp-d-face]');
      face.textContent = p.you ? initials(nameIn.value) : p.ini;
      face.style.setProperty('--who', p.you ? colour.value : p.tok);
      face.classList.toggle('is-away', !p.ok);
      $('[data-gp-d-role]').textContent = p.role;
      $('[data-gp-d-note]').textContent = p.note;
      $('[data-gp-d-state]').innerHTML = '<span class="badge' + (p.ok ? ' badge--ok' : '') + '">' + p.state + '</span>';
      $('[data-gp-d-app]').textContent = p.app;
    }
  });

  paint();
})();
