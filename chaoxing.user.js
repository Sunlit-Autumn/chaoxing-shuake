// ==UserScript==
// @name         学习通自动刷课 / 自动播放 / 自动切节
// @namespace    cx-auto
// @version      5.3
// @description  自动倍速静音、递归接管 iframe 播放器、严格串行、无媒体章节停留后自跳
// @author       Sunlit-Autumn
// @match        *://*.chaoxing.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  var topWin = null;
  try { topWin = window.top; } catch (e) { return; }
  if (topWin !== window) return;

  if (window.__cxTM) return;
  window.__cxTM = true;

  const SPEED = 2.0;
  const MUTE = true;
  const POLL = 1500;
  const END_GRACE = 15000;
  const NO_MEDIA_DWELL = 15000;
  const TAG = '[cx]';

  const log = (...a) => { try { console.log(TAG, ...a); } catch (e) {} };

  /* ---------------- media ---------------- */

  const finishedRing = new WeakSet();
  let completedAt = 0;
  let lastCount = -1;
  let noMediaSince = 0;

  const hasDur = m => isFinite(m.duration) && m.duration > 0;
  const hasSrc = m => !!((m.currentSrc || m.src || '').length);
  const mediaFinished = m => m.ended || (hasDur(m) && m.currentTime >= m.duration - 0.6);

  function collectDeep(root, depth, out) {
    if (!root || depth > 3) return out;
    try {
      const found = root.querySelectorAll('video, audio');
      for (let i = 0; i < found.length; i++) out.push(found[i]);
    } catch (e) { return out; }
    let frames = null;
    try { frames = root.querySelectorAll('iframe'); } catch (e) { return out; }
    for (let i = 0; i < frames.length; i++) {
      let doc = null;
      try { doc = frames[i].contentDocument; } catch (e) { continue; }
      if (doc) collectDeep(doc, depth + 1, out);
    }
    return out;
  }

  function allMedia() { return collectDeep(document, 0, []); }
  function playable() { return allMedia().filter(m => hasDur(m) && hasSrc(m)); }

  function hardMute(m) { try { m.muted = MUTE; if (MUTE) m.volume = 0; } catch (e) {} }
  function hardPause(m) { if (!m || m.paused) return; try { m.pause(); } catch (e) {} }

  function forcePlay(m) {
    hardMute(m);
    if (!m.paused) return;
    let p;
    try { p = m.play(); } catch (e) { return; }
    if (p && p.catch) p.catch(err => { if (!m.__cxErr) { m.__cxErr = err.name; log('play rejected: ' + err.name); } });
  }

  function wakeAll() {
    let woken = 0;
    allMedia().forEach(m => {
      if (hasDur(m)) return;
      try {
        if (m.preload !== 'auto') m.preload = 'auto';
        m.load();
        m.pause();
        woken++;
      } catch (e) {}
    });
    if (woken) log('woke ' + woken + ' lazy player(s)');
    return woken;
  }

  function bind(m) {
    if (m.__cxBound) return;
    m.__cxBound = true;
    hardMute(m);
    try { m.playbackRate = SPEED; } catch (e) {}
    m.addEventListener('ratechange', () => {
      if (Math.abs(m.playbackRate - SPEED) > 0.01) { try { m.playbackRate = SPEED; } catch (e) {} }
    });
    log('bind ' + m.tagName + ' ' + (m.id || '-') + ' ' + ((m.duration || 0).toFixed(0)) + 's');
  }

  /* ---------------- catalog ---------------- */

  const UNIT_SELS = ['.posCatalog_select', '.posCatalog_select_center', '.catalog_points_ul li', '.chapter .section'];

  function allUnits() {
    for (let i = 0; i < UNIT_SELS.length; i++) {
      const els = document.querySelectorAll(UNIT_SELS[i]);
      if (els.length) return Array.prototype.slice.call(els);
    }
    return [];
  }

  function isDone(el) {
    if (!el) return false;
    const t = (el.textContent || '') + ' ' + (el.getAttribute('title') || '');
    if (t.indexOf('\u5df2\u5b8c\u6210') >= 0) return true;
    if (t.indexOf('\u5df2\u901a\u8fc7') >= 0) return true;
    if (el.querySelector('.icon_Completed')) return true;
    if (el.querySelector('.posCatalog_select_completed')) return true;
    if (el.querySelector('.Mconverted')) return true;
    return false;
  }

  function chapterIdFromUrl() {
    const m = location.search.match(/chapterId=(\d+)/i);
    return m ? m[1] : '';
  }

  function currentIndex(items) {
    const cid = chapterIdFromUrl();
    if (cid) {
      for (let i = 0; i < items.length; i++) if ((items[i].id || '').indexOf(cid) >= 0) return i;
      for (let i = 0; i < items.length; i++) {
        const oc = (items[i].getAttribute('onclick') || '') + (items[i].getAttribute('href') || '');
        if (oc.indexOf(cid) >= 0) return i;
      }
    }
    for (let i = 0; i < items.length; i++) if (/active/i.test(items[i].className || '')) return i;
    return -1;
  }

  function activate(el) {
    if (!el) return;
    const fire = (node, type) => {
      try { node.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window, button: 0, detail: 1 })); } catch (e) {}
    };
    let target = el;
    if (!(el.getAttribute && el.getAttribute('onclick'))) {
      const inner = el.querySelector('[onclick]');
      if (inner) target = inner;
    }
    fire(target, 'mousedown');
    fire(target, 'mouseup');
    fire(target, 'click');
    try { target.click(); } catch (e) {}
    const oc = (target.getAttribute && target.getAttribute('onclick')) || '';
    if (oc) { try { target.onclick(); } catch (e) {} }
    log('activate -> ' + (el.textContent || '').trim().slice(0, 26));
  }

  let lastSwitch = 0;

  function nextUnit() {
    const items = allUnits();
    const idx = currentIndex(items);
    if (idx < 0) { log('cannot locate current unit'); return; }
    log('nextUnit idx=' + idx + '/' + items.length);
    for (let i = idx + 1; i < items.length; i++) {
      if (!isDone(items[i])) {
        lastSwitch = Date.now();
        lastCount = -1;
        completedAt = 0;
        noMediaSince = 0;
        activate(items[i]);
        return;
      }
    }
    log('no pending unit');
  }

  /* ---------------- loop ---------------- */

  function tick() {
    wakeAll();

    const list = playable();

    if (!list.length) {
      if (!noMediaSince) {
        noMediaSince = Date.now();
        log('no media in this unit (doc/image only), dwell ' + (NO_MEDIA_DWELL / 1000) + 's');
        return;
      }
      const dwelt = Date.now() - noMediaSince;
      if (dwelt < NO_MEDIA_DWELL) return;
      log('dwell done (' + Math.round(dwelt / 1000) + 's), switching to next unit');
      noMediaSince = 0;
      lastCount = -1;
      if (Date.now() - lastSwitch > 8000) nextUnit();
      return;
    }

    noMediaSince = 0;

    if (list.length !== lastCount) {
      log('media count ' + (lastCount < 0 ? '?' : lastCount) + ' -> ' + list.length);
      lastCount = list.length;
      completedAt = 0;
    }

    list.forEach(m => { if (mediaFinished(m)) finishedRing.add(m); });

    const cur = list.find(m => !finishedRing.has(m));

    list.forEach(m => { if (m !== cur) hardPause(m); });

    if (cur) {
      completedAt = 0;
      bind(cur);
      hardMute(cur);
      if (hasDur(cur) && Math.abs(cur.playbackRate - SPEED) > 0.01) { try { cur.playbackRate = SPEED; } catch (e) {} }
      forcePlay(cur);
      return;
    }

    if (!completedAt) {
      completedAt = Date.now();
      log('all ' + list.length + ' player(s) ended, waiting ' + (END_GRACE / 1000) + 's for server report');
      return;
    }
    if (Date.now() - completedAt < END_GRACE) return;

    log('switching to next unit');
    completedAt = 0;
    lastCount = -1;
    if (Date.now() - lastSwitch > 8000) nextUnit();
  }

  setInterval(tick, POLL);
  tick();

  setTimeout(() => {
    const items = allUnits();
    if (!items.length) return;
    log('catalog nodes = ' + items.length + ' | done = ' + items.filter(isDone).length);
    if (currentIndex(items) >= 0) return;
    const first = items.findIndex(i => !isDone(i));
    if (first >= 0) activate(items[first]);
  }, 3000);

  /* ---------------- console api ---------------- */

  window.cxNext = nextUnit;
  window.cxStatus = () => playable().map((m, i) => ({
    i: i, id: m.id || '', t: +m.currentTime.toFixed(1), d: +(m.duration || 0).toFixed(1),
    rate: m.playbackRate, paused: m.paused, done: finishedRing.has(m)
  }));
  window.cxAll = () => allMedia().map((m, i) => ({
    i: i, tag: m.tagName, id: m.id || '', rs: m.readyState,
    d: isFinite(m.duration) ? +m.duration.toFixed(1) : String(m.duration),
    t: +m.currentTime.toFixed(1), paused: m.paused,
    inFrame: (function () { try { return m.ownerDocument !== document; } catch (e) { return '?'; } })(),
    src: (m.currentSrc || m.src || '').slice(-38)
  }));
  window.cxPause = () => { allMedia().forEach(hardPause); return 'all paused (' + allMedia().length + ')'; };
  window.cxScan = () => allUnits().map((e, i) => ({ i: i, done: isDone(e), t: (e.textContent || '').trim().slice(0, 30) }));
  window.cxJump = n => { const items = allUnits(); if (!items[n]) return 'bad index'; activate(items[n]); return (items[n].textContent || '').trim().slice(0, 30); };

  log('injected v5.3 (top-frame only, recursive, dwell for no-media units)');
})();
