/* Faceplate charts — draws inline SVG/HTML charts from data-* attributes.
   Nothing here measures the DOM at render time (screens are hidden when this runs):
   - lines/areas/bands: SVG viewBox 1000 x H, preserveAspectRatio="none", strokes non-scaling,
     dots are zero-length round-capped strokes (stay round at any width);
   - text (axes, flags, readouts) is HTML positioned by percentage;
   - bars/stacks/heat/diverging rows are HTML;
   - dials/rings are square SVG (viewBox 240) with an HTML centre.
   Colours are CSS custom properties, so a theme switch needs no re-render.
   API: window.FP.render(el) / window.FP.renderAll(root). See KIT.md "Charts". */
(function () {
  'use strict';
  var NS = 'http://www.w3.org/2000/svg';
  var TONE = {
    ink: '--chart-ink', graphite: '--chart-graphite', soft: '--chart-soft', heat: '--chart-heat', cool: '--chart-cool',
    water: '--chart-water', gas: '--chart-gas', ok: '--lamp-ok', warn: '--lamp-warn', problem: '--lamp-problem',
    info: '--lamp-info', day: '--dial-day', night: '--dial-night', track: '--dial-track', empty: '--chart-empty', band: '--chart-band'
  };
  var uid = 0;

  function tone(t) { return 'var(' + (TONE[t] || TONE.ink) + ')'; }
  function attr(el, name, def) {
    var v = el.getAttribute('data-' + name);
    if (v == null || v === '') return def;
    try { return JSON.parse(v); } catch (e) { return v; }
  }
  function S(tag, a) {
    var n = document.createElementNS(NS, tag);
    if (a) for (var k in a) if (a[k] != null) n.setAttribute(k, a[k]);
    return n;
  }
  function H(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function fmt(v, dec) {
    if (v == null || isNaN(v)) return '—';
    return Number(v).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
  }
  function money(v, prefix, dec, unit) {
    var neg = v < 0;
    var s = (neg ? '−' : '') + (prefix || '') + fmt(Math.abs(v), dec);
    return unit ? s + (/^[%°]/.test(unit) ? '' : ' ') + unit : s;
  }
  function niceStep(span, count) {
    var raw = span / Math.max(1, count);
    var mag = Math.pow(10, Math.floor(Math.log10(raw)));
    var r = raw / mag;
    return (r <= 1 ? 1 : r <= 2 ? 2 : r <= 2.5 ? 2.5 : r <= 5 ? 5 : 10) * mag;
  }
  function ticksFor(lo, hi, count, zero) {
    if (zero && lo > 0) lo = 0;
    if (hi === lo) { hi = lo + 1; }
    var step = niceStep(hi - lo, count);
    var a = Math.floor(lo / step) * step, b = Math.ceil(hi / step) * step;
    var out = [];
    for (var v = a; v <= b + step / 1e6; v += step) out.push(Math.round(v * 1e6) / 1e6);
    return out;
  }
  function lineKey(t, dash, kind) {
    var k = H('span', 'lg-key' + (dash ? ' lg-key--dash' : '') + (kind ? ' lg-key--' + kind : ''));
    k.style.setProperty('--c', tone(t));
    return k;
  }
  function legendItem(text, t, dash, kind) {
    var it = H('span', 'lg-item');
    it.appendChild(lineKey(t, dash, kind));
    it.appendChild(document.createTextNode(text));
    return it;
  }
  function pct(x) { return (Math.round(x * 1000) / 10) + '%'; }

  /* ---------- shared frame: head (legend + readout) + plot ---------- */
  function frame(el, h, opts) {
    // keep the screen-reader caption (KIT §8): it is authored inside the chart element
    var cap = el.__fpCaption || el.querySelector(':scope > figcaption');
    el.__fpCaption = cap;
    el.textContent = '';
    if (cap) el.appendChild(cap);
    el.classList.add('chart');
    var head = H('div', 'chart-head');
    var legend = H('div', 'chart-legend');
    var readout = H('div', 'chart-readout');
    readout.setAttribute('aria-live', 'polite');
    head.appendChild(legend);
    if (!opts || opts.readout !== false) head.appendChild(readout);
    el.appendChild(head);
    var plot = H('div', 'chart-plot');
    plot.style.setProperty('--plot-h', h + 'px');
    if (opts && opts.gutter != null) plot.style.setProperty('--y-gutter', opts.gutter + 'px');
    el.appendChild(plot);
    return { legend: legend, readout: readout, plot: plot };
  }

  function xTicks(plot, n, labels, short, pos, every) {
    var list = [];
    if (short && short.length) {
      short.forEach(function (s, i) { if (s) list.push([i, s]); });
    } else if (labels.length) {
      var k = every || Math.max(1, Math.ceil(n / 6));
      for (var i = 0; i < n; i += k) list.push([i, labels[i]]);
    }
    list.forEach(function (p, k) {
      var x = pos(p[0]);
      var t = H('span', 'chart-x' + (list.length > 4 && k % 2 === 1 ? ' chart-x--alt' : ''), p[1]);
      t.style.left = pct(x);
      if (x < 0.04) t.classList.add('chart-x--start');
      else if (x > 0.96) t.classList.add('chart-x--end');
      plot.appendChild(t);
    });
  }

  function yTicks(plot, svgEl, ticks, Y, h, fmtTick, grid) {
    ticks.forEach(function (t, i) {
      var y = Y(t);
      if (grid !== false) svgEl.appendChild(S('line', { x1: 0, x2: 1000, y1: y, y2: y, 'class': i === 0 ? 'ch-base' : 'ch-grid' }));
      var lab = H('span', 'chart-y', fmtTick(t));
      lab.style.top = pct(y / h);
      plot.appendChild(lab);
    });
  }

  function wireScrub(plot, n, xFrac, setIndex, initial, el) {
    var current = initial;
    plot.tabIndex = 0;
    function at(clientX) {
      var r = plot.getBoundingClientRect();
      if (!r.width) return current;
      var f = (clientX - r.left) / r.width;
      var best = 0, bd = 9;
      for (var i = 0; i < n; i++) { var d = Math.abs(xFrac(i) - f); if (d < bd) { bd = d; best = i; } }
      return best;
    }
    function go(i, scrubbing) { current = Math.max(0, Math.min(n - 1, i)); setIndex(current, scrubbing); broadcast(el, current); }
    plot.addEventListener('pointermove', function (e) { go(at(e.clientX), true); });
    plot.addEventListener('pointerdown', function (e) { go(at(e.clientX), true); });
    plot.addEventListener('pointerleave', function () { go(initial, false); });
    plot.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); go(current + (e.key === 'ArrowRight' ? 1 : -1), true); }
      if (e.key === 'Home') { e.preventDefault(); go(0, true); }
      if (e.key === 'End') { e.preventDefault(); go(n - 1, true); }
    });
    plot.addEventListener('blur', function () { go(initial, false); });
    el._fpSet = function (i, s) { current = i; setIndex(i, s); };
  }
  function broadcast(el, i) {
    var g = el.getAttribute('data-sync');
    if (!g) return;
    document.querySelectorAll('[data-sync="' + g + '"]').forEach(function (o) {
      if (o !== el && o._fpSet) o._fpSet(Math.min(i, (o._fpN || 1) - 1), true);
    });
  }

  /* ---------- line / area ---------- */
  function line(el) {
    var series = attr(el, 'series', []);
    var labels = attr(el, 'labels', []);
    var short = attr(el, 'short', null);
    var n = labels.length || (series[0] ? series[0].values.length : 0);
    var h = +attr(el, 'height', 180);
    var unit = attr(el, 'unit', '');
    var prefix = attr(el, 'prefix', '');
    var dec = +attr(el, 'decimals', 1);
    var band = attr(el, 'band', null);
    var today = attr(el, 'today', null);
    var refs = attr(el, 'refs', null);
    var every = attr(el, 'tick-every', null);
    var tickFmt = attr(el, 'tick-format', null);
    var all = [];
    series.forEach(function (s) { s.values.forEach(function (v) { if (v != null) all.push(v); }); });
    if (band) { band.lower.forEach(function (v) { if (v != null) all.push(v); }); band.upper.forEach(function (v) { if (v != null) all.push(v); }); }
    var lo = attr(el, 'y-min', null), hi = attr(el, 'y-max', null);
    if (lo == null) lo = Math.min.apply(null, all);
    if (hi == null) hi = Math.max.apply(null, all);
    var ticks = ticksFor(lo, hi, +attr(el, 'y-ticks', 4), attr(el, 'zero', false));
    lo = ticks[0]; hi = ticks[ticks.length - 1];
    var W = 1000;
    var X = function (i) { return n > 1 ? (i / (n - 1)) * W : W / 2; };
    var Y = function (v) { return h - ((v - lo) / (hi - lo)) * h; };
    var f = frame(el, h, { gutter: attr(el, 'gutter', null) });
    var svg = S('svg', { viewBox: '0 0 ' + W + ' ' + h, preserveAspectRatio: 'none', 'aria-hidden': 'true' });
    f.plot.appendChild(svg);
    yTicks(f.plot, svg, ticks, Y, h, function (t) {
      return tickFmt === 'money' ? prefix + fmt(t, 0) : fmt(t, t % 1 ? 1 : 0) + (attr(el, 'tick-unit', '') || '');
    });

    if (band) {
      var top = [], bot = [];
      for (var i = 0; i < n; i++) {
        if (band.lower[i] == null || band.upper[i] == null) continue;
        top.push(X(i) + ' ' + Y(band.upper[i]));
        bot.unshift(X(i) + ' ' + Y(band.lower[i]));
      }
      if (top.length) svg.appendChild(S('path', { d: 'M' + top.join(' L') + ' L' + bot.join(' L') + ' Z', 'class': 'ch-band' }));
      f.legend.appendChild(legendItem(band.name || 'Likely range', 'band', false, 'band'));
    }
    if (refs) refs.forEach(function (r) {
      svg.appendChild(S('line', { x1: 0, x2: W, y1: Y(r.at), y2: Y(r.at), 'class': 'ch-ref' }));
    });
    if (today != null) {
      var tx = X(today);
      svg.appendChild(S('line', { x1: tx, x2: tx, y1: 0, y2: h, 'class': 'ch-today' }));
      var flag = H('span', 'chart-flag', attr(el, 'today-label', 'Today'));
      flag.style.left = pct(tx / W);
      f.plot.appendChild(flag);
      f.plot.classList.add('chart-plot--flagged');
    }
    series.forEach(function (s) {
      var segs = [], cur = [];
      s.values.forEach(function (v, i) {
        if (v == null) { if (cur.length) segs.push(cur); cur = []; } else cur.push([X(i), Y(v)]);
      });
      if (cur.length) segs.push(cur);
      segs.forEach(function (pts) {
        if (s.area) {
          var a = 'M' + pts[0][0] + ' ' + Y(lo) + ' L' + pts.map(function (p) { return p[0] + ' ' + p[1]; }).join(' L') + ' L' + pts[pts.length - 1][0] + ' ' + Y(lo) + ' Z';
          var ar = S('path', { d: a, 'class': 'ch-area' });
          ar.style.fill = tone(s.tone);
          svg.appendChild(ar);
        }
        var p = S('path', {
          d: 'M' + pts.map(function (q) { return q[0] + ' ' + q[1]; }).join(' L'),
          'class': 'ch-line' + (s.dash ? ' ch-line--dash' : '') + (s.thin ? ' ch-line--thin' : '')
        });
        p.style.stroke = tone(s.tone);
        svg.appendChild(p);
      });
      if (s.dots) s.values.forEach(function (v, i) {
        if (v == null) return;
        svg.appendChild(S('path', { d: 'M' + X(i) + ' ' + Y(v) + ' h0', 'class': 'ch-dot-ring' }));
        var d = S('path', { d: 'M' + X(i) + ' ' + Y(v) + ' h0', 'class': 'ch-dot' });
        d.style.stroke = tone(s.tone);
        svg.appendChild(d);
      });
      if (s.legend !== false && (series.length > 1 || band)) f.legend.appendChild(legendItem(s.name, s.tone, s.dash));
    });
    if (today != null && attr(el, 'today-legend', true) !== false && series.length > 1) {
      var tl = H('span', 'lg-item'); tl.appendChild(H('span', 'lg-key lg-key--today')); tl.appendChild(document.createTextNode(attr(el, 'today-label', 'Today'))); f.legend.appendChild(tl);
    }
    xTicks(f.plot, n, labels, short, function (i) { return X(i) / W; }, every);

    // hover layer
    var cursor = S('line', { x1: 0, x2: 0, y1: 0, y2: h, 'class': 'ch-cursor' });
    svg.appendChild(cursor);
    var hot = S('g', { 'class': 'ch-hot' });
    svg.appendChild(hot);
    var initial = attr(el, 'readout', null);
    if (initial == null) {
      initial = n - 1;
      var s0 = series[0];
      if (s0) for (var k = n - 1; k >= 0; k--) if (s0.values[k] != null) { initial = k; break; }
    }
    function set(i, scrubbing) {
      f.plot.classList.toggle('is-scrubbing', !!scrubbing);
      cursor.setAttribute('x1', X(i)); cursor.setAttribute('x2', X(i));
      hot.textContent = '';
      f.readout.textContent = '';
      f.readout.appendChild(H('span', 'rd-when', labels[i] != null ? labels[i] : ''));
      series.forEach(function (s) {
        var v = s.values[i];
        if (v != null) {
          hot.appendChild(S('path', { d: 'M' + X(i) + ' ' + Y(v) + ' h0', 'class': 'ch-dot-ring' }));
          var d = S('path', { d: 'M' + X(i) + ' ' + Y(v) + ' h0', 'class': 'ch-dot' });
          d.style.stroke = tone(s.tone);
          hot.appendChild(d);
        }
        if (v == null && s.skipEmpty !== false) return;
        var it = H('span', 'rd-item');
        it.appendChild(lineKey(s.tone, s.dash));
        it.appendChild(document.createTextNode(s.name + ' '));
        it.appendChild(H('b', null, money(v, s.prefix != null ? s.prefix : prefix, s.decimals != null ? s.decimals : dec, s.unit != null ? s.unit : unit)));
        f.readout.appendChild(it);
      });
      if (band && band.lower[i] != null && band.lower[i] !== band.upper[i]) {
        var bi = H('span', 'rd-item');
        bi.appendChild(document.createTextNode((band.short || 'Range') + ' '));
        bi.appendChild(H('b', null, fmt(band.lower[i], dec) + '–' + fmt(band.upper[i], dec) + (unit ? (/^[%°]/.test(unit) ? '' : ' ') + unit : '')));
        f.readout.appendChild(bi);
      }
    }
    el._fpN = n;
    set(initial, false);
    wireScrub(f.plot, n, function (i) { return X(i) / W; }, set, initial, el);
  }

  /* ---------- bars and stacked bars (HTML) ---------- */
  function bars(el, stacked) {
    var labels = attr(el, 'labels', []);
    var short = attr(el, 'short', null);
    var h = +attr(el, 'height', 180);
    var unit = attr(el, 'unit', '');
    var prefix = attr(el, 'prefix', '');
    var dec = +attr(el, 'decimals', 0);
    var parts, values, n, totals;
    if (stacked) {
      parts = attr(el, 'parts', []);
      n = labels.length || parts[0].values.length;
      totals = [];
      var given = attr(el, 'totals', null);
      for (var i = 0; i < n; i++) {
        var t = 0;
        parts.forEach(function (p) { t += p.values[i] || 0; });
        totals.push(given && given[i] != null ? given[i] : t);
      }
    } else {
      values = attr(el, 'values', []);
      n = labels.length || values.length;
      totals = values;
    }
    var empty = attr(el, 'empty', []);
    var partial = attr(el, 'partial', []);
    var mark = attr(el, 'mark', null);
    var tn = attr(el, 'tone', 'ink');
    var hi = attr(el, 'y-max', null);
    if (hi == null) hi = Math.max.apply(null, totals.map(function (v) { return v || 0; }));
    var ticks = ticksFor(0, hi, +attr(el, 'y-ticks', 4), true);
    hi = ticks[ticks.length - 1];
    var f = frame(el, h, { gutter: attr(el, 'gutter', null) });
    var svg = S('svg', { viewBox: '0 0 1000 ' + h, preserveAspectRatio: 'none', 'aria-hidden': 'true' });
    f.plot.appendChild(svg);
    var Y = function (v) { return h - (v / hi) * h; };
    yTicks(f.plot, svg, ticks, Y, h, function (t) { return (prefix || '') + fmt(t, t % 1 ? 1 : 0) + (attr(el, 'tick-unit', '') || ''); });
    var ref = attr(el, 'ref', null);
    if (ref != null) {
      svg.appendChild(S('line', { x1: 0, x2: 1000, y1: Y(ref), y2: Y(ref), 'class': 'ch-ref' }));
      if (attr(el, 'ref-label', null)) f.legend.appendChild(legendItem(attr(el, 'ref-label', ''), 'graphite', true));
    }
    var wrap = H('div', 'bars' + (attr(el, 'thin', false) ? ' bars--thin' : ''));
    var showVals = attr(el, 'value-labels', n <= 8 ? 'all' : 'none');
    var cols = [];
    for (var j = 0; j < n; j++) {
      var col = H('div', 'bar-col');
      var bar = H('div', 'bar');
      var tot = totals[j] || 0;
      bar.style.height = pct(tot / hi);
      if (stacked && empty.indexOf(j) < 0) {
        parts.forEach(function (p) {
          var v = p.values[j] || 0;
          if (!v) return;
          var sg = H('div', 'bar-seg');
          sg.style.setProperty('--f', v);
          sg.style.setProperty('--c', tone(p.tone));
          bar.appendChild(sg);
        });
      } else if (stacked) {
        var e = H('div', 'bar-seg bar-seg--empty'); e.style.setProperty('--f', 1); bar.appendChild(e);
      } else {
        bar.classList.add('bar--single');
        bar.style.setProperty('--c', tone(mark != null && mark !== j ? 'graphite' : tn));
        if (partial.indexOf(j) > -1) bar.classList.add('bar--partial');
      }
      if (showVals === 'all' || (showVals === 'last' && j === n - 1) || (showVals === 'max' && tot === hi)) {
        bar.appendChild(H('span', 'bar-val', money(tot, prefix, dec)));
      }
      col.appendChild(bar);
      wrap.appendChild(col);
      cols.push(col);
    }
    f.plot.appendChild(wrap);
    if (stacked) {
      parts.forEach(function (p) { f.legend.appendChild(legendItem(p.name, p.tone, false, 'box')); });
      if (empty.length) f.legend.appendChild(legendItem(attr(el, 'empty-label', 'Not itemized yet'), 'empty', false, 'box'));
    } else if (partial.length) {
      var pl = H('span', 'lg-item'); var pk = H('span', 'lg-key lg-key--box'); pk.style.setProperty('--c', 'transparent'); pk.style.boxShadow = 'inset 0 0 0 1.5px ' + tone(tn);
      pl.appendChild(pk); pl.appendChild(document.createTextNode(attr(el, 'partial-label', 'Partial'))); f.legend.appendChild(pl);
    }
    xTicks(f.plot, n, labels, short, function (i) { return (i + 0.5) / n; }, attr(el, 'tick-every', 1));
    var initial = attr(el, 'readout', n - 1);
    function set(i, scrubbing) {
      cols.forEach(function (c, k) { c.classList.toggle('is-hot', !!scrubbing && k === i); });
      f.readout.textContent = '';
      f.readout.appendChild(H('span', 'rd-when', labels[i] || ''));
      if (stacked) {
        if (empty.indexOf(i) > -1) {
          var it0 = H('span', 'rd-item'); it0.appendChild(document.createTextNode('Total ')); it0.appendChild(H('b', null, money(totals[i], prefix, 2, unit)));
          f.readout.appendChild(it0);
          f.readout.appendChild(H('span', 'rd-item', attr(el, 'empty-label', 'Not itemized yet')));
          return;
        }
        parts.forEach(function (p) {
          var it = H('span', 'rd-item');
          it.appendChild(lineKey(p.tone, false, 'box'));
          it.appendChild(document.createTextNode(p.name + ' '));
          it.appendChild(H('b', null, money(p.values[i] || 0, prefix, attr(el, 'readout-decimals', 2), unit)));
          f.readout.appendChild(it);
        });
        var tt = H('span', 'rd-item'); tt.appendChild(document.createTextNode('Total ')); tt.appendChild(H('b', null, money(totals[i], prefix, attr(el, 'readout-decimals', 2), unit)));
        f.readout.appendChild(tt);
      } else {
        var it2 = H('span', 'rd-item');
        it2.appendChild(H('b', null, money(totals[i], prefix, attr(el, 'readout-decimals', dec), unit)));
        var notes = attr(el, 'notes', null);
        if (notes && notes[i]) it2.appendChild(document.createTextNode(' · ' + notes[i]));
        f.readout.appendChild(it2);
      }
    }
    el._fpN = n;
    set(initial, false);
    wireScrub(f.plot, n, function (i) { return (i + 0.5) / n; }, set, initial, el);
  }

  /* ---------- sparkline ---------- */
  function spark(el) {
    var values = attr(el, 'values', []);
    var h = +attr(el, 'height', 32);
    var t = attr(el, 'tone', 'ink');
    el.textContent = '';
    el.classList.add('spark');
    el.style.setProperty('--spark-h', h + 'px');
    var vs = values.filter(function (v) { return v != null; });
    var lo = Math.min.apply(null, vs), hi = Math.max.apply(null, vs);
    if (hi === lo) { hi += 1; lo -= 1; }
    var n = values.length, pad = 3;
    var X = function (i) { return n > 1 ? (i / (n - 1)) * 100 : 50; };
    var Y = function (v) { return pad + (1 - (v - lo) / (hi - lo)) * (h - pad * 2); };
    var svg = S('svg', { viewBox: '0 0 100 ' + h, preserveAspectRatio: 'none', 'aria-hidden': 'true' });
    var pts = [];
    values.forEach(function (v, i) { if (v != null) pts.push([X(i), Y(v)]); });
    if (attr(el, 'area', false)) {
      var a = S('path', { d: 'M' + pts[0][0] + ' ' + h + ' L' + pts.map(function (p) { return p.join(' '); }).join(' L') + ' L' + pts[pts.length - 1][0] + ' ' + h + ' Z', 'class': 'ch-area' });
      a.style.fill = tone(t); svg.appendChild(a);
    }
    var p = S('path', { d: 'M' + pts.map(function (q) { return q.join(' '); }).join(' L'), 'class': 'ch-line ch-line--thin' });
    p.style.stroke = tone(t); svg.appendChild(p);
    var last = pts[pts.length - 1];
    svg.appendChild(S('path', { d: 'M' + last[0] + ' ' + last[1] + ' h0', 'class': 'ch-dot-ring' }));
    var d = S('path', { d: 'M' + last[0] + ' ' + last[1] + ' h0', 'class': 'ch-dot' });
    d.style.stroke = tone(t); d.style.strokeWidth = '6';
    svg.appendChild(d);
    el.appendChild(svg);
  }

  /* ---------- heat strip / LED matrix ---------- */
  function heat(el) {
    var labels = attr(el, 'labels', []);
    var short = attr(el, 'short', null);
    var states = attr(el, 'states', null);
    var values = attr(el, 'values', null);
    var words = attr(el, 'state-words', { ok: 'OK', warn: 'Heads-up', problem: 'Problem', info: 'Info', off: 'No data' });
    var t = attr(el, 'tone', 'ink');
    var max = attr(el, 'max', null);
    var unit = attr(el, 'unit', '');
    var dec = +attr(el, 'decimals', 1);
    var notes = attr(el, 'notes', null);
    var n = (states || values || []).length;
    if (values && max == null) max = Math.max.apply(null, values.map(function (v) { return v || 0; }));
    var f = frame(el, 0, { gutter: 0 });
    el.classList.add('chart--heat');
    var row = H('div', 'heat' + (states ? ' heat--led' : ''));
    if (attr(el, 'cell-height', null)) row.style.setProperty('--cell-h', attr(el, 'cell-height') + 'px');
    var cells = [];
    for (var i = 0; i < n; i++) {
      var c = H('span', 'heat-cell');
      if (states) c.classList.add('is-' + states[i]);
      else { c.style.setProperty('--c', tone(t)); c.style.setProperty('--a', values[i] == null ? 0 : Math.max(0.06, values[i] / max)); }
      row.appendChild(c); cells.push(c);
    }
    f.plot.appendChild(row);
    f.plot.style.marginBottom = (short || labels.length) ? '22px' : '0';
    xTicks(f.plot, n, labels, short, function (k) { return (k + 0.5) / n; }, attr(el, 'tick-every', null));
    if (states) {
      var seen = {};
      states.forEach(function (s) { if (!seen[s]) { seen[s] = 1; } });
      ['ok', 'warn', 'problem', 'info', 'off'].forEach(function (s) {
        if (!seen[s]) return;
        var it = H('span', 'lg-item'); var lp = H('span', 'lamp lamp--s' + (s !== 'off' ? ' lamp--' + s : ''));
        it.appendChild(lp); it.appendChild(document.createTextNode(words[s] || s)); f.legend.appendChild(it);
      });
    }
    var initial = attr(el, 'readout', n - 1);
    function set(i, scrubbing) {
      cells.forEach(function (c, k) { c.classList.toggle('is-hot', !!scrubbing && k === i); });
      f.readout.textContent = '';
      f.readout.appendChild(H('span', 'rd-when', labels[i] || ''));
      var it = H('span', 'rd-item');
      it.appendChild(H('b', null, states ? (words[states[i]] || states[i]) : money(values[i], '', dec, unit)));
      if (notes && notes[i]) it.appendChild(document.createTextNode(' · ' + notes[i]));
      f.readout.appendChild(it);
    }
    el._fpN = n;
    set(initial, false);
    wireScrub(f.plot, n, function (k) { return (k + 0.5) / n; }, set, initial, el);
  }

  /* ---------- diverging rows (e.g. day of week above/below normal) ---------- */
  function diverge(el) {
    var labels = attr(el, 'labels', []);
    var values = attr(el, 'values', []);
    var unit = attr(el, 'unit', '%');
    var pos = attr(el, 'tone', 'ink'), neg = attr(el, 'tone-neg', 'graphite');
    var max = attr(el, 'max', null);
    if (max == null) max = Math.max.apply(null, values.map(Math.abs));
    el.textContent = '';
    el.classList.add('diverge');
    values.forEach(function (v, i) {
      var r = H('div', 'dv-row');
      r.appendChild(H('span', 'dv-label', labels[i]));
      var tr = H('span', 'dv-track');
      var b = H('span', 'dv-bar' + (v < 0 ? ' is-neg' : ''));
      var w = (Math.abs(v) / max) * 50;
      b.style.width = w + '%';
      if (v < 0) b.style.right = '50%'; else b.style.left = '50%';
      b.style.setProperty('--c', tone(v < 0 ? neg : pos));
      tr.appendChild(b);
      r.appendChild(tr);
      r.appendChild(H('span', 'dv-val', (v > 0 ? '+' : v < 0 ? '−' : '') + fmt(Math.abs(v), 0) + unit));
      el.appendChild(r);
    });
  }

  /* ---------- dial (the instrument) and ring (small gauge) ---------- */
  function polar(r, deg) {
    var a = (deg - 90) * Math.PI / 180;
    return [120 + r * Math.cos(a), 120 + r * Math.sin(a)];
  }
  function arcD(r, a0, a1) {
    if (a1 - a0 >= 359.99) {
      var m = a0 + 180;
      return arcD(r, a0, m) + ' ' + arcD(r, m, a0 + 359.99).replace(/^M[^A]+/, '');
    }
    var p0 = polar(r, a0), p1 = polar(r, a1);
    return 'M' + p0[0].toFixed(2) + ' ' + p0[1].toFixed(2) + ' A' + r + ' ' + r + ' 0 ' + (a1 - a0 > 180 ? 1 : 0) + ' 1 ' + p1[0].toFixed(2) + ' ' + p1[1].toFixed(2);
  }
  function dial(el) {
    var start = +attr(el, 'start', -135);
    var sweep = +attr(el, 'sweep', 270);
    var rings = attr(el, 'rings', []);
    var half = el.classList.contains('dial--half');
    Array.prototype.slice.call(el.querySelectorAll(':scope > svg')).forEach(function (s) { s.remove(); });
    var svg = S('svg', { viewBox: half ? '0 -2 240 136' : '0 0 240 240', 'aria-hidden': 'true' });
    var id = 'fpdial' + (++uid);
    var defs = S('defs');
    var mask = S('mask', { id: id, maskUnits: 'userSpaceOnUse', x: -40, y: -40, width: 320, height: 320 });
    mask.style.maskType = 'alpha';
    var mp = S('path', { d: arcD(62, start, start + sweep), pathLength: 100, 'stroke-dasharray': '100 100', 'class': 'dl-sweep', fill: 'none' });
    mp.style.stroke = 'var(--mask)'; mp.style.strokeWidth = '130';
    mask.appendChild(mp);
    defs.appendChild(mask);
    svg.appendChild(defs);
    var data = S('g', { mask: 'url(#' + id + ')' });
    var scale = S('g');
    var needles = S('g');
    rings.forEach(function (ring) {
      var r = ring.r || 92, w = ring.w || 10, min = ring.min || 0, max = ring.max == null ? 100 : ring.max;
      var A = function (v) { return start + ((v - min) / (max - min)) * sweep; };
      if (ring.edge) {
        var ed = S('path', { d: arcD(r, start, start + sweep), 'class': 'dl-track' });
        ed.style.strokeWidth = (w + 2); ed.style.stroke = 'var(--hairline-strong)';
        scale.appendChild(ed);
      }
      if (ring.track !== false) {
        var tr = S('path', { d: arcD(r, start, start + sweep), 'class': 'dl-track' });
        tr.style.strokeWidth = w;
        if (ring.trackTone) tr.style.stroke = tone(ring.trackTone);
        scale.appendChild(tr);
      }
      var inside = ring.tickSide === 'in';
      if (ring.ticks) {
        var N = ring.ticks, major = ring.major || 0;
        var full = sweep >= 359.99;
        for (var k = 0; k <= N; k++) {
          if (full && k === N) break;
          var a = start + (k / N) * sweep;
          var isMajor = major && k % major === 0;
          var r0 = inside ? r - w / 2 - 2 : r + w / 2 + 2;
          var r1 = inside ? r0 - (isMajor ? 7 : 4) : r0 + (isMajor ? 7 : 4);
          var p0 = polar(r0, a), p1 = polar(r1, a);
          scale.appendChild(S('line', { x1: p0[0], y1: p0[1], x2: p1[0], y2: p1[1], 'class': 'dl-tick' + (isMajor ? ' dl-tick--major' : '') }));
        }
      }
      (ring.labels || []).forEach(function (lb) {
        var la = A(lb[0]);
        var sx = Math.sin(la * Math.PI / 180);
        var side = Math.abs(sx) > 0.5;
        var lr = ring.labelR || (inside ? r - w / 2 - (side ? 13 : 16) : r + w / 2 + (side ? 13 : 17));
        var p = polar(lr, la);
        var anchor = !side ? 'middle' : ((sx > 0) !== inside ? 'start' : 'end');
        var t = S('text', { x: p[0].toFixed(1), y: p[1].toFixed(1), 'text-anchor': anchor, 'dominant-baseline': 'central', 'class': 'dl-text' });
        t.textContent = lb[1];
        scale.appendChild(t);
      });
      var gap = ring.gap || 0;
      (ring.segments || []).forEach(function (sg) {
        var a0 = A(sg.from) + gap / 2, a1 = A(sg.to) - gap / 2;
        if (a1 <= a0) return;
        var p = S('path', { d: arcD(r, a0, a1), 'class': 'dl-seg' + (sg.dash ? ' dl-seg--dash' : '') });
        p.style.stroke = tone(sg.tone || 'ink');
        p.style.strokeWidth = sg.w || w;
        (sg.static ? scale : data).appendChild(p);
      });
      (ring.marks || []).forEach(function (mk) {
        var a = A(mk.at);
        var p0 = polar(r - w / 2 - (mk.inset == null ? 3 : mk.inset), a), p1 = polar(r + w / 2 + (mk.out == null ? 5 : mk.out), a);
        var ln = S('line', { x1: p0[0], y1: p0[1], x2: p1[0], y2: p1[1], 'class': 'dl-mark' });
        if (mk.tone) ln.style.stroke = tone(mk.tone);
        scale.appendChild(ln);
        if (mk.label) {
          var pl = polar(mk.labelR || (r + w / 2 + 14), a);
          var tx = S('text', { x: pl[0].toFixed(1), y: pl[1].toFixed(1), 'text-anchor': 'middle', 'dominant-baseline': 'central', 'class': 'dl-mark-text' });
          tx.textContent = mk.label;
          scale.appendChild(tx);
        }
      });
      if (ring.needle) {
        var nd = ring.needle, an = A(nd.at);
        var g = S('g', { 'class': 'dl-needle-g' });
        g.style.setProperty('--from', (start - an) + 'deg');
        if (nd.style === 'needle') {
          var q0 = polar(-10, an), q1 = polar(r + w / 2 + 2, an);
          g.appendChild(S('line', { x1: q0[0], y1: q0[1], x2: q1[0], y2: q1[1], 'class': 'dl-needle' }));
          g.appendChild(S('circle', { cx: 120, cy: 120, r: 6, 'class': 'dl-hub' }));
        } else {
          var s0 = polar(r - w / 2 - 6, an), s1 = polar(r + w / 2 + 6, an);
          g.appendChild(S('line', { x1: s0[0], y1: s0[1], x2: s1[0], y2: s1[1], 'class': 'dl-needle' }));
          var tip = polar(r + w / 2 + 9, an);
          g.appendChild(S('circle', { cx: tip[0], cy: tip[1], r: 3, 'class': 'dl-hub' }));
        }
        needles.appendChild(g);
      }
    });
    svg.appendChild(scale);
    svg.appendChild(data);
    svg.appendChild(needles);
    el.insertBefore(svg, el.firstChild);
  }
  function ring(el) {
    var v = +attr(el, 'value', 0);
    var t = attr(el, 'tone', 'ink');
    var w = +attr(el, 'width', 20);
    el.classList.add('dial');
    el.setAttribute('data-start', 0);
    el.setAttribute('data-sweep', 360);
    el.setAttribute('data-rings', JSON.stringify([{ r: 110 - w / 2, w: w, min: 0, max: 1, segments: [{ from: 0, to: Math.max(0.001, Math.min(1, v)), tone: t }] }]));
    dial(el);
  }

  var TYPES = { line: line, bars: function (el) { bars(el, false); }, stack: function (el) { bars(el, true); }, spark: spark, heat: heat, diverge: diverge, dial: dial, ring: ring };
  function render(el) {
    var t = el.getAttribute('data-chart');
    if (!TYPES[t]) return;
    try { TYPES[t](el); } catch (e) { console.error('chart ' + t + ' failed', el, e); }
  }
  function renderAll(root) {
    (root || document).querySelectorAll('[data-chart]').forEach(render);
  }
  window.FP = { render: render, renderAll: renderAll };
  renderAll(document);
})();
