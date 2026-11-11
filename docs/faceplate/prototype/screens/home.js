/* Home — guests see none of the attention rows (house chores and admin items are not theirs), so their verdict
   must not say "a few things need a look", and the Roomba lamp reads OK for them (the dock bag is a household chore). */
(function () {
  var screen = document.querySelector('section.screen[data-route="home"]');
  if (!screen || !window.Proto) return;
  var verdict = screen.querySelector('#home-verdict');
  var lamp = verdict && verdict.parentNode.querySelector('.lamp');
  var list = screen.querySelector('.home-attn');
  var original = verdict ? verdict.textContent : '';
  var rLink = screen.querySelector('.lamps [data-nav="roomba"]');
  var rLamp = rLink && rLink.querySelector('.lamp');
  var rWord = rLink && rLink.querySelector('.sr-only');
  function apply(state) {
    var guest = state.role === 'guest';
    if (verdict) verdict.textContent = guest ? 'All quiet at home.' : original;
    if (lamp) lamp.className = 'lamp ' + (guest ? 'lamp--info' : 'lamp--warn');
    if (list) list.hidden = guest;
    if (rLamp) rLamp.className = 'lamp ' + (guest ? 'lamp--ok' : 'lamp--warn');
    if (rWord) rWord.textContent = guest ? 'OK' : 'Heads-up';
  }
  Proto.onChange(apply);
  apply(Proto.state);
})();
