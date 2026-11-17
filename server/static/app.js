'use strict';

// ===================================================================
// Config
// ===================================================================

const READER_MAX_KEY_GAP_MS = 60; // wedge readers type far faster than humans
const READER_MIN_HEX_LEN = 8;
const REPEAT_WINDOW_MS = 1500; // same badge again within this = repeat
const LOG_LIMIT = 200;

const ANIMALS = [
  ['🐶', 'Dog'], ['🐱', 'Cat'], ['🐭', 'Mouse'], ['🐰', 'Bunny'], ['🦊', 'Fox'], ['🐻', 'Bear'],
  ['🐼', 'Panda'], ['🐨', 'Koala'], ['🐯', 'Tiger'], ['🦁', 'Lion'], ['🐮', 'Cow'], ['🐷', 'Pig'],
  ['🐸', 'Frog'], ['🐵', 'Monkey'], ['🐔', 'Chicken'], ['🐧', 'Penguin'], ['🦉', 'Owl'], ['🦆', 'Duck'],
  ['🦄', 'Unicorn'], ['🐝', 'Bee'], ['🦋', 'Butterfly'], ['🐢', 'Turtle'], ['🐍', 'Snake'], ['🦖', 'Dinosaur'],
  ['🐙', 'Octopus'], ['🐬', 'Dolphin'], ['🐳', 'Whale'], ['🦈', 'Shark'], ['🐘', 'Elephant'], ['🦒', 'Giraffe'],
  ['🦓', 'Zebra'], ['🦘', 'Kangaroo'], ['🦔', 'Hedgehog'], ['🐊', 'Crocodile'], ['🦩', 'Flamingo'], ['🐞', 'Ladybug'],
].map(([emoji, label]) => ({ emoji, label }));

const COLORS = [
  ['Red', '#E53935'], ['Orange', '#FB8C00'], ['Yellow', '#FDD835'], ['Light Green', '#9CCC65'],
  ['Green', '#2E7D32'], ['Light Blue', '#81D4FA'], ['Blue', '#1E5BD8'], ['Purple', '#8E24AA'],
  ['Pink', '#F48FB1'], ['Brown', '#8D6E63'], ['Gray', '#9E9E9E'], ['White', '#FFFFFF'], ['Black', '#1A1A1A'],
].map(([name, hex]) => ({ name, hex }));

// ===================================================================
// Small helpers
// ===================================================================

const $ = (sel, root = document) => root.querySelector(sel);

// Children are appended as text nodes, so card labels can never inject HTML.
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value);
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    node.append(child instanceof Node ? child : String(child));
  }
  return node;
}

function hexToRgb(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mix(hex, target, amount) {
  const [r, g, b] = hexToRgb(hex);
  const t = target === 'white' ? 255 : 0;
  const m = (c) => Math.round(c + (t - c) * amount);
  return `rgb(${m(r)}, ${m(g)}, ${m(b)})`;
}

const pick = (list) => list[Math.floor(Math.random() * list.length)];

// ===================================================================
// Sound (Web Audio, no files)
// ===================================================================

const Sound = (() => {
  let ctx = null;
  let master = null;
  let muted = false;

  function audio() {
    if (!ctx) {
      ctx = new AudioContext();
      const comp = ctx.createDynamicsCompressor();
      master = ctx.createGain();
      master.gain.value = 0.8;
      master.connect(comp).connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function tone(freq, start, dur, { type = 'sine', gain = 0.3, slideTo = null, vibrato = 0 } = {}) {
    if (muted) return;
    const c = audio();
    const t = c.currentTime + start;
    const osc = c.createOscillator();
    const amp = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    if (vibrato) {
      const lfo = c.createOscillator();
      const depth = c.createGain();
      lfo.frequency.value = 7;
      depth.gain.value = vibrato;
      lfo.connect(depth).connect(osc.frequency);
      lfo.start(t);
      lfo.stop(t + dur + 0.05);
    }
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.exponentialRampToValueAtTime(gain, t + 0.02);
    amp.gain.setValueAtTime(gain, t + dur * 0.6);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(amp).connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  return {
    unlock: audio,
    get muted() { return muted; },
    set muted(value) { muted = value; },
    tick(i = 0) {
      tone(660 + i * 35, 0, 0.09, { type: 'triangle', gain: 0.18 });
    },
    chime() {
      [784, 988, 1319].forEach((f, i) => {
        tone(f, i * 0.11, 0.6, { gain: 0.3 });
        tone(f * 2, i * 0.11, 0.3, { type: 'triangle', gain: 0.06 });
      });
    },
    /** Silly "access denied": two buzzy bwomps and a boing. */
    buzzer() {
      tone(220, 0, 0.3, { type: 'square', gain: 0.18, slideTo: 140 });
      tone(226, 0, 0.3, { type: 'sawtooth', gain: 0.12, slideTo: 144 });
      tone(200, 0.36, 0.45, { type: 'square', gain: 0.18, slideTo: 90, vibrato: 10 });
      tone(206, 0.36, 0.45, { type: 'sawtooth', gain: 0.12, slideTo: 92 });
      tone(700, 0.9, 0.35, { type: 'sine', gain: 0.2, slideTo: 160, vibrato: 30 });
    },
    silly() {
      tone(392, 0, 0.3, { type: 'sawtooth', gain: 0.18, slideTo: 370 });
      tone(370, 0.33, 0.3, { type: 'sawtooth', gain: 0.18, slideTo: 349 });
      tone(349, 0.66, 0.3, { type: 'sawtooth', gain: 0.18, slideTo: 330 });
      tone(330, 0.99, 0.9, { type: 'sawtooth', gain: 0.18, slideTo: 247, vibrato: 12 });
    },
    fanfare() {
      const notes = [[392, 0], [523, 0.15], [659, 0.3], [784, 0.45], [659, 0.65], [784, 0.8]];
      for (const [f, s] of notes) {
        tone(f, s, 0.18, { type: 'square', gain: 0.12 });
        tone(f, s, 0.18, { type: 'triangle', gain: 0.2 });
      }
      for (const f of [523, 659, 784, 1047]) tone(f, 1.0, 1.2, { type: 'triangle', gain: 0.14, vibrato: 4 });
    },
  };
})();

// ===================================================================
// Voice (speechSynthesis with the Mac's built-in offline voices)
// ===================================================================

const Voice = (() => {
  const supported = 'speechSynthesis' in window;
  const history = [];
  let enabled = true;
  let voice = null;

  function pickVoice() {
    const local = speechSynthesis.getVoices().filter((v) => v.localService && v.lang.startsWith('en'));
    voice = local.find((v) => /Samantha|Karen|Daniel/.test(v.name)) || local[0] || null;
  }
  if (supported) {
    pickVoice();
    speechSynthesis.addEventListener('voiceschanged', pickVoice);
  }

  return {
    history,
    get enabled() { return enabled; },
    set enabled(value) {
      enabled = value;
      if (!value && supported) speechSynthesis.cancel();
    },
    /** Speak a short phrase. `queue` keeps earlier phrases instead of cutting them off. */
    say(text, { queue = false, rate = 0.95, pitch = 1.25 } = {}) {
      history.push(text);
      if (history.length > 50) history.shift();
      if (!enabled || !supported || Sound.muted) return;
      if (!queue) speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      if (voice) u.voice = voice;
      u.rate = rate;
      u.pitch = pitch;
      speechSynthesis.speak(u);
    },
  };
})();

// ===================================================================
// Confetti (canvas)
// ===================================================================

const Confetti = (() => {
  const canvas = $('#confetti');
  const g = canvas.getContext('2d');
  let parts = [];
  let running = false;

  function resize() {
    canvas.width = innerWidth * devicePixelRatio;
    canvas.height = innerHeight * devicePixelRatio;
  }
  addEventListener('resize', resize);
  resize();

  function palette(colors) {
    const base = (colors && colors.length ? colors : COLORS.map((c) => c.hex)).filter(Boolean);
    return base.flatMap((hex) => [hex, hex, mix(hex, 'white', 0.35), mix(hex, 'black', 0.25)]);
  }

  function add(count, colors, spawn) {
    const pal = palette(colors);
    const W = canvas.width;
    for (let i = 0; i < count; i++) {
      parts.push({
        ...spawn(W, canvas.height),
        size: W * (0.006 + Math.random() * 0.008),
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 0.3,
        wobble: Math.random() * Math.PI * 2,
        color: pick(pal),
      });
    }
    if (!running) {
      running = true;
      requestAnimationFrame(frame);
    }
  }

  function frame() {
    const W = canvas.width;
    const H = canvas.height;
    g.clearRect(0, 0, W, H);
    const gravity = H * 0.0006;
    for (const p of parts) {
      p.vy += gravity;
      p.vx *= 0.985;
      p.vy *= 0.985;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;
      p.wobble += 0.15;
      g.save();
      g.translate(p.x, p.y);
      g.rotate(p.rot);
      g.scale(1, Math.cos(p.wobble));
      g.fillStyle = p.color;
      g.fillRect(-p.size / 2, -p.size / 3, p.size, p.size * 0.66);
      g.restore();
    }
    parts = parts.filter((p) => p.y < H + 50);
    if (parts.length) requestAnimationFrame(frame);
    else running = false;
  }

  return {
    /** Explosion from a point (fractions of the screen). */
    burst(colors, { x = 0.5, y = 0.5, count = 180 } = {}) {
      add(count, colors, (W, H) => {
        const angle = Math.random() * Math.PI * 2;
        const speed = W * (0.004 + Math.random() * 0.012);
        return { x: x * W, y: y * H, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - W * 0.008 };
      });
    },
    /** Falls from the top across the whole width. */
    rain(colors, { count = 300 } = {}) {
      add(count, colors, (W, H) => ({
        x: Math.random() * W,
        y: -Math.random() * H * 0.5,
        vx: (Math.random() - 0.5) * W * 0.004,
        vy: Math.random() * H * 0.004,
      }));
    },
  };
})();

// ===================================================================
// Core: cards, taps, scenes
// ===================================================================

const Badge = (() => {
  const root = $('#scene');
  const scenes = [];
  const log = [];
  let current = null;
  let sceneTimers = new Set();
  let lastTap = { key: null, at: 0 };
  let connected = false;
  let bannerTimer = null;

  const api = {
    cards: [],
    log,
    ANIMALS,
    COLORS,
    sound: Sound,
    voice: Voice,
    confetti: Confetti,
    get connected() { return connected; },
    get current() { return current; },
    get scenes() { return scenes; },

    /**
     * Add a scene: { id, name, key, onEnter(root, Badge), onTap(event), onExit(),
     * onCards(cards), onSkip(), skipLabel, actions: [{ label, run }], onLog(entry),
     * acceptRepeats, linkMode, kid }. `kid: true` uses the bright sky theme.
     * `key` is the digit pressed with Option to switch to it.
     */
    registerScene(scene) {
      scenes.push(scene);
      scenes.sort((a, b) => (a.key === '0' ? 10 : +a.key) - (b.key === '0' ? 10 : +b.key));
      Panel.render();
    },

    show(id) {
      const next = scenes.find((s) => s.id === id) || scenes[0];
      if (current) safely(() => current.onExit?.());
      for (const t of sceneTimers) clearTimeout(t);
      sceneTimers = new Set();
      root.replaceChildren();
      root.className = `scene scene-${next.id}`;
      document.body.classList.toggle('kid-mode', !!next.kid);
      current = next;
      history.replaceState(null, '', `#${next.id}`);
      api.setLinkMode(!!next.linkMode);
      safely(() => next.onEnter?.(root, api));
      Panel.render();
    },

    /** setTimeout that is cancelled when the scene changes. */
    later(fn, ms) {
      const t = setTimeout(() => {
        sceneTimers.delete(t);
        fn();
      }, ms);
      sceneTimers.add(t);
      return t;
    },

    cancel(t) {
      clearTimeout(t);
      sceneTimers.delete(t);
    },

    async saveCards(cards) {
      const res = await fetch('/api/cards', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(cards),
      });
      if (!res.ok) throw new Error(await res.text());
      api.cards = await res.json();
      return api.cards;
    },

    async setLinkMode(enabled) {
      await fetch('/api/link-mode', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled }),
      }).catch(() => {});
    },

    async tap(id, source = 'reader') {
      try {
        const res = await fetch('/tap', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id, source }),
        });
        if (!res.ok) addLog({ kind: 'note', text: `server rejected "${id}": ${await res.text()}` });
      } catch {
        api.banner('🔌 Server not reachable', { error: true });
      }
    },

    /** Visible for `ms`, or until cleared when ms is 0. */
    banner(text, { error = false, ms = 3000 } = {}) {
      const b = $('#banner');
      clearTimeout(bannerTimer);
      if (!text) {
        b.hidden = true;
        return;
      }
      b.textContent = text;
      b.className = error ? 'error' : '';
      b.hidden = false;
      if (ms) bannerTimer = setTimeout(() => (b.hidden = true), ms);
    },
  };

  function safely(fn) {
    try {
      fn();
    } catch (err) {
      console.error(err);
      addLog({ kind: 'note', text: `scene error: ${err.message}` });
    }
  }

  function addLog(entry) {
    entry.at = Date.now();
    log.unshift(entry);
    log.length = Math.min(log.length, LOG_LIMIT);
    if (current?.onLog) safely(() => current.onLog(entry));
  }
  api.note = (text) => addLog({ kind: 'note', text });

  function handleTap(ev) {
    const key = ev.card ? ev.card.canonical_id : ev.canonical_id;
    const now = performance.now();
    ev.repeat = lastTap.key === key && now - lastTap.at < REPEAT_WINDOW_MS;
    lastTap = { key, at: now };
    addLog({ kind: 'tap', ev });
    if (current?.onTap && (!ev.repeat || current.acceptRepeats)) safely(() => current.onTap(ev));
  }

  function setCards(cards) {
    api.cards = cards;
    if (current?.onCards) safely(() => current.onCards(cards));
    Panel.render();
  }

  function connect() {
    const source = new EventSource('/events');
    source.addEventListener('open', async () => {
      connected = true;
      api.banner(null);
      try {
        setCards(await (await fetch('/api/cards')).json());
      } catch {
        /* the next cards event will catch us up */
      }
      Panel.render();
    });
    source.addEventListener('error', () => {
      connected = false;
      api.banner('🔌 Reconnecting to server…', { error: true, ms: 0 });
      Panel.render();
    });
    source.addEventListener('tap', (e) => handleTap(JSON.parse(e.data)));
    source.addEventListener('cards', (e) => setCards(JSON.parse(e.data)));
  }

  api._connect = connect;
  return api;
})();

window.Badge = Badge;

// ===================================================================
// Keyboard-wedge reader capture
// ===================================================================

const Reader = (() => {
  const input = $('#wedge');
  let buffer = '';
  let lastKeyAt = 0;
  let testMode = false;

  function keepFocus() {
    if (document.activeElement !== input) input.focus({ preventScroll: true });
  }
  input.addEventListener('blur', () => setTimeout(keepFocus, 0));
  addEventListener('focus', keepFocus);
  document.addEventListener('pointerup', () => setTimeout(keepFocus, 0));
  setInterval(keepFocus, 1000);
  keepFocus();

  document.addEventListener(
    'keydown',
    (e) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const now = performance.now();
      const slow = !testMode && now - lastKeyAt > READER_MAX_KEY_GAP_MS;
      lastKeyAt = now;
      input.value = '';

      if (e.key === 'Enter') {
        e.preventDefault();
        const id = buffer;
        buffer = '';
        if (!id) return;
        if (slow) Badge.note('reader: ignored slow typing (Option+T allows it for testing)');
        else if (id.length < READER_MIN_HEX_LEN) Badge.note(`reader: ignored "${id}" (too short)`);
        else Badge.tap(id, 'reader');
        return;
      }
      if (e.key.length !== 1) return;
      e.preventDefault();
      if (!/^[0-9a-f]$/i.test(e.key)) {
        if (buffer) Badge.note(`reader: dropped "${buffer}" (non-hex "${e.key}")`);
        buffer = '';
        return;
      }
      // A slow keystroke starts a fresh buffer, so stray human keys before a real scan are dropped.
      buffer = slow ? e.key : buffer + e.key;
    },
    true,
  );

  return {
    get testMode() { return testMode; },
    toggleTestMode() {
      testMode = !testMode;
      Badge.banner(testMode ? '⌨️ Typing test mode ON' : 'Typing test mode off', { ms: testMode ? 0 : 2000 });
      Panel.render();
    },
  };
})();

// ===================================================================
// Presenter panel + keys (always with Option/Alt so the reader can't trigger them)
// ===================================================================

const Panel = (() => {
  const panel = $('#panel');

  function fullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen?.().catch(() => {});
  }

  function toggle() {
    panel.hidden = !panel.hidden;
    render();
  }

  function button(label, key, onclick, active = false) {
    return el('button', {
      class: active ? 'active' : null,
      onclick: () => {
        onclick();
        render();
      },
    }, label, key ? el('kbd', {}, key) : null);
  }

  function render() {
    if (panel.hidden) return;
    const current = Badge.current;
    panel.replaceChildren(...[
      el('h2', {}, 'Scenes'),
      ...Badge.scenes.map((s) => button(s.name, `⌥${s.key}`, () => Badge.show(s.id), s === current)),
      el('h2', {}, 'Controls'),
      current?.onSkip ? button(current.skipLabel || 'Skip / next', '⌥S', () => current.onSkip()) : null,
      ...(current?.actions || []).map((a) => button(a.label, null, a.run)),
      button('Fullscreen', '⌥F', fullscreen, !!document.fullscreenElement),
      button(Sound.muted ? 'Sound: OFF' : 'Sound: on', '⌥M', () => (Sound.muted = !Sound.muted), Sound.muted),
      button(Voice.enabled ? 'Voice: on' : 'Voice: OFF', '⌥V', () => (Voice.enabled = !Voice.enabled), !Voice.enabled),
      button(Reader.testMode ? 'Typing test mode: ON' : 'Typing test mode: off', '⌥T', () => Reader.toggleTestMode(), Reader.testMode),
      el('h2', {}, 'Test'),
      button('Chime', null, () => Sound.chime()),
      button('Buzzer', null, () => Sound.buzzer()),
      button('Silly buzzer', null, () => Sound.silly()),
      button('Fanfare', null, () => Sound.fanfare()),
      button('Voice', null, () => Voice.say('Hello, zookeepers!')),
      button('Confetti', null, () => Confetti.burst()),
      el('h2', {}, 'Status'),
      el('div', {}, `${Badge.connected ? '🟢 Connected' : '🔴 Disconnected'} · ${Badge.cards.length} cards`),
      button('Close', '⌥P', toggle),
    ].filter(Boolean));
  }

  document.addEventListener('keydown', (e) => {
    if (!e.altKey || e.ctrlKey || e.metaKey) return;
    const code = e.code;
    let handled = true;
    if (code.startsWith('Digit')) {
      const scene = Badge.scenes.find((s) => s.key === code.slice(5));
      if (scene) Badge.show(scene.id);
    } else if (code === 'KeyP') toggle();
    else if (code === 'KeyF') fullscreen();
    else if (code === 'KeyS') Badge.current?.onSkip?.();
    else if (code === 'KeyM') Sound.muted = !Sound.muted;
    else if (code === 'KeyV') Voice.enabled = !Voice.enabled;
    else if (code === 'KeyT') Reader.toggleTestMode();
    else handled = false;
    if (handled) {
      e.preventDefault();
      render();
    }
  });

  $('#panel-hotspot').addEventListener('click', toggle);
  document.addEventListener('fullscreenchange', render);

  return { render, toggle };
})();

// ===================================================================
// Shared scene bits
// ===================================================================

function cardCircle(card) {
  return el('div', { class: 'badge-circle pop', style: `background:${card.color.hex}` },
    el('div', { class: 'huge-emoji' }, card.emoji));
}

function cardConfetti(card) {
  Confetti.burst([card.color.hex], { y: 0.45 });
}

// ===================================================================
// Scene: Setup
// ===================================================================

Badge.registerScene((() => {
  let root;
  let view; // { kind: 'idle' } | { kind: 'pick', id, card? } | { kind: 'card', card, note } | { kind: 'dup', message }
  let choice;

  const emptyChoice = () => ({ emoji: null, label: null, color: null, trick: false });

  function header() {
    const n = Badge.cards.length;
    const tricks = Badge.cards.filter((c) => c.trick).length;
    return el('div', { class: 'setup-header' },
      el('div', {}, '🛠️ Setup'),
      el('div', { class: 'count-pill' },
        `${n} badge${n === 1 ? '' : 's'} registered${tricks ? ` · ${tricks} 🎭` : ''}`));
  }

  function set(next) {
    view = next;
    render();
  }

  function render() {
    root.className = `scene scene-setup ${view.kind === 'dup' ? 'dup' : ''}`;
    root.replaceChildren(header(), ...body());
  }

  function body() {
    switch (view.kind) {
      case 'pick': return picker();
      case 'card': return [
        cardCircle(view.card),
        el('div', { class: 'big-label' }, `${view.card.label} · ${view.card.color.name}`),
        el('div', { class: 'subtitle' }, view.note, view.card.trick ? ' · 🎭 trick badge' : ''),
        el('div', { class: 'row' },
          el('button', { class: 'btn', onclick: () => startEdit(view.card) }, '✏️ Change'),
          el('button', { class: 'btn primary', onclick: () => set({ kind: 'idle' }) }, 'Done')),
      ];
      case 'dup': return [
        el('div', { class: 'title shake' }, '⚠️ DUPLICATE BADGE ⚠️'),
        el('div', { class: 'subtitle' }, view.message),
        el('button', { class: 'btn', onclick: () => set({ kind: 'idle' }) }, 'OK'),
      ];
      default: return [
        el('div', { class: 'huge-emoji pulse' }, '👆'),
        el('div', { class: 'title' }, 'Tap a badge'),
        el('div', { class: 'subtitle' }, 'To link phone + reader: tap on one, then the other'),
        el('div', { class: 'card-strip' }, Badge.cards.map((c) =>
          el('button', {
            class: `mini-card ${c.trick ? 'trick' : ''}`,
            style: `background:${c.color.hex}`,
            title: c.label,
            onclick: () => startEdit(c),
          }, c.emoji))),
      ];
    }
  }

  function picker() {
    const editing = view.card;
    const taken = new Set(Badge.cards.filter((c) => c !== editing).map((c) => c.emoji));
    const ready = choice.emoji && choice.color;
    return [
      el('div', { class: 'picker-title' }, editing ? `Change ${editing.emoji} ${editing.label}` : '✨ New badge! Pick an animal and a color'),
      el('div', { class: 'animal-grid' }, ANIMALS.map((a) =>
        el('button', {
          class: `animal ${taken.has(a.emoji) ? 'taken' : ''} ${choice.emoji === a.emoji ? 'selected' : ''}`,
          title: a.label,
          onclick: () => {
            choice.emoji = a.emoji;
            choice.label = a.label;
            render();
          },
        }, a.emoji))),
      el('div', { class: 'swatches' }, COLORS.map((c) =>
        el('button', {
          class: `swatch ${choice.color?.hex === c.hex ? 'selected' : ''}`,
          style: `background:${c.hex}`,
          title: c.name,
          onclick: () => {
            choice.color = { hex: c.hex, name: c.name };
            render();
          },
        }))),
      el('div', { class: 'selection' },
        choice.emoji ? el('span', { class: 'em' }, choice.emoji) : null,
        el('span', {}, choice.label || 'Pick an animal'),
        choice.color ? el('span', { class: 'dot', style: `background:${choice.color.hex}` }) : null,
        el('span', {}, choice.color ? choice.color.name : '· pick a color'),
        el('span', { class: 'mono subtitle' }, `· ${view.id}`)),
      el('div', { class: 'row' },
        el('button', { class: 'btn primary', disabled: ready ? null : 'disabled', onclick: save }, '💾 Save'),
        el('button', {
          class: `btn ${choice.trick ? 'trick-on' : ''}`,
          onclick: () => {
            choice.trick = !choice.trick;
            render();
          },
        }, choice.trick ? '🎭 Trick: ON' : '🎭 Trick: off'),
        el('button', { class: 'btn', onclick: () => set({ kind: 'idle' }) }, 'Cancel'),
        editing ? el('button', { class: 'btn danger', onclick: remove }, '🗑️ Delete') : null),
    ];
  }

  function startEdit(card) {
    choice = { emoji: card.emoji, label: card.label, color: card.color, trick: !!card.trick };
    set({ kind: 'pick', id: card.canonical_id, card });
  }

  async function save() {
    const { id, card } = view;
    const updated = { ...(card || { canonical_id: id, aliases: [] }), ...choice };
    const cards = card
      ? Badge.cards.map((c) => (c.canonical_id === card.canonical_id ? updated : c))
      : [...Badge.cards, updated];
    try {
      await Badge.saveCards(cards);
      Sound.chime();
      cardConfetti(updated);
      set({ kind: 'card', card: updated, note: 'Saved ✓' });
    } catch (err) {
      Sound.buzzer();
      set({ kind: 'dup', message: err.message });
    }
  }

  async function remove() {
    const target = view.card;
    try {
      await Badge.saveCards(Badge.cards.filter((c) => c.canonical_id !== target.canonical_id));
      Badge.banner(`Deleted ${target.emoji} ${target.label}`);
      set({ kind: 'idle' });
    } catch (err) {
      set({ kind: 'dup', message: err.message });
    }
  }

  return {
    id: 'setup',
    name: '🛠️ Setup',
    key: '1',
    acceptRepeats: true,
    linkMode: true,
    onEnter(r) {
      root = r;
      choice = emptyChoice();
      set({ kind: 'idle' });
    },
    onCards: () => render(),
    onTap(ev) {
      if (ev.card) {
        if (ev.linked) {
          Sound.chime();
          cardConfetti(ev.card);
        } else if (!ev.repeat) Sound.chime();
        const note = ev.linked ? `🔗 Linked ${ev.source} ID ${ev.canonical_id}` : `Already registered ✓ (${ev.source})`;
        set({ kind: 'card', card: ev.card, note });
      } else if (!(view.kind === 'pick' && view.id === ev.canonical_id)) {
        choice = emptyChoice();
        set({ kind: 'pick', id: ev.canonical_id });
      }
    },
  };
})());

// ===================================================================
// Scene: Secret Number
// ===================================================================

Badge.registerScene((() => {
  const FIRST_DIGIT_MS = 700;
  const DIGIT_MS = 450;
  let root;
  let timers = [];

  function idle() {
    root.replaceChildren(
      el('div', { class: 'huge-emoji pulse' }, '🔢'),
      el('div', { class: 'title' }, 'Tap a badge to see its secret number!'));
  }

  function reveal(raw) {
    for (const t of timers) Badge.cancel(t);
    const chars = [...raw.toUpperCase().replace(/[^0-9A-F]/g, '')];
    const digits = chars.map((ch) => el('span', { class: 'digit hidden' }, ch));
    root.replaceChildren(
      el('div', { class: 'title' }, '🤫 The secret number is…'),
      el('div', { class: 'digits', style: `--n:${chars.length}` }, digits));
    Voice.say('The secret number is');
    timers = digits.map((d, i) => Badge.later(() => {
      d.classList.remove('hidden');
      d.classList.add('pop');
      Sound.tick(i);
      Voice.say(chars[i] === '0' ? 'zero' : chars[i], { queue: true, rate: 1.1 });
    }, FIRST_DIGIT_MS + i * DIGIT_MS));
    timers.push(Badge.later(() => Sound.chime(), FIRST_DIGIT_MS + chars.length * DIGIT_MS + 100));
  }

  return {
    id: 'secret',
    name: '🔢 Secret Number',
    key: '2',
    kid: true,
    acceptRepeats: true,
    onEnter(r) {
      root = r;
      timers = [];
      idle();
    },
    onTap: (ev) => reveal(ev.raw_id),
  };
})());

// ===================================================================
// Scene: Zoo Gate
// ===================================================================

/** A round badge-colored token with the card's emoji, sized in vmin. */
function ring(card, size, attrs = {}) {
  return el('div', {
    class: 'ring',
    style: `background:${card.color.hex};width:${size}vmin;height:${size}vmin;font-size:${size * 0.62}vmin`,
    title: card.label,
    'data-id': card.canonical_id,
    ...attrs,
  }, card.emoji);
}

function shuffle(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

Badge.registerScene((() => {
  const STORE_KEY = 'zoo-gate-v1';
  const WALK_MS = 2600;
  const AUTO_OPEN_DELAY_MS = 2200;
  const PARADE_STAGGER_MS = 350;
  const PARADE_CROSS_MS = 4500;

  let root;
  let state = load();
  let els = {};
  let slots = [];
  let walking = 0;
  let generation = 0;
  let deniedTimer;
  let hintTimer;

  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(STORE_KEY));
      if (s && Array.isArray(s.checkedIn)) return { checkedIn: s.checkedIn, open: !!s.open };
    } catch {
      /* private window or corrupt value: start fresh */
    }
    return { checkedIn: [], open: false };
  }

  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
    } catch {
      /* not fatal: check-ins just won't survive a reload */
    }
  }

  const cardById = (id) => Badge.cards.find((c) => c.canonical_id === id);
  // Stored ids may include cards not loaded yet (or deleted); only display the ones we know.
  const insideCards = () => state.checkedIn.map(cardById).filter(Boolean);
  const colors = () => Badge.cards.map((c) => c.color.hex);

  function counts() {
    const real = Badge.cards.filter((c) => !c.trick);
    const inside = new Set(state.checkedIn);
    return { done: real.filter((c) => inside.has(c.canonical_id)).length, total: real.length };
  }

  function updateCounter() {
    const { done, total } = counts();
    els.counter.replaceChildren(total
      ? el('span', {}, el('b', {}, done), ` of ${total} zookeepers checked in`)
      : 'No zookeepers registered yet');
    els.progress.style.width = `${total ? (100 * done) / total : 0}%`;
  }

  function hint(text) {
    Badge.cancel(hintTimer);
    els.arrive.replaceChildren();
    els.hint.replaceChildren(el('div', { class: 'welcome' }, text));
  }

  function idleHint() {
    Badge.cancel(hintTimer);
    els.arrive.replaceChildren(el('div', { class: 'huge-emoji-sm pulse' }, '👆'));
    els.hint.replaceChildren('Tap your badge!');
  }

  function filledSlot(card) {
    return el('div', {
      class: 'zoo-slot filled',
      style: `background:${card.color.hex}`,
      'data-id': card.canonical_id,
      title: card.label,
    }, card.emoji);
  }

  function renderGate() {
    generation++;
    walking = 0;
    root.className = 'scene scene-zoo';
    const inside = insideCards();
    slots = Badge.cards.map((_, i) => (inside[i] ? filledSlot(inside[i]) : el('div', { class: 'zoo-slot empty' })));
    els = {
      counter: el('div', { class: 'zoo-counter' }),
      progress: el('div', { class: 'zoo-progress-fill' }),
      arrive: el('div', { class: 'zoo-arrive' }),
      hint: el('div', { class: 'zoo-hint' }),
      gate: el('div', { class: 'zoo-gate' },
        el('div', { class: 'gate-sign' }, '🦒 ZOO 🐘'),
        el('div', { class: 'gate-frame' },
          el('div', { class: 'door left' }),
          el('div', { class: 'door right' }),
          el('div', { class: 'gate-lock' }, '🔒'))),
      grid: el('div', { class: 'zoo-grid' }, slots),
    };
    els.inside = el('div', { class: 'zoo-inside' }, els.grid);
    root.replaceChildren(
      el('div', { class: 'zoo-top' }, els.counter, el('div', { class: 'zoo-progress' }, els.progress)),
      el('div', { class: 'zoo-stage' }, el('div', { class: 'zoo-outside' }, els.arrive, els.hint), els.gate, els.inside));
    updateCounter();
    idleHint();
    requestAnimationFrame(layoutSlots);
  }

  /** Pick the column count that gives the biggest square slots in the zoo area. */
  function layoutSlots() {
    if (!els.inside?.isConnected || !slots.length) return;
    const style = getComputedStyle(els.inside);
    const W = els.inside.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    const H = els.inside.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
    const gap = Math.min(innerWidth, innerHeight) * 0.012;
    let best = { cols: 1, size: 0 };
    for (let cols = 1; cols <= slots.length; cols++) {
      const rows = Math.ceil(slots.length / cols);
      const size = Math.min((W - gap * (cols - 1)) / cols, (H - gap * (rows - 1)) / rows);
      if (size > best.size) best = { cols, size };
    }
    const size = Math.floor(Math.min(best.size, Math.min(innerWidth, innerHeight) * 0.2));
    els.grid.style.gridTemplateColumns = `repeat(${best.cols}, ${size}px)`;
    els.grid.style.setProperty('--slot', `${size}px`);
  }

  function center(rect, size) {
    return [rect.left + rect.width / 2 - size / 2, rect.top + rect.height / 2 - size / 2];
  }

  function walkIn(card, index) {
    const target = slots[index];
    const gen = generation;
    const size = target.getBoundingClientRect().width;
    const from = els.arrive.getBoundingClientRect();
    const [x0, y0] = center(from, size);
    const big = Math.min(2.2, (from.height * 0.95) / size);
    const [x1, y1] = center(els.gate.getBoundingClientRect(), size);
    const [x2, y2] = center(target.getBoundingClientRect(), size);
    const walker = el('div', {
      class: 'walker',
      style: `width:${size}px;height:${size}px;font-size:${size * 0.62}px`,
    }, el('div', { class: 'bob ring', style: `background:${card.color.hex}` }, card.emoji));
    root.append(walker);
    hint(`Welcome, ${card.label} keeper!`);
    Voice.say(`Welcome, ${card.label} keeper!`);
    hintTimer = Badge.later(idleHint, WALK_MS + 800);
    walking++;
    els.gate.classList.add('ajar');
    Sound.chime();
    Confetti.burst([card.color.hex], { x: (from.left + from.width / 2) / innerWidth, y: 0.5 });

    walker.animate([
      { transform: `translate(${x0}px, ${y0}px) scale(${big})`, offset: 0 },
      { transform: `translate(${x0}px, ${y0}px) scale(${big})`, offset: 0.2 },
      { transform: `translate(${x1}px, ${y1}px) scale(${(big + 1) / 2})`, offset: 0.55 },
      { transform: `translate(${x2}px, ${y2}px) scale(1)`, offset: 1 },
    ], { duration: WALK_MS, easing: 'ease-in-out', fill: 'forwards' }).finished.then(() => {
      walker.remove();
      if (gen !== generation) return;
      const filled = filledSlot(card);
      filled.classList.add('pop');
      target.replaceWith(filled);
      slots[index] = filled;
      if (--walking === 0) els.gate.classList.remove('ajar');
    }).catch(() => {});
  }

  function denied() {
    Sound.buzzer();
    Voice.say('Access denied!', { pitch: 1.6 });
    Badge.cancel(deniedTimer);
    root.querySelector('.zoo-denied')?.remove();
    root.append(el('div', { class: 'zoo-denied' },
      el('div', { class: 'huge-emoji wobble' }, '🙅'),
      el('div', { class: 'title shake' }, 'ACCESS DENIED'),
      el('div', { class: 'subtitle' }, 'That badge is not a zoo badge!')));
    deniedTimer = Badge.later(() => root.querySelector('.zoo-denied')?.remove(), 2500);
  }

  function openGate() {
    if (state.open) return;
    state.open = true;
    save();
    els.gate?.classList.remove('ajar');
    els.gate?.classList.add('open');
    Sound.fanfare();
    Voice.say('Everyone is here! Open the gate!');
    Confetti.rain(colors());
    Badge.later(parade, 1600);
  }

  function parade() {
    root.classList.add('finale');
    const lane = el('div', { class: 'parade' });
    root.append(lane);
    const vmin = Math.min(innerWidth, innerHeight) / 100;
    const cards = Badge.cards;
    cards.forEach((card, i) => {
      const marcher = el('div', { class: 'marcher' }, el('div', { class: 'bob-hop' }, ring(card, 16)));
      lane.append(marcher);
      const y = (i % 2 ? 6 : -22) * vmin;
      marcher.animate([
        { transform: `translate(${-20 * vmin}px, ${y}px)` },
        { transform: `translate(${innerWidth + 4 * vmin}px, ${y}px)` },
      ], { duration: PARADE_CROSS_MS, delay: i * PARADE_STAGGER_MS, fill: 'both' });
    });
    Badge.later(() => showFinale(true), Math.max(cards.length - 1, 0) * PARADE_STAGGER_MS + PARADE_CROSS_MS);
  }

  function showFinale(celebrate) {
    root.className = 'scene scene-zoo finale';
    root.replaceChildren(el('div', { class: 'zoo-finale' },
      el('div', { class: 'huge-emoji-sm pop' }, '🏆'),
      el('div', { class: 'title finale-title pop' }, 'Congratulations, Official Zookeepers!'),
      el('div', { class: 'finale-animals' }, Badge.cards.map((c) => ring(c, 10)))));
    if (celebrate) {
      Sound.fanfare();
      Voice.say('Congratulations, Official Zookeepers!');
      Confetti.rain(colors(), { count: 450 });
    }
  }

  function render() {
    if (state.open) showFinale(false);
    else renderGate();
  }

  function reset() {
    state = { checkedIn: [], open: false };
    save();
    Badge.show('zoo');
  }

  function bounce(node) {
    if (!node) return;
    node.classList.remove('pop');
    void node.offsetWidth;
    node.classList.add('pop');
  }

  return {
    id: 'zoo',
    name: '🦁 Zoo Gate',
    key: '3',
    kid: true,
    onEnter(r) {
      root = r;
      state = load();
      render();
      addEventListener('resize', layoutSlots);
      const { done, total } = counts();
      if (!state.open && total && done === total) Badge.later(openGate, AUTO_OPEN_DELAY_MS);
    },
    onExit() {
      removeEventListener('resize', layoutSlots);
      generation++;
    },
    onCards() {
      if (!state.open && !root.classList.contains('finale')) render();
    },
    onSkip: openGate,
    skipLabel: '🔓 Open the gate now',
    actions: [{ label: '🔄 Reset check-ins', run: reset }],
    onTap(ev) {
      if (!ev.card) return denied();
      const card = ev.card;
      if (state.open) {
        Sound.chime();
        Confetti.burst([card.color.hex]);
        bounce(root.querySelector(`.finale-animals [data-id="${card.canonical_id}"]`));
        return;
      }
      if (state.checkedIn.includes(card.canonical_id)) {
        Sound.tick(4);
        bounce(slots.find((s) => s.dataset.id === card.canonical_id));
        hint(`${card.emoji} is already inside!`);
        hintTimer = Badge.later(idleHint, 2000);
        return;
      }
      state.checkedIn.push(card.canonical_id);
      save();
      walkIn(card, insideCards().length - 1);
      updateCounter();
      const { done, total } = counts();
      if (total && done === total) Badge.later(openGate, AUTO_OPEN_DELAY_MS);
    },
  };
})());

// ===================================================================
// Scene: The List
// ===================================================================

Badge.registerScene((() => {
  const SCAN_ROW_MS = 70;
  let root;
  let hitId = null;
  let lookup = null; // { raw, card, searching }
  let scanTimers = [];

  function lookupLine() {
    if (!lookup) return el('div', { class: 'list-lookup' }, 'Tap a badge: the computer looks up its secret number!');
    const raw = lookup.raw.toUpperCase();
    let result;
    if (lookup.searching) result = el('span', { class: 'searching' }, 'looking… 🤔');
    else if (lookup.card) result = [el('span', { class: 'em' }, lookup.card.emoji), ` ${lookup.card.label}!`];
    else result = '❌ Not on the list!';
    return el('div', { class: `list-lookup ${lookup.searching ? '' : 'pop'}` },
      el('span', { class: 'mono' }, `🔍 ${raw}`), ' → ', result);
  }

  function render() {
    const cards = Badge.cards;
    const cols = cards.length <= 10 ? 1 : cards.length <= 26 ? 2 : 3;
    const rows = Math.max(1, Math.ceil(cards.length / cols));
    root.className = 'scene scene-list';
    root.replaceChildren(
      el('div', { class: 'title list-title' }, '📋 The List'),
      lookupLine(),
      cards.length
        ? el('div', { class: 'list-grid', 'data-rows': rows }, cards.map((c) => el('div', {
          class: `list-row ${c.canonical_id === hitId ? 'hit' : ''}`,
          'data-id': c.canonical_id,
        },
        el('span', { class: 'list-num mono' }, c.canonical_id),
        el('span', { class: 'em' }, c.emoji),
        el('span', { class: 'list-swatch', style: `background:${c.color.hex}`, title: c.color.name }))))
        : el('div', { class: 'subtitle' }, 'No badges registered yet'));
    fit();
  }

  /** Size rows to fill whatever height is left below the lookup line. */
  function fit() {
    const grid = root.querySelector('.list-grid');
    if (!grid) return;
    const rows = Number(grid.dataset.rows);
    const vmin = Math.min(innerWidth, innerHeight) / 100;
    const avail = innerHeight - grid.getBoundingClientRect().top - 3 * vmin;
    const h = Math.max(2 * vmin, Math.min(9 * vmin, (avail - 0.6 * vmin * (rows - 1)) / rows));
    grid.style.gridTemplateRows = `repeat(${rows}, ${h}px)`;
    grid.style.setProperty('--row', `${h}px`);
  }

  return {
    id: 'list',
    name: '📋 The List',
    key: '4',
    kid: true,
    acceptRepeats: true,
    onEnter(r) {
      root = r;
      hitId = null;
      lookup = null;
      render();
      addEventListener('resize', fit);
    },
    onExit() {
      removeEventListener('resize', fit);
    },
    onCards: () => render(),
    onTap(ev) {
      for (const t of scanTimers) Badge.cancel(t);
      lookup = { raw: ev.raw_id, card: ev.card, searching: true };
      hitId = null;
      render();
      // Visibly run down the list until the matching row (or the end), then show the result.
      const rows = [...root.querySelectorAll('.list-row')];
      const stop = ev.card ? rows.findIndex((r) => r.dataset.id === ev.card.canonical_id) : rows.length - 1;
      scanTimers = rows.slice(0, stop + 1).map((row, i) => Badge.later(() => {
        row.classList.add('scan');
        Sound.tick(i % 8);
        Badge.later(() => row.classList.remove('scan'), SCAN_ROW_MS * 2);
      }, i * SCAN_ROW_MS));
      scanTimers.push(Badge.later(() => {
        lookup.searching = false;
        hitId = ev.card?.canonical_id ?? null;
        render();
        if (ev.card) {
          Sound.chime();
          Voice.say(`Found it! ${ev.card.label}!`);
        } else {
          Sound.buzzer();
          Voice.say('Not on the list!', { pitch: 1.6 });
        }
      }, (stop + 1) * SCAN_ROW_MS + 150));
    },
  };
})());

// ===================================================================
// Scene: Who has the ___?
// ===================================================================

Badge.registerScene((() => {
  const NEXT_AFTER_CORRECT_MS = 4000;
  const NOPE_MS = 1800;
  let root;
  let target = null;
  let bag = [];
  let celebrating = false;
  let timer;

  function pickNext() {
    const cards = Badge.cards;
    const previous = target?.canonical_id;
    target = null;
    if (!cards.length) return;
    for (let tries = 0; tries < 2 && !target; tries++) {
      if (!bag.length) {
        const ids = cards.map((c) => c.canonical_id);
        bag = shuffle(cards.length > 1 ? ids.filter((id) => id !== previous) : ids);
      }
      while (bag.length && !target) {
        const id = bag.pop();
        target = cards.find((c) => c.canonical_id === id) || null;
      }
    }
  }

  function ask() {
    celebrating = false;
    root.className = 'scene scene-who';
    if (!target && Badge.cards.length) pickNext();
    if (!target) {
      root.replaceChildren(el('div', { class: 'title' }, 'Register some badges first!'));
      return;
    }
    root.replaceChildren(
      el('div', { class: 'title' }, 'Who has the'),
      el('div', { class: 'who-target', 'data-id': target.canonical_id }, cardCircle(target)),
      el('div', { class: 'big-label' }, `${target.label}?`));
  }

  function askAloud() {
    ask();
    if (target) Voice.say(`Who has the ${target.label}?`);
  }

  function next() {
    Badge.cancel(timer);
    pickNext();
    askAloud();
  }

  return {
    id: 'who',
    name: '❓ Who has the ___?',
    key: '5',
    kid: true,
    onEnter(r) {
      root = r;
      target = null;
      next();
    },
    onSkip: next,
    skipLabel: '⏭️ Next animal',
    onCards() {
      if (celebrating) return;
      const fresh = target && Badge.cards.find((c) => c.canonical_id === target.canonical_id);
      if (fresh) {
        target = fresh;
        ask();
      } else next();
    },
    onTap(ev) {
      if (celebrating || !target) return;
      Badge.cancel(timer);
      if (ev.card?.canonical_id === target.canonical_id) {
        celebrating = true;
        root.className = 'scene scene-who';
        root.replaceChildren(
          el('div', { class: 'title pop' }, 'Yes! 🎉'),
          cardCircle(target),
          el('div', { class: 'big-label' }, `It's the ${target.label}!`));
        Sound.chime();
        Voice.say(`Yes! It's the ${target.label}!`);
        Confetti.burst([target.color.hex], { y: 0.45, count: 260 });
        timer = Badge.later(next, NEXT_AFTER_CORRECT_MS);
        return;
      }
      Sound.silly();
      Voice.say(ev.card ? `Nope! That's the ${ev.card.label}!` : 'Nope! Not a zoo badge!', { pitch: 1.5 });
      root.className = 'scene scene-who nope';
      root.replaceChildren(
        el('div', { class: 'title shake' }, 'Nope! 🙈'),
        ev.card ? ring(ev.card, 30) : el('div', { class: 'huge-emoji-sm' }, '❓'),
        el('div', { class: 'big-label' }, ev.card ? `That's the ${ev.card.label}` : 'Not a zoo badge!'));
      timer = Badge.later(ask, NOPE_MS);
    },
  };
})());

// ===================================================================
// Scene: Debug
// ===================================================================

Badge.registerScene((() => {
  let root;
  const SHOW = 18;

  function row(entry) {
    const time = new Date(entry.at).toLocaleTimeString();
    if (entry.kind === 'note') {
      return el('tr', {}, el('td', {}, time), el('td', { class: 'note', colspan: '4' }, entry.text));
    }
    const { ev } = entry;
    const flags = [ev.linked && '🔗 linked', ev.repeat && 'repeat'].filter(Boolean).join(' ');
    return el('tr', {},
      el('td', {}, time),
      el('td', {}, ev.source === 'phone' ? '📱 phone' : '⌨️ reader'),
      el('td', { class: 'mono' }, ev.raw_id),
      el('td', { class: 'mono' }, ev.canonical_id),
      ev.card
        ? el('td', {}, el('span', { class: 'em' }, ev.card.emoji), ` ${ev.card.label}${ev.card.trick ? ' 🎭' : ''} ${flags}`)
        : el('td', { class: 'miss' }, `— unknown ${flags}`));
  }

  function render() {
    root.replaceChildren(
      el('div', { class: 'title' }, '🐞 Debug'),
      el('div', { class: 'debug-status' },
        el('span', {}, Badge.connected ? '🟢 SSE connected' : '🔴 SSE disconnected'),
        el('span', {}, `${Badge.cards.length} cards`),
        el('span', {}, `reader gap ≤ ${READER_MAX_KEY_GAP_MS}ms, ≥ ${READER_MIN_HEX_LEN} hex`),
        el('span', {}, Reader.testMode ? '⌨️ typing test mode ON' : 'typing test mode off')),
      el('div', { class: 'debug-log' },
        el('table', {},
          el('tr', {}, ['Time', 'Source', 'raw_id', 'canonical_id', 'Card'].map((h) => el('th', {}, h))),
          Badge.log.slice(0, SHOW).map(row))));
  }

  return {
    id: 'debug',
    name: '🐞 Debug',
    key: '0',
    acceptRepeats: true,
    onEnter(r) {
      root = r;
      render();
    },
    onLog: () => render(),
    onCards: () => render(),
  };
})());

// ===================================================================
// Start
// ===================================================================

(() => {
  const start = $('#start');
  function begin() {
    if (start.hidden) return;
    start.hidden = true;
    Sound.unlock();
  }
  start.addEventListener('click', () => {
    begin();
    document.documentElement.requestFullscreen?.().catch(() => {});
  });
  document.addEventListener('keydown', begin);

  Badge._connect();
  Badge.show(location.hash.slice(1) || 'setup');
})();
