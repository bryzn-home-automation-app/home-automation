/* Guest Wi-Fi — hide/show the password; toasts on dialog buttons (the runtime stops at data-close-modal / data-open-modal);
   a guest doesn't get the invite panel, so the how-to then spans the page instead of sitting in half of it. */
(function () {
  var screen = document.querySelector('section.screen[data-route="wifi"]');
  if (!screen || !window.Proto) return;
  var PASS = 'sunny-otter-482';
  var eye = screen.querySelector('[data-wifi-eye]');
  var shown = screen.querySelector('.readout [data-wifi-pw]');
  var split = screen.querySelector('[data-wifi-split]');
  document.addEventListener('click', function (ev) {
    var tt = ev.target.closest('[data-toast][data-close-modal], [data-toast][data-open-modal]');
    if (tt && screen.contains(tt)) Proto.toast(tt.dataset.toast);
    if (eye && ev.target.closest('[data-wifi-eye]')) {
      var hidden = eye.getAttribute('aria-pressed') === 'true';
      shown.textContent = hidden ? PASS.replace(/./g, '•') : PASS;
      Proto.toast(hidden ? 'Password hidden' : 'Password showing');
    }
  });
  function fit(state) {
    if (!split) return;
    var guest = state.role === 'guest';
    split.classList.toggle('split', !guest);
    split.classList.toggle('split--even', !guest);
  }
  Proto.onChange(fit);
  fit(Proto.state);
})();
