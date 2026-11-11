/* Cameras — the live clock on streaming pictures, play / stop for battery cameras, the full-screen view,
   the camera filter on Recordings and the recording player (play, Older / Newer, arrow keys). */
(function () {
  var screen = document.querySelector('section.screen[data-route="cameras"]');
  if (!screen || !window.Proto) return;
  var root = document.documentElement;
  function $(sel, el) { return (el || screen).querySelector(sel); }
  function $$(sel, el) { return Array.prototype.slice.call((el || screen).querySelectorAll(sel)); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function clock(s) {
    var h = Math.floor(s / 3600) % 24, m = Math.floor(s % 3600 / 60), x = s % 60;
    return (h % 12 || 12) + ':' + pad(m) + ':' + pad(x) + ' ' + (h >= 12 ? 'PM' : 'AM');
  }
  function parseClock(t) {
    var p = /(\d+):(\d+):(\d+)\s*(AM|PM)/.exec(t || '');
    if (!p) return 0;
    var h = (+p[1]) % 12 + (p[4] === 'PM' ? 12 : 0);
    return h * 3600 + (+p[2]) * 60 + (+p[3]);
  }

  /* ---------- the live clock: ticks only while this page is open ---------- */
  var now = 17 * 3600 + 12;
  setInterval(function () {
    if (Proto.state.route !== 'cameras') return;
    now++;
    var txt = clock(now);
    $$('[data-clock]').forEach(function (el) { el.textContent = txt; });
  }, 1000);

  /* ---------- play / stop on battery cameras ---------- */
  function setLive(tile, on) {
    var frame = $('[data-frame]', tile), word = $('[data-tag-word]', tile), tag = $('[data-tag]', tile), stop = $('[data-stop]', tile);
    var name = $('.media-name', tile).textContent;
    if (on) {
      frame.classList.add('is-waking');
      word.textContent = 'Waking…';
      Proto.toast('Waking the ' + name + ' camera');
      setTimeout(function () {
        frame.classList.remove('is-waking');
        frame.classList.add('is-live');
        tag.classList.remove('media-tag--off');
        word.textContent = 'Live';
        if (stop) stop.hidden = false;
      }, 1200);
    } else {
      frame.classList.remove('is-live');
      tag.classList.add('media-tag--off');
      word.textContent = 'Paused';
      if (stop) stop.hidden = true;
      Proto.toast(name + ' paused to save battery');
    }
  }

  /* ---------- full screen ---------- */
  var CAMS = {
    driveway: { name: 'Driveway', sub: 'Person · 1 min ago · battery 27%', ptz: false, pos: [] },
    backyard: { name: 'Backyard', sub: 'Motion · 38 min ago · battery 87%, solar charging', ptz: true, pos: ['Home', 'Position 1', 'Position 2'] },
    living: { name: 'Living Room', sub: 'Person · 12 min ago · wired power', ptz: true, pos: ['Home', 'Position 1'] }
  };
  var liveCam = 'driveway';
  function openLive(key) {
    var c = CAMS[key];
    if (!c) return;
    liveCam = key;
    $('[data-l-name]').textContent = c.name;
    $('[data-l-cam]').textContent = c.name;
    $('[data-l-sub]').textContent = c.sub;
    $('[data-l-scene]').setAttribute('href', '#cam-scene-' + key);
    $$('[data-l-ptz]').forEach(function (b) { b.hidden = !c.ptz; });
    var turn = $('[data-l-turn]'), chips = $('[data-l-chips]');
    turn.hidden = !c.pos.length;
    chips.innerHTML = c.pos.map(function (p) {
      return '<button class="chip" type="button" data-toast="' + c.name + ' is turning to ' + p + '">' + p + '</button>';
    }).join('');
    // waking a paused battery camera from here starts it on the page too
    var tile = $('.cam-tile[data-cam="' + key + '"]');
    var frame = tile && $('[data-frame]', tile);
    if (frame && !frame.classList.contains('is-live')) setLive(tile, true);
  }

  /* ---------- recordings: filter by camera ---------- */
  var recPanel = $('[data-tab-panel="cameras-view:recordings"]');
  function plural(n) { return n + (n === 1 ? ' clip' : ' clips'); }
  function filter(cam) {
    var shown = 0, recentShown = 0, olderShown = 0;
    $$('.cam-day', recPanel).forEach(function (day) {
      var n = 0;
      $$('li[data-cam]', day).forEach(function (li) {
        var on = cam === 'all' || li.dataset.cam === cam;
        li.hidden = !on;
        if (on) n++;
      });
      day.hidden = n === 0;
      var c = $('[data-count]', day);
      if (c) c.textContent = plural(n);
      shown += n;
      if (day.closest('.cam-older')) olderShown += n; else recentShown += n;
    });
    $('[data-rec-empty]', recPanel).hidden = recentShown > 0;
    $('[data-older-n]', recPanel).textContent = plural(olderShown);
    var chip = $('[data-tabs="cameras-rec"] [data-tab="' + cam + '"]');
    var label = cam === 'all' ? '' : ' from the ' + chip.firstChild.textContent.trim();
    $('[data-rec-sub]', recPanel).textContent = plural(shown) + label + ' in the last 7 days, newest first';
  }

  /* ---------- recording player ---------- */
  var list = [], idx = 0, timer = null, pos = 0;
  function rows() { return $$('li[data-cam]:not([hidden]) > .cam-rec', recPanel); }
  function stopPlay() {
    clearInterval(timer); timer = null;
    $('[data-p-frame]').classList.remove('is-live');
    var tog = $('[data-p-toggle]');
    tog.setAttribute('aria-label', 'Play');
    $('use', tog).setAttribute('href', '#i-play');
  }
  function paint() {
    var r = list[idx];
    var secs = +r.dataset.secs;
    var pct = Math.min(100, pos / secs * 100);
    $('[data-p-bar]').style.setProperty('--p', pct.toFixed(1) + '%');
    $('[role="progressbar"]', $('.cam-scrub')).setAttribute('aria-valuenow', String(Math.round(pct)));
    $('[data-p-pos]').textContent = Math.floor(pos / 60) + ':' + pad(Math.floor(pos % 60));
    $('[data-p-clock]').textContent = clock(parseClock(r.dataset.clock) + Math.floor(pos));
  }
  function load(i) {
    stopPlay();
    idx = Math.max(0, Math.min(list.length - 1, i));
    pos = 0;
    var r = list[idx];
    $('[data-p-name]').textContent = r.dataset.name;
    $('[data-p-cam]').textContent = r.dataset.name;
    $('[data-p-when]').textContent = r.dataset.when;
    $('[data-p-dur]').textContent = r.dataset.dur;
    $('[data-p-scene]').setAttribute('href', '#cam-scene-' + r.dataset.scene);
    $('[data-p-download]').dataset.toast = 'Saved ' + r.dataset.file;
    $('[data-p-index]').textContent = (idx + 1) + ' of ' + list.length;
    $('[data-p-step="1"]').disabled = idx >= list.length - 1;
    $('[data-p-step="-1"]').disabled = idx <= 0;
    $('[data-p-play]').hidden = false;
    paint();
  }
  function play() {
    var r = list[idx];
    if (!r) return;
    var secs = +r.dataset.secs;
    if (pos >= secs) pos = 0;
    $('[data-p-frame]').classList.add('is-live');
    $('[data-p-play]').hidden = true;
    var tog = $('[data-p-toggle]');
    tog.setAttribute('aria-label', 'Pause');
    $('use', tog).setAttribute('href', '#i-pause');
    clearInterval(timer);
    timer = setInterval(function () {
      if (root.dataset.modalOpen !== 'cameras-player') { stopPlay(); return; }
      pos += 0.25;
      if (pos >= secs) { pos = secs; paint(); stopPlay(); $('[data-p-play]').hidden = false; return; }
      paint();
    }, 250);
  }

  /* ---------- events ---------- */
  screen.addEventListener('click', function (ev) {
    var t = ev.target;
    var el;
    if ((el = t.closest('[data-play]'))) { setLive(el.closest('.cam-tile'), true); return; }
    if ((el = t.closest('[data-stop]'))) { setLive(el.closest('.cam-tile'), false); return; }
    if ((el = t.closest('[data-full]'))) { openLive(el.dataset.full); return; }
    if ((el = t.closest('[data-l-ptz]'))) { Proto.toast(CAMS[liveCam].name + ' ' + el.dataset.lDir); return; }
    if ((el = t.closest('[data-show-recordings]'))) {
      ev.preventDefault();
      Proto.selectTab('cameras-view', 'recordings');
      var seg = $('[data-tabs="cameras-view"]');
      if (seg && seg.scrollIntoView) seg.scrollIntoView({ block: 'start', behavior: 'smooth' });
      return;
    }
    if ((el = t.closest('[data-tabs="cameras-rec"] [data-tab]'))) { filter(el.dataset.tab); return; }
    if ((el = t.closest('.cam-rec'))) { list = rows(); load(list.indexOf(el)); return; }
    if ((el = t.closest('[data-p-step]'))) { load(idx + (+el.dataset.pStep)); return; }
    if (t.closest('[data-p-play]')) { play(); return; }
    if (t.closest('[data-p-toggle]')) { if (timer) stopPlay(); else play(); return; }
  });

  document.addEventListener('keydown', function (ev) {
    if (root.dataset.modalOpen !== 'cameras-player' || !list.length) return;
    if (ev.key === 'ArrowLeft' && idx < list.length - 1) { ev.preventDefault(); load(idx + 1); }
    if (ev.key === 'ArrowRight' && idx > 0) { ev.preventDefault(); load(idx - 1); }
  });

  // the dialog opened straight from markup (or a screenshot) shows the newest clip
  list = rows();
  if (list.length) load(0);
})();
