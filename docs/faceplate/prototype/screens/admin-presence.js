/* Who's home — fill the label dialog from the row that opened it; show/hide unnamed devices not on Wi-Fi. */
(function () {
  var screen = document.querySelector('section.screen[data-route="admin-presence"]');
  if (!screen || !window.Proto) return;
  var dlg = screen.querySelector('[data-modal="admin-presence-label"]');
  var title = dlg.querySelector('.dialog-title');
  var sub = dlg.querySelector('[data-dev-sub]');
  var state = dlg.querySelector('[data-dev-state]');
  var nameIn = dlg.querySelector('[data-dev-field="name"]');
  var typeIn = dlg.querySelector('[data-dev-field="type"]');
  var ownerIn = dlg.querySelector('[data-dev-field="owner"]');
  var hint = dlg.querySelector('[data-dev-hint]');

  function updateHint() {
    var t = typeIn.value;
    hint.hidden = !(ownerIn.value && t !== 'MOBILE' && t !== 'WATCH');
  }
  typeIn.addEventListener('change', updateHint);
  ownerIn.addEventListener('change', updateHint);

  screen.addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-open-modal="admin-presence-label"]');
    if (b) {
      var named = !!b.dataset.devName;
      title.textContent = named ? 'Edit ' + b.dataset.devName : 'Label a device';
      sub.textContent = b.dataset.devAddr || '';
      var on = /^On/.test(b.dataset.devStatus || '');
      state.innerHTML = '<span class="lamp lamp--s' + (on ? ' lamp--ok' : '') + '"></span><span></span>';
      state.lastChild.textContent = b.dataset.devStatus || '';
      nameIn.value = b.dataset.devName || '';
      typeIn.value = b.dataset.devType || '';
      ownerIn.value = b.dataset.devOwner || '';
      updateHint();
    }
    /* Save / Cancel that close and confirm get their toast from app.js */
  });

  var all = screen.querySelector('[data-presence-all]');
  var list = screen.querySelector('.presence-unnamed');
  if (all && list) all.addEventListener('change', function () { list.classList.toggle('is-all', all.checked); });
})();
