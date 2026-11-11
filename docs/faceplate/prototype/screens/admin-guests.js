/* Guests — ending access really empties the door list: Alex moves to Ended and the empty state shows. */
(function () {
  var screen = document.querySelector('section.screen[data-route="admin-guests"]');
  if (!screen || !window.Proto) return;
  var q = function (s) { return screen.querySelector(s); };
  function endAccess() {
    var alex = q('[data-guests-alex]');
    if (!alex || alex.hidden) return;
    alex.hidden = true;
    q('[data-guests-empty]').hidden = false;
    q('[data-guests-count="active"]').textContent = '0';
    q('[data-guests-count="ended"]').textContent = '2';
    var li = document.createElement('li');
    li.innerHTML = '<div class="row"><span class="avatar is-away" style="--who: var(--person-alex)" aria-hidden="true">AL</span>' +
      '<span class="row-main"><span class="row-title">Alex <span class="tag">Guest</span></span><span class="row-meta">3 visits · last today, 1:42 PM</span></span>' +
      '<span class="row-trail"><span class="badge">Ended today</span></span></div>';
    var ended = q('[data-guests-ended]');
    ended.insertBefore(li, ended.firstChild);
    var all = q('[data-guests-endall]');
    if (all) all.disabled = true;
  }
  screen.addEventListener('click', function (ev) {
    /* the confirm button's toast comes from app.js (data-close-modal + data-toast) */
    if (ev.target.closest('[data-guests-end]')) endAccess();
  });
})();
