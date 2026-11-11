/* Roomba — Rosie on the map: Start a clean sends the dot room by room (rooms shade as they're done, the battery
   ring drains, the verdict and readouts follow), with Pause / Send home / Stop. Also fills the run-detail, clean-a-room
   and rename dialogs from the row that opened them, and opens Maintenance from the "dock bag" row. */
(function () {
  var screen = document.querySelector('section.screen[data-route="roomba"]');
  if (!screen || !window.Proto) return;
  function $(sel, el) { return (el || screen).querySelector(sel); }
  function $$(sel, el) { return Array.prototype.slice.call((el || screen).querySelectorAll(sel)); }
  function fmt(n) { return Math.round(n).toLocaleString('en-US'); }
  function lower(s) { return s.charAt(0).toLowerCase() + s.slice(1); }
  function the(room) { return 'the ' + lower(room); }

  /* ---------- the floor, in map metres (x across, y down) ---------- */
  var DOCK = [1.45, 6.5];
  var ROOMS = {
    'Living room': { area: 334, pts: [[1.2, 8.4], [5.4, 8.4], [5.4, 7.2], [1.2, 7.2], [1.2, 5.6], [5.4, 5.6], [5.4, 4.6], [1.2, 4.6]], go: [], back: [] },
    'Kitchen': { area: 196, pts: [[6.9, 7.0], [6.9, 8.4], [9.2, 8.4], [10.5, 6.6], [7.4, 5.8]], go: [[5.8, 7.0]], back: [[5.8, 7.0]] },
    'Hallway': { area: 101, pts: [[6.8, 4.6], [13.4, 4.6]], go: [[5.8, 4.6]], back: [[5.8, 4.6]] },
    'Office': { area: 172, pts: [[7.7, 3.2], [9.6, 3.2], [9.6, 0.8], [6.8, 0.8], [6.8, 3.2]], go: [[5.8, 4.6], [7.7, 4.6]], back: [[7.7, 4.6], [5.8, 4.6]] },
    'Bathroom': { area: 164, pts: [[11.85, 3.4], [13.4, 3.2], [13.4, 0.8], [10.8, 0.8], [10.8, 3.2]], go: [[5.8, 4.6], [11.85, 4.6]], back: [[11.85, 4.6], [5.8, 4.6]] },
    'Primary bedroom': { area: 267, pts: [[5.1, 3.2], [0.8, 3.2], [0.8, 2.2], [5.6, 2.2], [5.6, 0.6], [3.0, 0.6]], go: [[5.1, 4.6]], back: [[5.1, 3.4], [5.1, 4.6]] }
  };
  var ORDER = ['Living room', 'Kitchen', 'Hallway', 'Office', 'Bathroom', 'Primary bedroom'];
  function pct(p) { return [((p[0] + 0.4) / 14.8 * 100).toFixed(2) + '%', ((p[1] + 0.4) / 9.8 * 100).toFixed(2) + '%']; }

  var dot = $('[data-rb-dot]'), trail = $('[data-rb-trail]'), ring = $('[data-rb-ring]');
  var state = 'docked', plan = [], step = 0, elapsed = 0, timer = null, trailPts = [], area = 0, done = [], battery = 100, startedRooms = [], current = null;

  function place(p) { var c = pct(p); dot.style.setProperty('--x', c[0]); dot.style.setProperty('--y', c[1]); }
  function drawTrail() { trail.setAttribute('d', trailPts.length ? 'M' + trailPts.map(function (p) { return p[0] + ' ' + p[1]; }).join('L') : ''); }
  function setBattery(v, charging) {
    battery = Math.max(5, Math.min(100, Math.round(v)));
    $('[data-rb-batt]').innerHTML = battery + '<span class="unit">%</span>';
    $('[data-rb-batt-icon]').setAttribute('href', charging ? '#i-battery-charging' : battery <= 20 ? '#i-battery-low' : '#i-battery');
    ring.setAttribute('data-value', String(battery / 100));
    ring.setAttribute('data-tone', battery <= 20 ? 'warn' : 'ok');
    ring.classList.add('is-settled');
    if (window.FP) window.FP.render(ring);
  }
  function shade(list) {
    $$('.rb-map .map-room').forEach(function (r) {
      r.classList.toggle('is-active', list.some(function (n) { return n.toLowerCase() === r.dataset.room.toLowerCase(); }));
    });
  }
  function say(lamp, verdict, note) {
    $('[data-rb-lamp]').className = 'lamp lamp--' + lamp;
    $('[data-rb-verdict]').textContent = verdict;
    $('[data-rb-note]').textContent = note;
  }
  function readouts(l1, v1, u1, n1, l2, v2, u2, n2) {
    $('[data-rb-r1-label]').textContent = l1;
    $('[data-rb-r1]').innerHTML = v1 + '<span class="unit">' + u1 + '</span>';
    $('[data-rb-r1-note]').textContent = n1;
    $('[data-rb-r2-label]').textContent = l2;
    $('[data-rb-r2]').innerHTML = v2 + '<span class="unit">' + u2 + '</span>';
    $('[data-rb-r2-note]').textContent = n2;
  }
  function keys(which) {
    $$('[data-rb-keys]').forEach(function (k) { k.hidden = k.dataset.rbKeys !== which; });
  }
  function minutes() { return Math.max(1, Math.round(elapsed * 2.2)); }
  function progressNote() {
    return 'Started from the app at 5:00 PM. ' + fmt(area) + ' sq ft so far.';
  }
  function liveReadouts() {
    var total = startedRooms.length;
    var next = startedRooms.filter(function (r) { return done.indexOf(r) < 0 && r !== current; })[0];
    readouts('This clean', fmt(area), 'sq ft', minutes() + ' min so far',
      'Rooms done', done.length + ' of ' + total, '', next ? 'Next: ' + lower(next) : 'Last room');
  }

  /* ---------- the clean ---------- */
  function buildPlan(rooms) {
    var p = [];
    rooms.forEach(function (name) {
      var r = ROOMS[name];
      r.go.forEach(function (q) { p.push({ at: q }); });
      r.pts.forEach(function (q) { p.push({ at: q, room: name, area: r.area / r.pts.length }); });
      r.back.forEach(function (q) { p.push({ at: q }); });
    });
    p.push({ at: DOCK, home: true });
    return p;
  }
  function start(rooms) {
    clearInterval(timer);
    startedRooms = rooms.slice();
    plan = buildPlan(rooms);
    step = 0; elapsed = 0; area = 0; done = []; current = null;
    trailPts = [DOCK.slice()];
    drawTrail();
    shade([]);
    $('[data-rb-legend-done]').textContent = 'Cleaned this time';
    state = 'running';
    keys('running');
    setPaused(false);
    say('ok', 'Rosie is setting off.', progressNote());
    liveReadouts();
    timer = setInterval(tick, 950);
  }
  function tick() {
    if (state !== 'running' && state !== 'returning') return;
    var s = plan[step];
    if (!s) return;
    elapsed++;
    place(s.at);
    trailPts.push(s.at.slice());
    drawTrail();
    if (s.room) {
      if (current && current !== s.room && done.indexOf(current) < 0) done.push(current);
      current = s.room;
      area += s.area;
      shade(done.concat([current]));
      if (step % 2 === 0) setBattery(battery - 1, false);
      say('ok', 'Rosie is cleaning ' + the(current) + '.', progressNote());
      liveReadouts();
    }
    if (s.home) { arrive(); return; }
    if (state === 'running' && !s.room && current && plan.slice(step + 1).every(function (q) { return !q.room; })) {
      if (done.indexOf(current) < 0) done.push(current);
      current = null;
      say('ok', 'Rosie is heading back to the dock.', 'All done: ' + fmt(area) + ' sq ft in ' + minutes() + ' min.');
      liveReadouts();
    }
    step++;
  }
  function arrive() {
    clearInterval(timer);
    if (current && done.indexOf(current) < 0 && state === 'running') done.push(current);
    var cleaned = area, mins = minutes();
    state = 'docked';
    current = null;
    keys('docked');
    setBattery(battery, true);
    say('warn', 'Rosie is back, but her dock bag is full.', 'She cleaned ' + fmt(cleaned) + ' sq ft in ' + mins + ' min and is charging now. Fit a new bag before the weekday tidy, tomorrow at 9:00 AM.');
    readouts('Last clean', fmt(cleaned), 'sq ft', 'Just now, ' + mins + ' min',
      'Next clean', '9:00', 'AM', 'Tomorrow, weekday tidy');
    shade(done);
    Proto.toast('Rosie is back on the dock');
  }
  function goHome(msg) {
    clearInterval(timer);
    var here = plan[Math.max(0, step - 1)];
    var room = here && here.room;
    if (current && done.indexOf(current) < 0) done.push(current);
    var back = room ? ROOMS[room].back : [];
    plan = back.map(function (q) { return { at: q }; }).concat([{ at: DOCK, home: true }]);
    step = 0;
    current = null;
    state = 'returning';
    keys('running');
    setPaused(false);
    say('ok', 'Rosie is heading back to the dock.', msg || ('She cleaned ' + fmt(area) + ' sq ft before you sent her home.'));
    timer = setInterval(tick, 950);
  }
  function setPaused(p) {
    $('[data-rb-pause-word]').textContent = p ? 'Resume' : 'Pause';
    $('[data-rb-pause-icon]').setAttribute('href', p ? '#i-play' : '#i-pause');
  }
  function pause() {
    if (state === 'running') {
      state = 'paused';
      setPaused(true);
      say('info', 'Rosie is paused in ' + (current ? the(current) : 'the hall') + '.', 'She’ll wait there until you resume or send her home.');
      Proto.toast('Rosie paused');
    } else if (state === 'paused' || state === 'stopped') {
      state = 'running';
      setPaused(false);
      say('ok', 'Rosie is cleaning ' + (current ? the(current) : 'again') + '.', progressNote());
      Proto.toast('Rosie is cleaning again');
    }
  }
  function stopHere() {
    if (state === 'docked') return;
    state = 'stopped';
    setPaused(true);
    say('info', 'Rosie stopped in ' + (current ? the(current) : 'the hall') + '.', 'She’ll stay put until you send her home or start again. ' + fmt(area) + ' sq ft cleaned.');
    Proto.toast('Rosie stopped');
  }

  /* ---------- dialogs filled from the row that opened them ---------- */
  function fillRun(data) {
    var d = JSON.parse(data);
    $$('[data-modal="roomba-run"] [data-r]').forEach(function (el) { el.textContent = d[el.dataset.r] || '—'; });
    var badge = $('[data-r-badge]');
    badge.textContent = d.status;
    badge.className = 'badge badge--' + d.tone;
    ['charge', 'settings', 'bins', 'err'].forEach(function (k) {
      var row = $('[data-modal="roomba-run"] [data-r-row="' + k + '"]');
      if (row) row.hidden = !d[k];
    });
  }
  function pickedRooms() {
    return $$('.rb-pick input:checked').map(function (i) { return i.value; });
  }
  function pickSummary() {
    var r = pickedRooms();
    var el = $('[data-rb-pick-sum]');
    var go = $('[data-rb-start]');
    if (!r.length) { el.textContent = 'Pick at least one room.'; }
    else {
      var names = r.map(lower);
      var list = names.length > 1 ? names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1] : names[0];
      el.textContent = r.length + (r.length === 1 ? ' room' : ' rooms') + ' picked: ' + list;
    }
    var scopePick = $('[data-tabs="roomba-scope"] [data-tab="pick"]').classList.contains('is-active');
    go.disabled = scopePick && !r.length;
  }
  var roomTarget = 'Kitchen';

  /* ---------- events ---------- */
  screen.addEventListener('click', function (ev) {
    var t = ev.target, el;
    if ((el = t.closest('[data-rb-upkeep]'))) {
      ev.preventDefault();
      Proto.selectTab('roomba-view', 'maintenance');
      var seg = $('[data-tabs="roomba-view"]');
      if (seg && seg.scrollIntoView) seg.scrollIntoView({ block: 'start', behavior: 'smooth' });
      return;
    }
    if ((el = t.closest('[data-run]'))) { fillRun(el.dataset.run); return; }
    if ((el = t.closest('[data-open-modal="roomba-room"]'))) {
      roomTarget = el.dataset.room;
      $('[data-rb-room-title]').textContent = 'Clean ' + the(roomTarget);
      return;
    }
    if ((el = t.closest('[data-open-modal="roomba-rename"]'))) {
      $('[data-rb-rename-title]').textContent = 'Rename ' + the(el.dataset.room);
      $('[data-rb-rename-input]').value = el.dataset.room;
      var sel = $('[data-rb-rename-type]');
      Array.prototype.forEach.call(sel.options, function (o, i) { if (o.text === el.dataset.type) sel.selectedIndex = i; });
      return;
    }
    if (t.closest('[data-tabs="roomba-scope"] [data-tab]')) { setTimeout(pickSummary, 0); return; }
    if (t.closest('[data-rb-start]')) {
      var scopePick = $('[data-tabs="roomba-scope"] [data-tab="pick"]').classList.contains('is-active');
      var rooms = scopePick ? ORDER.filter(function (r) { return pickedRooms().indexOf(r) >= 0; }) : ORDER.slice();
      if (!rooms.length) return;
      start(rooms);
      Proto.toast(scopePick ? 'Rosie is off to ' + rooms.map(lower).join(', ') : 'Rosie is setting off to clean the house');
      return;
    }
    if (t.closest('[data-rb-start-room]')) {
      start([roomTarget]);
      Proto.toast('Rosie is off to ' + the(roomTarget));
      return;
    }
    if (t.closest('[data-rb-rename-save]')) {
      Proto.toast('Renamed to ' + ($('[data-rb-rename-input]').value || 'the room'));
      return;
    }
    if ((el = t.closest('[data-rb-done]'))) { Proto.toast(el.dataset.rbDone); return; }
    if (t.closest('[data-rb-pause]')) { pause(); return; }
    if (t.closest('[data-rb-home]')) { if (state !== 'docked') { goHome(); Proto.toast('Rosie is heading home'); } return; }
    if (t.closest('[data-rb-stop]')) { stopHere(); return; }
  });

  screen.addEventListener('change', function (ev) {
    if (ev.target.closest('.rb-pick')) pickSummary();
    if (ev.target.matches('[data-rb-ack]')) {
      var dlg = ev.target.closest('.dialog');
      var go = $('[data-rb-needs-ack]', dlg);
      if (go) go.disabled = !ev.target.checked;
    }
  });

  // leaving the page doesn't stop Rosie, but the sweep of the battery ring only plays on the first visit
  place(DOCK);
})();
