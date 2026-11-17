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
    chime() {
      [784, 988, 1319].forEach((f, i) => {
        tone(f, i * 0.11, 0.6, { gain: 0.3 });
        tone(f * 2, i * 0.11, 0.3, { type: 'triangle', gain: 0.06 });
      });
    },
    buzzer() {
      [0, 0.32].forEach((s) => {
        tone(110, s, 0.28, { type: 'square', gain: 0.22 });
        tone(116, s, 0.28, { type: 'sawtooth', gain: 0.15 });
      });
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
    confetti: Confetti,
    get connected() { return connected; },
    get current() { return current; },
    get scenes() { return scenes; },

    /**
     * Add a scene: { id, name, key, onEnter(root, Badge), onTap(event), onExit(),
     * onCards(cards), onSkip(), onLog(entry), acceptRepeats, linkMode }.
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

    cardColor(card) {
      return card?.color || null;
    },

    colorName(hex) {
      return COLORS.find((c) => c.hex.toLowerCase() === (hex || '').toLowerCase())?.name || hex || 'No color';
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
      current?.onSkip ? button('Skip / next', '⌥S', () => current.onSkip()) : null,
      button('Fullscreen', '⌥F', fullscreen, !!document.fullscreenElement),
      button(Sound.muted ? 'Sound: OFF' : 'Sound: on', '⌥M', () => (Sound.muted = !Sound.muted), Sound.muted),
      button(Reader.testMode ? 'Typing test mode: ON' : 'Typing test mode: off', '⌥T', () => Reader.toggleTestMode(), Reader.testMode),
      el('h2', {}, 'Test'),
      button('Chime', null, () => Sound.chime()),
      button('Buzzer', null, () => Sound.buzzer()),
      button('Silly buzzer', null, () => Sound.silly()),
      button('Fanfare', null, () => Sound.fanfare()),
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
  return el('div', { class: 'badge-circle pop', style: `background:${card.color || '#333'}` },
    el('div', { class: 'huge-emoji' }, card.emoji));
}

function cardConfetti(card) {
  Confetti.burst(card.color ? [card.color] : null, { y: 0.45 });
}

// ===================================================================
// Scene: Setup
// ===================================================================

Badge.registerScene((() => {
  let root;
  let view; // { kind: 'idle' } | { kind: 'pick', id, card? } | { kind: 'card', card, note } | { kind: 'dup', message }
  let choice = { emoji: null, label: null, color: null };

  function header() {
    return el('div', { class: 'setup-header' },
      el('div', {}, '🛠️ Setup'),
      el('div', { class: 'count-pill' }, `${Badge.cards.length} badge${Badge.cards.length === 1 ? '' : 's'} registered`));
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
        el('div', { class: 'big-label' }, view.card.label),
        el('div', { class: 'subtitle' }, view.note),
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
            class: 'mini-card',
            style: `background:${c.color || '#333'}`,
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
          class: `swatch ${choice.color === c.hex ? 'selected' : ''}`,
          style: `background:${c.hex}`,
          title: c.name,
          onclick: () => {
            choice.color = c.hex;
            render();
          },
        }))),
      el('div', { class: 'selection' },
        choice.emoji ? el('span', { class: 'em' }, choice.emoji) : null,
        el('span', {}, choice.label || 'Pick an animal'),
        choice.color ? el('span', { class: 'dot', style: `background:${choice.color}` }) : null,
        el('span', {}, choice.color ? Badge.colorName(choice.color) : '· pick a color'),
        el('span', { class: 'mono subtitle' }, `· ${view.id}`)),
      el('div', { class: 'row' },
        el('button', { class: 'btn primary', disabled: ready ? null : 'disabled', onclick: save }, '💾 Save'),
        el('button', { class: 'btn', onclick: () => set({ kind: 'idle' }) }, 'Cancel'),
        editing ? el('button', { class: 'btn danger', onclick: remove }, '🗑️ Delete') : null),
    ];
  }

  function startEdit(card) {
    choice = { emoji: card.emoji, label: card.label, color: card.color || null };
    set({ kind: 'pick', id: card.canonical_id, card });
  }

  async function save() {
    const { id, card } = view;
    const updated = { ...(card || { canonical_id: id, aliases: [] }), ...choice };
    if (!updated.color) delete updated.color;
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
        choice = { emoji: null, label: null, color: null };
        set({ kind: 'pick', id: ev.canonical_id });
      }
    },
  };
})());

// ===================================================================
// Scene: Free tap
// ===================================================================

Badge.registerScene((() => {
  let root;
  let resetTimer;

  function idle() {
    root.className = 'scene scene-free';
    root.replaceChildren(
      el('div', { class: 'huge-emoji pulse' }, '👋'),
      el('div', { class: 'title' }, 'Tap your badge!'));
  }

  return {
    id: 'free',
    name: '👋 Free tap',
    key: '2',
    onEnter(r) {
      root = r;
      idle();
    },
    onTap(ev) {
      Badge.cancel(resetTimer);
      if (ev.card) {
        root.className = 'scene scene-free';
        root.replaceChildren(cardCircle(ev.card), el('div', { class: 'big-label pop' }, ev.card.label));
        Sound.chime();
        cardConfetti(ev.card);
      } else {
        root.className = 'scene scene-free denied';
        root.replaceChildren(
          el('div', { class: 'huge-emoji shake' }, '⛔'),
          el('div', { class: 'title shake' }, 'ACCESS DENIED'));
        Sound.buzzer();
      }
      resetTimer = Badge.later(idle, 4000);
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
        ? el('td', {}, el('span', { class: 'em' }, ev.card.emoji), ` ${ev.card.label} ${flags}`)
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
  Badge.show(location.hash.slice(1) || 'free');
})();
