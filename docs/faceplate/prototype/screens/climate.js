/* Climate — the thermostat faceplate: − / + keys, mode keys, comfort chips and Resume schedule, with the dial,
   verdict and "Last change" following along. Upstairs was changed by Mai 4 minutes ago, so the first change
   there asks first (climate-confirm); after "Change anyway" further taps go straight through. */
(function () {
  var screen = document.querySelector('section.screen[data-route="climate"]');
  if (!screen || !window.Proto) return;

  var MIN = 45, MAX = 92, GAP = 3;
  var NAMES = { home: 'Home', away: 'Away', sleep: 'Sleep', away_indefinitely: 'Away until resumed' };
  var MODES = { auto: 'Auto', heat: 'Heat', cool: 'Cool', off: 'Off' };
  var floors = {
    down: { key: 'down', name: 'Downstairs', mode: 'auto', heat: 68, cool: 75, temp: 70.6, comfort: 'home', hold: null, recent: false,
      sched: { home: [68, 75], sleep: [66, 76], away: [62, 80], away_indefinitely: [62, 80] }, next: ['10:00', 'PM', 'Sleep, 66–76°'] },
    up: { key: 'up', name: 'Upstairs', mode: 'heat', heat: 70, cool: 75, temp: 68.6, comfort: null, hold: 'mai', recent: true,
      sched: { home: [68, 75], sleep: [66, 76], away: [62, 80], away_indefinitely: [62, 80] }, next: ['10:00', 'PM', 'Sleep, heat to 66°'] }
  };
  var pending = null;
  var armed = null, armTimer = null;

  function panel(k) { return screen.querySelector('[data-floor="' + k + '"]'); }
  function q(k, sel) { return panel(k).querySelector(sel); }
  function qa(k, sel) { return Array.prototype.slice.call(panel(k).querySelectorAll(sel)); }
  function clamp(v) { return Math.max(MIN, Math.min(MAX, v)); }
  function running(f) {
    if (f.mode === 'off') return 'off';
    if ((f.mode === 'heat' || f.mode === 'auto') && f.temp < f.heat) return 'heating';
    if ((f.mode === 'cool' || f.mode === 'auto') && f.temp > f.cool) return 'cooling';
    return 'idle';
  }

  function rings(f) {
    var lo = 60, hi = 85, segs = [], marks = [];
    var c = function (v) { return Math.max(lo, Math.min(hi, v)); };
    if (f.mode === 'auto' || f.mode === 'heat') { segs.push({ from: lo, to: c(f.heat), tone: 'heat' }); marks.push({ at: c(f.heat), tone: 'heat' }); }
    if (f.mode === 'auto' || f.mode === 'cool') { segs.push({ from: c(f.cool), to: hi, tone: 'cool' }); marks.push({ at: c(f.cool), tone: 'cool' }); }
    return [{ r: 86, w: 10, min: lo, max: hi, ticks: 25, major: 5, labels: [[60, '60°'], [85, '85°']], segments: segs, marks: marks, needle: { at: f.temp } }];
  }

  function render(k, redrawDial) {
    var f = floors[k];
    var run = running(f);
    var t = Math.round(f.temp);
    var setTo = f.mode === 'cool' ? f.cool : f.heat;

    // dial
    if (redrawDial) {
      var dial = q(k, '[data-dial]');
      dial.classList.add('is-settled');
      dial.setAttribute('data-rings', JSON.stringify(rings(f)));
      if (window.FP) window.FP.render(dial);
    }
    var note = run === 'off' ? 'System off' : run === 'heating' ? 'Heating to ' + f.heat + '°' : run === 'cooling' ? 'Cooling to ' + f.cool + '°'
      : f.mode === 'auto' ? 'Idle · ' + f.heat + '–' + f.cool + '°' : 'Idle · holding ' + setTo + '°';
    q(k, '[data-dial-note]').textContent = note;
    q(k, '[data-dial-sr]').textContent = f.name + ' is ' + f.temp + ' degrees. ' + note.replace('°', ' degrees') + '.';

    // legend + setpoint rows
    var showHeat = f.mode === 'auto' || f.mode === 'heat';
    var showCool = f.mode === 'auto' || f.mode === 'cool';
    q(k, '[data-set="heat"]').hidden = !showHeat;
    q(k, '[data-set="cool"]').hidden = !showCool;
    q(k, '[data-set="off"]').hidden = f.mode !== 'off';
    q(k, '[data-val="heat"]').textContent = f.heat + '°';
    q(k, '[data-val="cool"]').textContent = f.cool + '°';

    // mode keys + comfort chips
    qa(k, '[data-mode]').forEach(function (b) {
      var on = b.dataset.mode === f.mode;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-checked', String(on));
      if (b !== armed) b.textContent = MODES[b.dataset.mode];
    });
    qa(k, '[data-comfort]').forEach(function (b) {
      var on = b.dataset.comfort === f.comfort;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-checked', String(on));
    });

    // hold notice
    var hold = q(k, '[data-hold]');
    hold.hidden = !f.hold;
    var hs = q(k, '[data-hold-seg]');
    if (hs) { hs.hidden = !f.hold; hs.style.setProperty('--from', f.hold === 'mai' ? '16.93' : '17'); }
    if (f.hold) {
      q(k, '[data-hold-title]').textContent = f.hold === 'mai' ? 'Holding 70° for Mai.' : f.hold === 'comfort' ? 'Holding ' + NAMES[f.comfort] + '.' : 'Holding your change.';
    }

    // verdict
    var lamp = q(k, '[data-verdict-lamp]');
    lamp.className = 'lamp ' + (run === 'off' ? 'lamp--info' : 'lamp--ok');
    q(k, '[data-verdict]').textContent =
      run === 'off' ? t + '°, and the system is off.' :
      run === 'heating' ? t + '° and warming up to ' + f.heat + '°.' :
      run === 'cooling' ? t + '° and cooling to ' + f.cool + '°.' :
      f.mode === 'auto' ? t + '° and comfortable.' : t + '° and holding at ' + setTo + '°.';
    var why =
      run === 'off' ? 'Nothing will heat or cool ' + f.name + ' until someone picks a mode.' :
      run === 'heating' ? 'The heat stays on until it reaches ' + f.heat + '°.' :
      run === 'cooling' ? 'The cooling stays on until it is down to ' + f.cool + '°.' :
      f.mode === 'auto' ? 'Auto keeps it between ' + f.heat + '° and ' + f.cool + '°, so nothing is running right now.' :
      'It is already at ' + setTo + '°, so the system is resting.';
    if (f.hold) why += ' The schedule is paused until someone resumes it.';
    q(k, '[data-verdict-note]').textContent = why;

    // next change / schedule readout
    var nx = q(k, '[data-next]');
    nx.innerHTML = f.hold
      ? '<span class="label">Schedule</span><span class="readout-value"><span class="num">Paused</span></span><span class="readout-note">' +
        (f.hold === 'mai' ? 'Holding 70° for Mai' : f.hold === 'comfort' ? 'Holding ' + NAMES[f.comfort] : 'Holding your change') + '</span>'
      : '<span class="label">Next change</span><span class="readout-value"><span class="num">' + f.next[0] + '<span class="unit">' + f.next[1] + '</span></span></span><span class="readout-note">' + f.next[2] + '</span>';
  }

  function setLast(k, what) {
    var row = q(k, '[data-last]');
    row.innerHTML = '<li><div class="row row--compact"><span class="avatar" style="--who: var(--person-bryan)" aria-hidden="true">BR</span>' +
      '<span class="row-main"><span class="row-title">Set by you</span><span class="row-meta">5:00 PM · just now · from the app</span></span></div></li>';
    var list = q(k, '[data-changes]');
    var li = document.createElement('li');
    li.className = 'tl-item';
    li.innerHTML = '<span class="tl-time">5:00 PM</span><span class="lamp lamp--info"></span><div class="tl-body"><p class="tl-title">You ' + what + '</p><p class="tl-meta">From the app</p></div>';
    var first = list.querySelector('.tl-item');
    if (first && first.dataset.mine) list.replaceChild(li, first); else list.insertBefore(li, first);
    li.dataset.mine = '1';
  }

  // the status line under the keys: Sending in a moment… -> Updating thermostat… -> Upstairs set to 71°
  var timers = {};
  function send(k, msg, valueKey, whatOverride) {
    var f = floors[k];
    var st = q(k, '[data-status]');
    var out = valueKey ? q(k, '[data-val="' + valueKey + '"]') : null;
    clearTimeout(timers[k + 'a']); clearTimeout(timers[k + 'b']); clearTimeout(timers[k + 'c']);
    if (out) out.classList.add('is-draft');
    st.textContent = msg || 'Sending in a moment…';
    timers[k + 'a'] = setTimeout(function () {
      st.textContent = 'Updating thermostat…';
      timers[k + 'b'] = setTimeout(function () {
        qa(k, '.stepper-value').forEach(function (o) { o.classList.remove('is-draft'); });
        var what = whatOverride || (f.mode === 'auto' ? 'set ' + f.heat + '–' + f.cool + '°' : f.mode === 'off' ? 'turned it off' : 'set it to ' + (f.mode === 'cool' ? f.cool : f.heat) + '°');
        st.textContent = f.name + (f.mode === 'off' ? ' is off.' : f.mode === 'auto' ? ' set to ' + f.heat + '–' + f.cool + '°.' : ' set to ' + (f.mode === 'cool' ? f.cool : f.heat) + '°.');
        setLast(k, what);
        timers[k + 'c'] = setTimeout(function () { st.textContent = ''; }, 2600);
      }, 1300);
    }, 1200);
  }
  function nudge(k, which) {
    var row = q(k, '[data-set="' + which + '"]');
    row.classList.remove('is-nudged'); void row.offsetWidth; row.classList.add('is-nudged');
  }

  // ---------- actions ----------
  function step(k, which, dir) {
    var f = floors[k];
    var msg = null, moved = null;
    var nv = f[which] + dir;
    if (nv < MIN || nv > MAX) {
      q(k, '[data-status]').textContent = dir > 0 ? 'Can’t go higher — ' + MAX + '° is the limit.' : 'Can’t go lower — ' + MIN + '° is the limit.';
      return;
    }
    if (f.mode === 'auto') {
      if (which === 'heat' && nv > f.cool - GAP) {
        if (nv + GAP > MAX) { q(k, '[data-status]').textContent = 'Can’t go higher — cool-to is at the ' + MAX + '° limit.'; return; }
        f.cool = nv + GAP; moved = 'cool'; msg = 'Cool to moved to ' + f.cool + '° to keep a 3° gap.';
      }
      if (which === 'cool' && nv < f.heat + GAP) {
        if (nv - GAP < MIN) { q(k, '[data-status]').textContent = 'Can’t go lower — heat-to is at the ' + MIN + '° limit.'; return; }
        f.heat = nv - GAP; moved = 'heat'; msg = 'Heat to moved to ' + f.heat + '° to keep a 3° gap.';
      }
    }
    f[which] = nv;
    f.hold = 'you'; f.comfort = null;
    render(k, true);
    if (moved) nudge(k, moved);
    send(k, msg, which);
  }
  function setMode(k, m, btn) {
    var f = floors[k];
    if (m === f.mode) return;
    if (m === 'off' && armed !== btn) {
      clearTimeout(armTimer);
      if (armed) armed.textContent = MODES[armed.dataset.mode];
      armed = btn; btn.textContent = 'Tap again';
      btn.classList.add('clim-armed');
      armTimer = setTimeout(function () { btn.textContent = 'Off'; btn.classList.remove('clim-armed'); armed = null; }, 3000);
      return;
    }
    clearTimeout(armTimer);
    if (armed) { armed.classList.remove('clim-armed'); armed = null; }
    f.mode = m;
    render(k, true);
    Proto.toast(m === 'off' ? f.name + ' is turning off' : f.name + ' switched to ' + MODES[m]);
    send(k, null, null, m === 'off' ? 'turned it off' : 'switched it to ' + MODES[m]);
  }
  function setComfort(k, c) {
    var f = floors[k];
    f.comfort = c; f.hold = 'comfort';
    f.heat = f.sched[c][0]; f.cool = f.sched[c][1];
    render(k, true);
    Proto.toast(f.name + ' is holding ' + NAMES[c]);
    send(k, null, null, 'held ' + NAMES[c]);
  }
  function resume(k) {
    var f = floors[k];
    f.hold = null; f.comfort = 'home';
    f.heat = f.sched.home[0]; f.cool = f.sched.home[1];
    render(k, true);
    Proto.toast(f.name + ' is back on its schedule');
    send(k, null, null, 'resumed the schedule');
  }

  function describe(k, el) {
    var f = floors[k];
    if (el.dataset.step) {
      var v = f[el.dataset.step] + (+el.dataset.dir);
      return (+el.dataset.dir > 0 ? 'Raise' : 'Lower') + ' it to ' + v + '° anyway? Mai may have had a reason.';
    }
    if (el.dataset.mode) return 'Switch it to ' + MODES[el.dataset.mode] + ' anyway?';
    if (el.dataset.comfort) return 'Hold ' + NAMES[el.dataset.comfort] + ' anyway?';
    if (el.hasAttribute('data-resume')) return 'Put it back on the schedule anyway? That replaces Mai’s 70°.';
    return 'Change it anyway?';
  }
  function act(k, el) {
    if (el.dataset.step) return step(k, el.dataset.step, +el.dataset.dir);
    if (el.dataset.mode) return setMode(k, el.dataset.mode, el);
    if (el.dataset.comfort) return setComfort(k, el.dataset.comfort);
    if (el.hasAttribute('data-resume')) return resume(k);
  }

  document.addEventListener('click', function (ev) {
    var go = ev.target.closest('[data-confirm-go]');
    if (go && screen.contains(go)) {
      floors.up.recent = false;
      panel('up').querySelectorAll('[data-open-modal="climate-confirm"]').forEach(function (b) { b.removeAttribute('data-open-modal'); });
      if (pending) { var p = pending; pending = null; act('up', p); }
      return;
    }
    var el = ev.target.closest('[data-step],[data-mode],[data-comfort],[data-resume]');
    if (!el || !screen.contains(el)) return;
    var host = el.closest('[data-floor]');
    if (!host) return;
    var k = host.dataset.floor;
    if (Proto.state.role === 'guest') return;
    if (floors[k].recent) {
      // the runtime has opened climate-confirm for us; remember what was asked
      pending = el;
      var ask = screen.querySelector('[data-confirm-ask]');
      if (ask) ask.textContent = describe(k, el);
      return;
    }
    act(k, el);
  });
  document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') pending = null; });

  var lastRoute = null;
  function roles(state) {
    var guest = state.role === 'guest';
    screen.querySelectorAll('[data-guest-only]').forEach(function (b) { b.hidden = !guest; });
    // the needle sweeps in again each time the page is opened, not on every theme or role change
    if (state.route === 'climate' && lastRoute !== 'climate') screen.querySelectorAll('[data-dial]').forEach(function (d) { d.classList.remove('is-settled'); });
    lastRoute = state.route;
  }
  Proto.onChange(roles);
  roles(Proto.state);
})();
