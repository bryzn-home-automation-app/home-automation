/* Sign in — "You're signed out" after leaving the app, the password fallback's check, and the account request's check. */
(function () {
  var screen = document.querySelector('section.screen[data-route="login"]');
  if (!screen || !window.Proto) return;
  var $ = function (s) { return screen.querySelector(s); };
  var out = $('[data-login-out]'), err = $('[data-login-error]');
  var prev = null, signingOut = false;

  /* only a real sign-out (the app's "Sign out" key) shows the notice */
  document.addEventListener('click', function (ev) {
    var t = ev.target.closest('[data-nav="login"]');
    if (t && !screen.contains(t)) signingOut = true;
  }, true);
  Proto.onChange(function (state) {
    if (state.route === 'login' && prev !== 'login') {
      out.hidden = !signingOut;
      err.hidden = true;
    }
    if (state.route !== 'login') signingOut = false;
    prev = state.route;
  });

  /* the big key: a short "Signing you in…" beat (the real app shows it while Home sign-in returns), then the house */
  var sso = $('[data-login-sso]'), ssoText = $('[data-login-sso-text]'), busy = false;
  document.addEventListener('click', function (ev) {
    if (!ev.target.closest || !ev.target.closest('[data-login-sso]')) return;
    ev.preventDefault();
    ev.stopPropagation();
    if (busy) return;
    busy = true;
    sso.setAttribute('aria-busy', 'true');
    sso.classList.add('is-busy');
    ssoText.textContent = 'Signing you in…';
    setTimeout(function () {
      Proto.go('home');
      Proto.toast('Signed in as Bryan');
      ssoText.textContent = 'Sign in with Home';
      sso.removeAttribute('aria-busy');
      sso.classList.remove('is-busy');
      busy = false;
    }, 700);
  }, true);

  function openModal(id) {
    Proto.closeModals();
    var m = document.querySelector('[data-modal="' + id + '"]');
    if (m) { m.hidden = false; document.documentElement.dataset.modalOpen = id; }
  }

  document.addEventListener('click', function (ev) {
    if (!screen.contains(ev.target)) return;
    if (ev.target.closest('[data-login-submit]')) {
      var ok = $('[data-login-user]').value.trim() && $('[data-login-pass]').value;
      err.hidden = !!ok;
      if (ok) { Proto.go('home'); Proto.toast('Signed in. Welcome back'); }
    }
    if (ev.target.closest('[data-login-request]')) {
      var again = $('[data-login-again]');
      var match = $('[data-login-new]').value === again.querySelector('input').value;
      again.classList.toggle('is-invalid', !match);
      again.querySelector('.field-error').hidden = match;
      again.querySelector('input').setAttribute('aria-invalid', String(!match));
      if (match) openModal('login-pending');
    }
  });
})();
