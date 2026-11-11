/* What's new — the release dialog shows the update whose row opened it, and Newer / Older step through all of them. */
(function () {
  var screen = document.querySelector('.screen[data-route="whats-new"]');
  var dlg = document.querySelector('[data-modal="whats-new-release"]');
  if (!screen || !dlg) return;
  var blocks = Array.prototype.slice.call(dlg.querySelectorAll('[data-wn-notes]'));
  var order = blocks.map(function (b) { return b.getAttribute('data-wn-notes'); });
  var newer = dlg.querySelector('[data-wn-step="-1"]');
  var older = dlg.querySelector('[data-wn-step="1"]');
  var body = dlg.querySelector('[data-wn-body]');
  var cur = 0;
  blocks.forEach(function (b, i) { if (!b.hidden) cur = i; });

  function fill(key, text) {
    dlg.querySelectorAll('[data-wn-fill="' + key + '"]').forEach(function (el) { el.textContent = text; });
  }
  function show(i) {
    if (i < 0 || i >= blocks.length) return;
    cur = i;
    blocks.forEach(function (b, j) { b.hidden = j !== cur; });
    var b = blocks[cur];
    fill('meta', b.getAttribute('data-wn-meta'));
    fill('title', b.getAttribute('data-wn-title'));
    fill('summary', b.getAttribute('data-wn-summary'));
    fill('pos', (cur + 1) + ' of ' + blocks.length);
    newer.disabled = cur === 0;
    older.disabled = cur === blocks.length - 1;
    if (body) body.scrollTop = 0;
  }

  document.addEventListener('click', function (ev) {
    var open = ev.target.closest('[data-wn-open]');
    if (open) { show(order.indexOf(open.getAttribute('data-wn-open'))); return; }
    var step = ev.target.closest('[data-wn-step]');
    if (step && dlg.contains(step)) {
      show(cur + Number(step.getAttribute('data-wn-step')));
      // keep focus on a usable key once the end of the list disables the one just pressed
      if (step.disabled) (step === newer ? older : newer).focus();
    }
  });
  show(cur);
})();
