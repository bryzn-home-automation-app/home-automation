/* People — fills the "Manage" dialog from the row that opened it, and lets an approval leave the inbox. */
(function () {
  var screen = document.querySelector('.screen[data-route="people"]');
  if (!screen) return;

  var PEOPLE = {
    mai:  { name: 'Mai',  initials: 'MA', who: '--person-mai',  role: 'member', guest: false, email: 'mai@example.com',
            meta: 'Online now · 97 sign-ins since Sun, Aug 23' },
    linh: { name: 'Linh', initials: 'LI', who: '--person-linh', role: 'member', guest: false, email: 'linh@example.com',
            meta: 'Last signed in Sun, 8:05 AM · 41 sign-ins since Wed, Sep 2' },
    alex: { name: 'Alex', initials: 'AL', who: '--person-alex', role: 'guest',  guest: true,  email: 'Guest · joined from the guest page',
            meta: 'Online now · 5 visits since Sat, Oct 31' }
  };
  var ROLE_WORD = { admin: 'an Admin', member: 'a Member', guest: 'a Guest' };
  var current = PEOPLE.mai;

  function fill(key, text) {
    document.querySelectorAll('[data-ppl-fill="' + key + '"]').forEach(function (el) { el.textContent = text; });
  }

  function load(p) {
    current = p;
    fill('name', p.name);
    fill('email', p.email);
    fill('meta', p.meta);
    var av = document.querySelector('[data-modal="people-manage"] [data-ppl-fill="avatar"]');
    if (av) { av.textContent = p.initials; av.style.setProperty('--who', 'var(' + p.who + ')'); }
    window.Proto.selectTab('people-role', p.role);
    if (p.guest) {
      fill('access-help', 'Ending guest access signs ' + p.name + ' out now, before the 30 days are up.');
      fill('access-action', 'End ' + p.name + "'s guest access");
      fill('confirm-title', 'End ' + p.name + "'s guest access?");
      fill('confirm-text', p.name + ' is signed out right away and the guest Wi-Fi page stops working for them. You can invite ' + p.name + ' again from Guests.');
      fill('confirm-action', 'End access');
    } else {
      fill('access-help', 'Turning off the account signs ' + p.name + ' out everywhere. You can turn it back on any time.');
      fill('access-action', 'Turn off ' + p.name + "'s account");
      fill('confirm-title', 'Turn off ' + p.name + "'s account?");
      fill('confirm-text', p.name + " will be signed out on every device and won't be able to sign in. Settings and alert choices are kept, so turning the account back on picks up where it left off.");
      fill('confirm-action', 'Turn off account');
    }
    var confirmBtn = document.querySelector('[data-ppl-confirm]');
    if (confirmBtn) confirmBtn.dataset.toast = p.guest ? p.name + "'s guest access has ended" : p.name + "'s account is turned off";
  }

  function settle() {
    var item = screen.querySelector('[data-ppl="request"]');
    if (item) item.hidden = true;
    var list = screen.querySelector('[data-ppl="pending-list"]');
    var empty = screen.querySelector('[data-ppl="pending-empty"]');
    var count = screen.querySelector('[data-ppl="pending-count"]');
    if (list) list.hidden = true;
    if (empty) empty.hidden = false;
    if (count) count.hidden = true;
    screen.querySelectorAll('.verdict-note [data-role-only="admin"]').forEach(function (el) { el.hidden = true; });
  }

  document.addEventListener('click', function (ev) {
    var opener = ev.target.closest('[data-person]');
    if (opener && PEOPLE[opener.dataset.person]) { load(PEOPLE[opener.dataset.person]); return; }

    if (ev.target.closest('[data-ppl-save]')) {
      var on = document.querySelector('[data-tabs="people-role"] .is-active');
      var role = on ? on.dataset.tab : current.role;
      window.Proto.toast(role === current.role ? 'No change to ' + current.name + "'s role" : current.name + ' is now ' + ROLE_WORD[role]);
      return;
    }
    if (ev.target.closest('[data-ppl-approve]')) {
      var pick = screen.querySelector('[data-tabs="people-danny-role"] .is-active');
      window.Proto.toast('Danny Tran can sign in now, as ' + ROLE_WORD[pick ? pick.dataset.tab : 'member']);
      settle();
      return;
    }
    if (ev.target.closest('[data-ppl-deny]')) settle();
    // ending the only guest's access leaves the Guests list empty, and says so
    if (ev.target.closest('[data-ppl-confirm]') && current.guest) {
      var gl = screen.querySelector('[data-ppl="guests-list"]');
      var ge = screen.querySelector('[data-ppl="guests-empty"]');
      if (gl) gl.hidden = true;
      if (ge) ge.hidden = false;
    }
  });
})();
