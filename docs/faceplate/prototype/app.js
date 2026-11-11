/* Faceplate — concept behaviour that every screen shares. Runs after the shared runtime. */
(function () {
  if (!window.Proto) return;
  var P = window.Proto;
  var doc = document;

  /* 1. A dialog button that both closes and confirms ("Save record") shows its toast.
        The runtime closes the dialog and stops before data-toast, so the toast is fired here. */
  doc.addEventListener('click', function (ev) {
    var t = ev.target.closest && ev.target.closest('[data-close-modal][data-toast]');
    if (t) P.toast(t.getAttribute('data-toast'));
  });

  /* 1b. A link can land on a sub-view: data-nav="utility" data-nav-tab="utility-view:water".
         The runtime navigates first (its listener is registered before this one), then the view is picked. */
  doc.addEventListener('click', function (ev) {
    var t = ev.target.closest && ev.target.closest('[data-nav][data-nav-tab]');
    if (!t) return;
    t.getAttribute('data-nav-tab').split(/\s+/).forEach(function (pair) {
      var i = pair.indexOf(':');
      if (i > 0) P.selectTab(pair.slice(0, i), pair.slice(i + 1));
    });
  });

  /* 2. Readout rows count only the wells a viewer can see. A role-only well that is hidden for
        guests or members must not leave its neighbour at half width (KIT §7.3). */
  function shown(el) { return !el.hidden && getComputedStyle(el).display !== 'none'; }
  function fitReadouts() {
    doc.querySelectorAll('.readouts').forEach(function (r) {
      var kids = Array.prototype.filter.call(r.children, function (c) { return !c.hidden; });
      var vis = kids.filter(shown);
      kids.forEach(function (c) { c.classList.remove('readout--span'); });
      if (vis.length === kids.length) { r.classList.remove('readouts--fit'); r.removeAttribute('data-n'); return; }
      r.classList.add('readouts--fit');
      r.setAttribute('data-n', String(vis.length));
      if (vis.length % 2 === 1) vis[vis.length - 1].classList.add('readout--span');
    });
  }
  P.onChange(fitReadouts);
  fitReadouts();

  /* 3. Typesetting: a clock time never breaks from its AM/PM ("6 / PM"), a day never breaks from its month
        ("Nov / 15") and a figure never breaks from a short unit ("1,124 / sq ft"). In the real app this is the
        date/number formatter's job; here one pass over the text does it for every screen, including text that
        screen scripts write later (dialog details, live counters). */
  var NB = ' ';
  var RULES = [
    [/(\d)[ ](AM|PM)\b/g, '$1' + NB + '$2'],
    [/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[ ](\d{1,2})\b/g, '$1' + NB + '$2'],
    [/(\d)[ ](sq ft|kWh|gal|CCF|min|hr|GB|MB|°F|mph|in)\b/g, '$1' + NB + '$2'],
    [/\bsq ft\b/g, 'sq' + NB + 'ft'],
  ];
  function setText(node) {
    var v = node.nodeValue;
    if (!v || v.length < 3 || !/\d/.test(v)) return;
    var t = v;
    for (var i = 0; i < RULES.length; i++) t = t.replace(RULES[i][0], RULES[i][1]);
    if (t !== v) node.nodeValue = t;
  }
  function typeset(root) {
    if (root.nodeType === 3) { setText(root); return; }
    if (root.nodeType !== 1 || /^(SCRIPT|STYLE|TEXTAREA|INPUT|SELECT|OPTION)$/.test(root.tagName)) return;
    var w = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) { return n.parentNode && /^(SCRIPT|STYLE|TEXTAREA)$/.test(n.parentNode.nodeName) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT; },
    });
    var n; while ((n = w.nextNode())) setText(n);
  }
  typeset(doc.body);
  if (window.MutationObserver) {
    new MutationObserver(function (list) {
      list.forEach(function (m) {
        if (m.type === 'characterData') setText(m.target);
        else m.addedNodes.forEach(typeset);
      });
    }).observe(doc.body, { childList: true, subtree: true, characterData: true });
  }
})();
