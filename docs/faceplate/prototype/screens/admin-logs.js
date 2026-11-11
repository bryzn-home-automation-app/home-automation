/* Activity log — filter the timeline by kind and by person; hide empty days; say so when nothing matches. */
(function () {
  var screen = document.querySelector('section.screen[data-route="admin-logs"]');
  if (!screen || !window.Proto) return;
  var sel = { kind: 'all', who: 'all' };
  var empty = screen.querySelector('[data-logs-empty]');
  var earlier = screen.querySelector('.logs-earlier');

  function apply() {
    var shown = 0, shownEarlier = 0;
    screen.querySelectorAll('.logs-day').forEach(function (day) {
      var n = 0;
      day.querySelectorAll('.tl-item').forEach(function (it) {
        var ok = (sel.kind === 'all' || it.dataset.kind === sel.kind) && (sel.who === 'all' || it.dataset.who === sel.who);
        it.hidden = !ok;
        if (ok) n++;
      });
      day.hidden = n === 0;
      if (earlier.contains(day)) shownEarlier += n; else shown += n;
    });
    empty.hidden = shown + shownEarlier > 0;
    earlier.hidden = shownEarlier === 0;
    var wc = earlier.querySelector('.when-closed');
    if (wc) wc.textContent = 'Show ' + shownEarlier + ' earlier';
    if (!shown && shownEarlier) earlier.open = true;
  }

  screen.addEventListener('click', function (ev) {
    var chip = ev.target.closest('[data-tabs^="admin-logs-"] [data-tab]');
    if (!chip) return;
    var group = chip.closest('[data-tabs]').dataset.tabs;
    sel[group === 'admin-logs-kind' ? 'kind' : 'who'] = chip.dataset.tab;
    apply();
  });
})();
