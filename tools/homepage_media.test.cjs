const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');

// Run the real loader with controllable media promises and observer delivery.
// No browser timing or network speed is needed to reproduce the race conditions.
const script = readFileSync(`${__dirname}/../assets/js/homepage-media.js`, 'utf8');
class Element {
  constructor(tag) {
    this.tag = tag;
    this.dataset = {};
    this.attrs = {};
    this.listeners = new Map();
    this.children = [];
    this.classes = new Set();
    this.classList = {
      add: (...names) => names.forEach(n => this.classes.add(n)),
      remove: (...names) => names.forEach(n => this.classes.delete(n)),
      contains: n => this.classes.has(n),
    };
  }
  setAttribute(k, v) { this.attrs[k] = v; }
  getAttribute(k) { return this.attrs[k] ?? null; }
  hasAttribute(k) { return k in this.attrs; }
  addEventListener(name, fn) {
    const list = this.listeners.get(name) || [];
    list.push(fn);
    this.listeners.set(name, list);
  }
  emit(name) {
    for (const fn of this.listeners.get(name) || []) fn({ stopPropagation() {} });
  }
  appendChild(child) {
    this.children = this.children.filter(c => c !== child);
    this.children.push(child);
    child.parent = this;
  }
  matches(tag) { return this.tag === tag; }
  closest() { return this.parent; }
  querySelectorAll(selector) {
    return this.children.filter(c => selector.startsWith(c.tag));
  }
  decode() { return Promise.resolve(); }
}

function fixture({ reducedMotion = false, coarse = false } = {}) {
  const main = new Element('main');
  const container = new Element('div');
  const video = new Element('video');
  const document = new Element('document');
  document.hidden = false;
  document.createElement = tag => new Element(tag);
  document.querySelector = () => main;
  main.querySelectorAll = selector => selector === 'video' ? [video] : [];
  container.appendChild(video);
  video.dataset.poster = '/poster.jpg';
  video.setAttribute('aria-label', 'Sample clip');
  video.paused = true;
  video.readyState = 0;
  video.isConnected = true;
  let rect = { top: 850, bottom: 950, left: 0, right: 100, width: 100, height: 100 };
  video.getBoundingClientRect = () => rect;
  video.loads = 0;
  video.load = () => { video.loads++; video.readyState = 0; video.emit('loadstart'); };
  video.pause = () => { video.paused = true; video.emit('pause'); };
  const attempts = [];
  video.play = () => new Promise((resolve, reject) => attempts.push({
    resolve: () => { video.paused = false; video.emit('playing'); resolve(); }, reject,
  }));
  for (const type of ['video/webm', 'video/mp4']) {
    const source = new Element('source');
    source.type = type;
    source.dataset.src = `/${type.split('/')[1]}`;
    video.appendChild(source);
  }
  const observers = [];
  const timers = new Map();
  let timerId = 0;
  class Observer {
    constructor(callback, options) { this.callback = callback; this.options = options; observers.push(this); }
    observe() {}
    unobserve() {}
    enter() { this.callback([{ target: video, isIntersecting: true }]); }
    exit() { this.callback([{ target: video, isIntersecting: false }]); }
  }
  vm.runInNewContext(script, {
    document,
    window: { innerHeight: 800, innerWidth: 400,
      matchMedia: q => ({ matches: q.includes('reduced-motion') ? reducedMotion : coarse }) },
    requestAnimationFrame: fn => fn(),
    setTimeout: fn => { timers.set(++timerId, fn); return timerId; },
    clearTimeout: id => timers.delete(id),
    IntersectionObserver: Observer,
    MutationObserver: class { observe() {} },
  });
  const button = container.children.find(c => c.tag === 'button');
  const poster = container.children.find(c => c.tag === 'img');
  return { video, button, poster, attempts, document,
    flushTimers() { for (const [id, fn] of timers) { timers.delete(id); fn(); } },
    near: observers.find(o => o.options.rootMargin === '100px 0px'),
    visible: observers.find(o => o.options.rootMargin === '0px'),
    onscreen() { rect = { ...rect, top: 100, bottom: 200 }; },
    offscreen() { rect = { ...rect, top: 1000, bottom: 1100 }; },
    ready() { video.readyState = 2; video.emit('loadeddata'); video.emit('canplay'); },
  };
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test('nearby media preloads but only visible media starts; listeners do not accumulate', () => {
  const f = fixture();
  f.near.enter();
  f.ready();
  assert.equal(f.video.autoplay, false);
  assert.equal(f.video.loads, 1);
  assert.equal(f.attempts.length, 0);
  f.onscreen();
  for (let i = 0; i < 5; i++) f.visible.enter();
  assert.equal(f.attempts.length, 1);
  assert.equal(f.video.listeners.get('loadeddata').length, 1);
});

test('data arriving after viewport exit does not start playback', () => {
  const f = fixture();
  f.onscreen(); f.visible.enter();
  f.offscreen(); f.visible.exit();
  f.ready();
  assert.equal(f.attempts.length, 1);
  assert.equal(f.video.paused, true);
});

test('visible playback starts loading even when preload none has provided no data', () => {
  const f = fixture();
  f.onscreen(); f.visible.enter();
  assert.equal(f.video.readyState, 0);
  assert.equal(f.attempts.length, 1);
});

test('late play completion is stopped after exit and can resume on re-entry', async () => {
  const f = fixture();
  f.onscreen(); f.visible.enter(); f.ready();
  f.offscreen(); f.visible.exit();
  f.attempts[0].resolve(); await settle();
  assert.equal(f.video.paused, true);
  f.onscreen(); f.visible.enter();
  assert.equal(f.attempts.length, 2);
});

test('blocked autoplay exposes Play and a decoded poster; a button gesture starts playback', async () => {
  const f = fixture();
  f.onscreen(); f.visible.enter();
  f.poster.emit('load'); await settle();
  assert.equal(f.poster.src, '/poster.jpg');
  assert.equal(f.poster.classList.contains('is-loaded'), true);
  f.ready();
  f.attempts[0].reject({ name: 'NotAllowedError' }); await settle();
  assert.equal(f.button.textContent, 'Play');
  assert.equal(f.button.hidden, false);
  f.visible.enter(); f.video.emit('canplay');
  assert.equal(f.attempts.length, 1);
  f.button.emit('click');
  assert.equal(f.attempts.length, 2);
  f.attempts[1].resolve(); await settle();
  assert.equal(f.button.hidden, true);
  assert.equal(f.button.getAttribute('aria-label'), 'Play: Sample clip');
});

test('video error keeps native surface hidden and Retry reloads existing sources', async () => {
  const f = fixture();
  f.near.enter(); f.onscreen();
  f.video.emit('error');
  assert.equal(f.button.textContent, 'Retry');
  assert.equal(f.button.hidden, false);
  assert.equal(f.video.classList.contains('is-loaded'), false);
  f.button.emit('click');
  assert.equal(f.video.loads, 2);
  assert.equal(f.attempts.length, 1);
  f.ready(); f.attempts[0].resolve(); await settle();
  assert.equal(f.button.hidden, true);
});

test('all source failures expose Retry, but a single failed format allows fallback', () => {
  const f = fixture();
  f.near.enter();
  f.video.networkState = 3;
  f.video.children[0].emit('error');
  assert.equal(f.button.textContent, 'Play');
  f.video.children[1].emit('error');
  f.flushTimers();
  assert.equal(f.button.textContent, 'Retry');
});

test('empty lazy sources cannot report a failure before loading begins', () => {
  const f = fixture();
  f.video.networkState = 3;
  f.video.emit('loadstart');
  f.video.children.forEach(s => s.emit('error'));
  f.video.emit('error');
  f.flushTimers();
  assert.equal(f.button.textContent, 'Play');
});

test('source errors from replaced candidates do not override usable media', async () => {
  const f = fixture();
  f.onscreen(); f.visible.enter();
  f.video.networkState = 2;
  f.video.children.forEach(s => s.emit('error'));
  f.ready(); f.attempts[0].resolve(); await settle();
  assert.equal(f.button.hidden, true);
  assert.equal(f.video.classList.contains('is-loaded'), true);
});

test('backgrounding cancels playback and stale rejection cannot block foreground resume', async () => {
  const f = fixture();
  f.onscreen(); f.visible.enter(); f.ready();
  f.document.hidden = true; f.document.emit('visibilitychange');
  f.attempts[0].reject({ name: 'AbortError' }); await settle();
  f.ready();
  assert.equal(f.attempts.length, 1);
  f.document.hidden = false; f.document.emit('visibilitychange');
  assert.equal(f.attempts.length, 2);
  f.attempts[1].resolve(); await settle();
  f.document.hidden = true; f.document.emit('visibilitychange');
  assert.equal(f.video.paused, true);
});

test('normal loading, playback, and offscreen pausing never show controls', async () => {
  const f = fixture();
  assert.equal(f.button.hidden, true);
  f.onscreen(); f.visible.enter(); f.ready();
  assert.equal(f.button.hidden, true);
  f.attempts[0].resolve(); await settle();
  assert.equal(f.button.hidden, true);
  f.button.emit('click');
  assert.equal(f.video.paused, false);
  f.offscreen(); f.visible.exit();
  assert.equal(f.video.paused, true);
  assert.equal(f.button.hidden, true);
  assert.equal(f.button.textContent, 'Play');
});

test('reduced motion waits for a gesture, which can start play before data arrives', async () => {
  const f = fixture({ reducedMotion: true, coarse: true });
  f.onscreen(); f.near.enter(); f.visible.enter();
  assert.equal(f.attempts.length, 0);
  assert.equal(f.button.hidden, false);
  assert.equal(f.video.loop, false);
  assert.equal(f.video.children[0].type, 'video/mp4');
  f.button.emit('click');
  assert.equal(f.attempts.length, 1);
  f.ready(); f.attempts[0].resolve(); await settle();
  assert.equal(f.button.hidden, true);
  f.video.paused = true; f.video.emit('ended'); f.visible.enter();
  assert.equal(f.attempts.length, 1);
  assert.equal(f.button.hidden, false);
});
