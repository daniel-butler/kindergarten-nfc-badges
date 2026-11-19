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
    /** Soft, friendly "try again". */
    boop() {
      tone(520, 0, 0.14, { type: 'sine', gain: 0.18, slideTo: 400 });
      tone(400, 0.13, 0.18, { type: 'sine', gain: 0.15, slideTo: 330 });
    },
    /** Pencil scribbling on the Zoo List. */
    scribble() {
      for (let i = 0; i < 10; i++) tone(900 + (i % 3) * 140, 0.3 + i * 0.09, 0.05, { type: 'square', gain: 0.03 });
    },
    /** Curious "hmm?" for a vote. */
    wonder() {
      tone(392, 0, 0.22, { type: 'triangle', gain: 0.2 });
      tone(523, 0.2, 0.4, { type: 'triangle', gain: 0.2, slideTo: 660, vibrato: 6 });
    },
    /** Gatekeeper goose. */
    honk() {
      [0, 0.28].forEach((s) => {
        tone(330, s, 0.22, { type: 'sawtooth', gain: 0.16, slideTo: 260, vibrato: 18 });
        tone(336, s, 0.22, { type: 'square', gain: 0.08, slideTo: 262 });
      });
    },
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
// Shared log: what the page sees goes into badge-server.log next to the server's and the phone's
// ===================================================================

const PageLog = (() => {
  const MAX_QUEUED = 200; // kept while the server is unreachable, sent when it's back
  const queue = [];
  let timer = 0;

  const stamp = () => {
    const d = new Date();
    return `${d.toTimeString().slice(0, 8)}.${String(d.getMilliseconds()).padStart(3, '0')}`;
  };

  function log(message) {
    console.log('[zoo]', message);
    queue.push(`${stamp()} ${message}`);
    if (queue.length > MAX_QUEUED) queue.splice(0, queue.length - MAX_QUEUED);
    if (!timer) timer = setTimeout(flush, 500);
  }

  async function flush() {
    timer = 0;
    const lines = queue.splice(0, 50);
    if (!lines.length) return;
    try {
      const res = await fetch('/api/log', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ source: 'page', lines }),
        keepalive: true,
      });
      if (!res.ok) throw new Error(res.status);
    } catch {
      queue.unshift(...lines);
      if (queue.length > MAX_QUEUED) queue.splice(0, queue.length - MAX_QUEUED);
      timer = setTimeout(flush, 3000);
      return;
    }
    if (queue.length) timer = setTimeout(flush, 0);
  }

  addEventListener('pagehide', () => {
    if (queue.length) {
      const body = JSON.stringify({ source: 'page', lines: queue.splice(0, 50) });
      navigator.sendBeacon('/api/log', new Blob([body], { type: 'application/json' }));
    }
  });
  addEventListener('error', (e) => log(`error: ${e.message} (${e.filename?.split('/').pop()}:${e.lineno})`));
  addEventListener('unhandledrejection', (e) => log(`error: ${e.reason?.message || e.reason}`));
  document.addEventListener('visibilitychange', () => log(`page ${document.visibilityState}`));
  addEventListener('online', () => log('browser online'));
  addEventListener('offline', () => log('browser offline'));
  log(`page loaded (${navigator.userAgent.match(/(Firefox|Chrome|Safari)\/[\d.]+/)?.[0] || 'browser'})`);

  return { log };
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
    lastUnknown: null,
    ANIMALS,
    COLORS,
    sound: Sound,
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
      PageLog.log(`scene → ${next.id}`);
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
      PageLog.log(`scene error: ${err.message}`);
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
    if (!ev.card) {
      api.lastUnknown = ev.raw_id;
      Panel.render();
    }
    const key = ev.card ? ev.card.canonical_id : ev.canonical_id;
    const now = performance.now();
    ev.repeat = lastTap.key === key && now - lastTap.at < REPEAT_WINDOW_MS;
    lastTap = { key, at: now };
    PageLog.log(`tap ${ev.raw_id} → ${ev.card ? `${ev.card.emoji} ${ev.card.label}` : 'unknown'}${ev.repeat ? ' (repeat)' : ''}`);
    addLog({ kind: 'tap', ev });
    if (current?.onTap && (!ev.repeat || current.acceptRepeats)) safely(() => current.onTap(ev));
  }

  function setCards(cards) {
    api.cards = cards;
    if (current?.onCards) safely(() => current.onCards(cards));
    Panel.render();
  }

  let source = null;
  let lastEventId = ''; // so a brand-new connection can still catch up on what it missed
  let retryTimer = 0;

  function connect() {
    clearTimeout(retryTimer);
    source?.close();
    const es = new EventSource(lastEventId ? `/events?last=${encodeURIComponent(lastEventId)}` : '/events');
    source = es;
    const remember = (e) => {
      if (e.lastEventId) lastEventId = e.lastEventId;
    };
    es.addEventListener('open', async () => {
      if (source !== es) return;
      connected = true;
      PageLog.log('connected to server');
      api.banner(null);
      try {
        setCards(await (await fetch('/api/cards')).json());
      } catch {
        /* the next cards event will catch us up */
      }
      Panel.render();
    });
    es.addEventListener('error', () => {
      if (source !== es) return;
      const closed = es.readyState === EventSource.CLOSED;
      if (connected || closed) PageLog.log(`lost connection to server (${closed ? 'closed' : 'retrying'})`);
      connected = false;
      api.banner('🔌 Reconnecting to server…', { error: true, ms: 0 });
      Panel.render();
      // The browser retries by itself, except when it has given up for good (e.g. after a bad
      // answer): then only a new connection brings the page back.
      if (closed) retryTimer = setTimeout(connect, 2000);
    });
    es.addEventListener('hello', remember);
    es.addEventListener('tap', (e) => {
      remember(e);
      handleTap(JSON.parse(e.data));
    });
    es.addEventListener('cards', (e) => {
      remember(e);
      setCards(JSON.parse(e.data));
    });
    es.addEventListener('command', (e) => {
      remember(e);
      const { action, card } = JSON.parse(e.data);
      PageLog.log(`command ${action}${card ? ` for ${card}` : ''}`);
      Commands.run(action, card);
    });
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
      button("💤 Everyone's here", null, () => fetch('/api/cards/clear-away', { method: 'POST' }).catch(() => {})),
      button(Sound.muted ? 'Sound: OFF' : 'Sound: on', '⌥M', () => (Sound.muted = !Sound.muted), Sound.muted),
      button(Reader.testMode ? 'Typing test mode: ON' : 'Typing test mode: off', '⌥T', () => Reader.toggleTestMode(), Reader.testMode),
      el('h2', {}, 'Test'),
      button('Chime', null, () => Sound.chime()),
      button('Buzzer', null, () => Sound.buzzer()),
      button('Silly buzzer', null, () => Sound.silly()),
      button('Fanfare', null, () => Sound.fanfare()),
      button('Confetti', null, () => Confetti.burst()),
      el('h2', {}, 'Zoo'),
      button('📋 Zoo List', '⌥L', () => Commands.send('toggle-list')),
      button('👍 Let in', '⌥Y', () => Commands.send('let-in')),
      button('👎 Keep out', '⌥N', () => Commands.send('keep-out')),
      button('⭐ Allow golden', '⌥A', () => Commands.send('allow-special')),
      button(performance.now() < resetArmedUntil ? '⚠️ Click again to reset' : '🔄 Reset the zoo', '⌥R ⌥R', requestReset),
      el('h2', {}, 'Status'),
      el('div', {}, `${Badge.connected ? '🟢 Connected' : '🔴 Disconnected'} · ${Badge.cards.length} cards`),
      Badge.lastUnknown ? el('div', { class: 'mono' }, `Last unknown: ${Badge.lastUnknown}`) : null,
      button('Close', '⌥P', toggle),
    ].filter(Boolean));
  }

  let resetArmedUntil = 0;

  /** Reset needs a second press (key or panel click) within 3 s. */
  function requestReset() {
    if (performance.now() < resetArmedUntil) {
      resetArmedUntil = 0;
      Badge.banner(null);
      Commands.send('reset');
    } else {
      resetArmedUntil = performance.now() + 3000;
      Badge.banner('Press ⌥R again to reset the zoo', { ms: 3000 });
      setTimeout(render, 3050);
    }
    render();
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
    else if (code === 'KeyL') Commands.send('toggle-list');
    else if (code === 'KeyY') Commands.send('let-in');
    else if (code === 'KeyN') Commands.send('keep-out');
    else if (code === 'KeyA') Commands.send('allow-special');
    else if (code === 'KeyR') requestReset();
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

/** The card's sticker photo when it has one, else its emoji. `sizeVmin` null lets CSS size it. */
function cardArt(card, sizeVmin) {
  if (card.image) {
    return el('img', {
      class: 'sticker',
      src: card.image,
      alt: card.label,
      draggable: 'false',
      style: sizeVmin ? `height:${sizeVmin}vmin` : null,
    });
  }
  return el('span', { class: 'emoji-art', style: sizeVmin ? `font-size:${sizeVmin}vmin` : null }, card.emoji);
}

function cardCircle(card) {
  return el('div', { class: 'badge-circle pop', style: `background:${card.color.hex}` }, cardArt(card, 36));
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

  const emptyChoice = () => ({ emoji: null, label: null, color: null, role: 'normal' });
  // Out loud it's the "golden badge": "special sticker" means the NFC sticker in the lesson.
  const ROLES = [['normal', 'Normal'], ['trick', '🎭 Trick'], ['special', '⭐ Golden']];
  const ROLE_NOTE = { trick: ' · 🎭 trick badge', special: ' · ⭐ golden badge' };

  function header() {
    const n = Badge.cards.length;
    const tricks = Badge.cards.filter((c) => c.role === 'trick').length;
    const specials = Badge.cards.filter((c) => c.role === 'special').length;
    return el('div', { class: 'setup-header' },
      el('div', {}, '🛠️ Setup'),
      el('div', { class: 'count-pill' },
        `${n} badge${n === 1 ? '' : 's'} registered${tricks ? ` · ${tricks} 🎭` : ''}${specials ? ` · ${specials} ⭐` : ''}`));
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
        el('div', { class: 'subtitle' }, view.note, ROLE_NOTE[view.card.role] || ''),
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
            class: `mini-card role-${c.role || 'normal'} ${c.away ? 'away' : ''}`,
            style: `background:${c.color.hex}`,
            title: c.label,
            onclick: () => startEdit(c),
          }, cardArt(c, null)))),
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
        el('div', { class: 'roles' }, ROLES.map(([role, label]) => el('button', {
          class: `role ${choice.role === role ? 'selected' : ''}`,
          'data-role': role,
          onclick: () => {
            choice.role = role;
            render();
          },
        }, label))),
        el('button', { class: 'btn', onclick: () => set({ kind: 'idle' }) }, 'Cancel'),
        editing ? el('button', { class: 'btn danger', onclick: remove }, '🗑️ Delete') : null),
    ];
  }

  function startEdit(card) {
    choice = { emoji: card.emoji, label: card.label, color: card.color, role: card.role || 'normal' };
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
    timers = digits.map((d, i) => Badge.later(() => {
      d.classList.remove('hidden');
      d.classList.add('pop');
      Sound.tick(i);
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
  }, cardArt(card, null));
}

function shuffle(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Check-ins shared by the 3D Zoo and the backup 2D Zoo Gate; survives a page reload. */
const ZooStore = (() => {
  const KEY = 'zoo-gate-v1';
  const fresh = () => ({ checkedIn: [], tally: 0, tricks: {}, open: false });
  return {
    load() {
      try {
        const s = JSON.parse(localStorage.getItem(KEY));
        if (s && Array.isArray(s.checkedIn)) {
          return {
            checkedIn: s.checkedIn,
            tally: Number.isInteger(s.tally) ? s.tally : s.checkedIn.length,
            tricks: s.tricks && typeof s.tricks === 'object' ? s.tricks : {},
            open: !!s.open,
          };
        }
      } catch {
        /* private window or corrupt value: start fresh */
      }
      return fresh();
    },
    save(state) {
      try {
        localStorage.setItem(KEY, JSON.stringify(state));
      } catch {
        /* not fatal: check-ins just won't survive a reload */
      }
    },
    reset() {
      const state = fresh();
      this.save(state);
      return state;
    },
  };
})();

/** What a tap means in a zoo scene: 'unknown' | 'inside' | 'vote' | 'special-denied' | 'enter'. */
function zooDecide(state, card) {
  if (!card) return 'unknown';
  if (state.checkedIn.includes(card.canonical_id) && !card.away) return 'inside';
  // A trick badge that was kept out gets a new vote: kept out isn't final.
  if (card.role === 'trick' && state.tricks[card.canonical_id] !== 'in') return 'vote';
  if (card.role === 'special' && !card.allowed) return 'special-denied';
  return 'enter';
}

/** Let a card into the zoo: on the list, plus one tally mark. */
function zooAdmit(state, card) {
  if (!state.checkedIn.includes(card.canonical_id)) state.checkedIn.push(card.canonical_id);
  state.tally += 1;
  ZooStore.save(state);
}

function svgEl(tag, attrs = {}) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

/** Tally marks in groups of five (four strokes and a slash). `fresh` pops the newest mark. */
function tallyMarks(n, fresh = false) {
  const groups = [];
  for (let g = 0; g * 5 < n; g++) {
    const svg = svgEl('svg', { viewBox: '0 0 64 52', class: 'tally-group', 'aria-hidden': 'true' });
    for (let k = 0; k < Math.min(5, n - g * 5); k++) {
      const line = k < 4
        ? svgEl('line', { x1: 10 + k * 14, y1: 6, x2: 10 + k * 14, y2: 46 })
        : svgEl('line', { x1: 2, y1: 40, x2: 62, y2: 12 });
      if (fresh && g * 5 + k === n - 1) line.classList.add('tally-new');
      svg.append(line);
    }
    groups.push(svg);
  }
  return el('div', { class: 'zoo-tally', 'data-count': n, title: `${n} in the zoo` },
    el('span', { class: 'tally-house' }, '🏠'), groups);
}

/** Gentle "try again" for a badge the zoo doesn't know. Nobody goes in. */
function zooRetry(root) {
  root.querySelector('.zoo-oops')?.remove();
  const pill = el('div', { class: 'zoo-oops pop' }, 'Oops! Tap again 🔄');
  root.append(pill);
  Sound.boop();
  setTimeout(() => pill.remove(), 1500);
}

/** Trick badge vote: its stored look, a bouncing "?", and the two choices (the presenter decides). */
function zooVoteOverlay(card) {
  return el('div', { class: 'zoo-vote' },
    el('div', { class: 'vote-card' }, cardCircle(card), el('div', { class: 'vote-question' }, '?')),
    el('div', { class: 'vote-choices' },
      el('div', { class: 'vote-yes' }, '👍 Let in'),
      el('div', { class: 'vote-no' }, '👎 Keep out')));
}

/** Kept out: the gatekeeper goose waves the sticker bye-bye. */
function zooGoose(root, card) {
  root.querySelector('.zoo-goose')?.remove();
  const overlay = el('div', { class: 'zoo-goose' },
    el('div', { class: 'goose-row' },
      el('div', { class: 'bye-sticker' }, cardArt(card, 24)),
      el('div', { class: 'goose' }, '🪿', el('span', { class: 'goose-wave' }, '👋'))),
    el('div', { class: 'goose-text' }, 'Bye-bye!'));
  root.append(overlay);
  Sound.honk();
  setTimeout(() => overlay.remove(), 2600);
}

/** Special badge before it's allowed: it peeks at the gate, the goose says no, the padlock wobbles. */
function zooSpecialDenied(root, card) {
  root.querySelector('.zoo-special-denied')?.remove();
  const overlay = el('div', { class: 'zoo-special-denied' },
    el('div', { class: 'denied-row' },
      el('div', { class: 'peek' }, cardArt(card, 26)),
      el('div', { class: 'big-lock' }, '🔒'),
      el('div', { class: 'goose no-no' }, '🪿')));
  root.append(overlay);
  Sound.honk();
  setTimeout(() => Sound.silly(), 550);
  setTimeout(() => overlay.remove(), 3200);
}

function scribbleMark() {
  const svg = svgEl('svg', { viewBox: '0 0 100 100', class: 'scribble', 'aria-hidden': 'true' });
  svg.append(svgEl('path', { d: 'M12 58 C 18 12, 84 8, 90 48 S 34 96, 14 62 S 40 20, 70 30', class: 'scribble-path' }));
  return [svg, el('span', { class: 'pencil' }, '✏️')];
}

/** The Zoo List: everyone inside, plus allowed special badges (scribbled in when `scribble`). */
/** Where a badge stands on the Zoo List: 'in' ✅, 'waiting' (empty box: on the list, not in yet),
 * 'unlisted' ❌ (special not allowed yet, or a trick voted out), 'away' 💤 (not here today). */
function zooListStatus(state, card) {
  if (card.away && !state.checkedIn.includes(card.canonical_id)) return 'away';
  if (state.checkedIn.includes(card.canonical_id)) return 'in';
  if (card.role === 'special' && !card.allowed) return 'unlisted';
  if (card.role === 'trick' && state.tricks[card.canonical_id] === 'out') return 'unlisted';
  return 'waiting';
}

const ZOO_LIST_MARK = { in: '✅', waiting: '', unlisted: '❌', away: '💤' }; // waiting: an empty box
const ZOO_LIST_ORDER = ['in', 'waiting', 'unlisted', 'away'];

function zooListOverlay(state, scribble) {
  const rows = Badge.cards
    .map((c) => ({ c, status: zooListStatus(state, c) }))
    .sort((a, b) => ZOO_LIST_ORDER.indexOf(a.status) - ZOO_LIST_ORDER.indexOf(b.status));
  // The special badge just allowed gets scribbled onto the list.
  const isNew = (c) => scribble && c.role === 'special' && c.allowed && !state.checkedIn.includes(c.canonical_id);
  return el('div', { class: 'zoo-list' },
    el('div', { class: 'zoo-list-paper' },
      el('div', { class: 'zoo-list-title' }, '📋 Zoo List'),
      el('div', { class: 'zoo-list-grid' },
        rows.map(({ c, status }) => el('div', {
          class: `zoo-list-item status-${status} ${isNew(c) ? 'zoo-list-new' : ''}`,
          'data-id': c.canonical_id,
          'data-status': status,
        }, cardArt(c, null), el('span', { class: `zoo-list-mark ${status === 'waiting' ? 'empty-box' : ''}` }, ZOO_LIST_MARK[status]),
        isNew(c) ? scribbleMark() : null)),
        rows.length ? null : el('div', { class: 'zoo-list-empty' }, '🐾'))));
}

/**
 * Tap rules shared by both zoo scenes. Hooks: root(), state(), enter(card), inside(card),
 * tallyChanged(), party(), reset(), and optionally keptOut(card) / denied(card) (default: the
 * flat goose and padlock overlays), voting(card, show) / listing(show) / unknown(retry) to play
 * something before calling show() for the vote card, the Zoo List or the retry pill, and voted()
 * when the vote is decided.
 */
function createZooFlow(h) {
  const keptOut = h.keptOut || ((card) => zooGoose(h.root(), card));
  const denied = h.denied || ((card) => zooSpecialDenied(h.root(), card));
  const VOTE_MIN_MS = 1000; // a vote must be on screen this long before a decision counts
  let pending = null; // trick card waiting for the class vote
  let pendingSince = 0;
  let deferred = []; // taps that arrived during the vote
  let early = null; // { letIn, cardId }: the phone decided before the vote card was up

  function applyEarly() {
    if (early && pending?.canonical_id === early.cardId) decide(early.letIn, early.cardId);
  }

  function showList(scribble) {
    const show = () => {
      const root = h.root();
      root.querySelector('.zoo-list')?.remove();
      root.append(zooListOverlay(h.state(), scribble));
      if (scribble) {
        Sound.scribble();
        setTimeout(() => Sound.chime(), 1500);
      }
    };
    if (h.listing) h.listing(show);
    else show();
  }

  function tap(ev) {
    h.root().querySelector('.zoo-list')?.remove();
    if (pending) {
      if (ev.card) deferred.push(ev);
      else zooRetry(h.root());
      return;
    }
    const state = h.state();
    const card = ev.card;
    switch (zooDecide(state, card)) {
      case 'unknown': {
        const retry = () => zooRetry(h.root());
        return h.unknown ? h.unknown(retry) : retry();
      }
      case 'inside': return h.inside(card);
      case 'special-denied': return denied(card);
      case 'vote': {
        pending = card;
        pendingSince = Infinity; // can't be decided until the class sees the vote card
        const show = () => {
          if (pending !== card || h.root().querySelector('.zoo-vote')) return;
          pendingSince = performance.now();
          h.root().append(zooVoteOverlay(card));
          Sound.wonder();
          if (early?.cardId === card.canonical_id) setTimeout(applyEarly, VOTE_MIN_MS);
        };
        if (h.voting) h.voting(card, show);
        else show();
        return;
      }
      default:
        zooAdmit(state, card);
        h.tallyChanged();
        h.enter(card);
    }
  }

  /** `cardId`: the badge the decision is for (the phone's Check in buttons name it). */
  function decide(letIn, cardId) {
    if (!pending) {
      Badge.banner('Nothing is waiting');
      return;
    }
    if (cardId && cardId !== pending.canonical_id) {
      PageLog.log(`ignored ${letIn ? 'let-in' : 'keep-out'} for ${cardId}: ${pending.canonical_id} is waiting`);
      return;
    }
    const tooSoon = pendingSince + VOTE_MIN_MS - performance.now(); // Infinity until the card shows
    if (tooSoon > 0) {
      // A double press would otherwise decide the next trick badge before the class sees it.
      // A decision named for this badge just waits until its card has been up a moment.
      if (cardId) early = { letIn, cardId };
      if (cardId && tooSoon !== Infinity) setTimeout(applyEarly, tooSoon);
      return;
    }
    early = null;
    const card = pending;
    pending = null;
    h.root().querySelector('.zoo-vote')?.remove();
    h.voted?.();
    const state = h.state();
    state.tricks[card.canonical_id] = letIn ? 'in' : 'out';
    if (letIn) {
      zooAdmit(state, card);
      h.tallyChanged();
      h.enter(card);
    } else {
      ZooStore.save(state);
      keptOut(card);
    }
    const waiting = deferred;
    deferred = [];
    waiting.forEach(tap);
  }

  return {
    tap,
    /** Scene is closing: kids who tapped during a vote still get in (no animation). */
    clear() {
      const state = h.state();
      for (const ev of deferred) {
        if (state && zooDecide(state, ev.card) === 'enter') zooAdmit(state, ev.card);
      }
      pending = null;
      deferred = [];
    },
    /** The scene redrew itself: put the vote card back if a vote is still open. */
    restore() {
      const shown = pendingSince !== Infinity;
      if (pending && shown && !h.root().querySelector('.zoo-vote')) h.root().append(zooVoteOverlay(pending));
    },
    command(action, card) {
      if (action === 'let-in') decide(true, card);
      else if (action === 'keep-out') decide(false, card);
      else if (action === 'party') h.party();
      else if (action === 'allow-special') showList(true);
      else if (action === 'toggle-list') {
        if (h.root().querySelector('.zoo-list')) h.root().querySelector('.zoo-list').remove();
        else showList(false);
      }
      else if (action === 'reset') {
        pending = null;
        deferred = [];
        early = null;
        h.reset();
      }
    },
    get pendingVote() {
      return pending ? pending.canonical_id : null;
    },
  };
}

/** One path for every presenter command: keys and phone buttons both go through the server. */
const Commands = (() => {
  const SCENES = {
    'scene-setup': 'setup', 'scene-secret': 'secret', 'scene-zoo': 'zoo', 'scene-list': 'list',
    'scene-who': 'who', 'scene-gate': 'gate', 'scene-debug': 'debug',
  };
  const PAGE_ONLY = new Set([...Object.keys(SCENES), 'toggle-list', 'party', 'let-in', 'keep-out']);

  /** `card`: the badge a let-in / keep-out is for, when the phone named one. */
  function run(action, card) {
    if (SCENES[action]) {
      Badge.show(SCENES[action]);
      return;
    }
    if (action === 'reset') ZooStore.reset();
    Badge.current?.onCommand?.(action, card);
  }

  async function send(action) {
    try {
      const res = await fetch('/api/command', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) throw new Error(await res.text());
    } catch {
      if (PAGE_ONLY.has(action)) run(action);
      else Badge.banner('🔌 Server not reachable', { error: true });
    }
  }

  return { run, send };
})();

Badge.registerScene((() => {
  const WALK_MS = 2600;
  const PARADE_STAGGER_MS = 350;
  const PARADE_CROSS_MS = 4500;

  let root;
  let state = ZooStore.load();
  let els = {};
  let slots = [];
  let walking = 0;
  let generation = 0;
  let hintTimer;

  const cardById = (id) => Badge.cards.find((c) => c.canonical_id === id);
  // Stored ids may include cards not loaded yet (or deleted); only display the ones we know.
  const insideCards = () => state.checkedIn.map(cardById).filter((c) => c && !c.away);
  const present = () => Badge.cards.filter((c) => !c.away);
  const save = () => ZooStore.save(state);
  const colors = () => Badge.cards.map((c) => c.color.hex);

  function updateTally(fresh = false) {
    els.top.replaceChildren(tallyMarks(state.tally, fresh));
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
    }, cardArt(card, null));
  }

  function renderGate() {
    generation++;
    walking = 0;
    root.className = 'scene scene-zoo scene-gate';
    const inside = insideCards();
    slots = present().map((_, i) => (inside[i] ? filledSlot(inside[i]) : el('div', { class: 'zoo-slot empty' })));
    els = {
      top: el('div', { class: 'zoo-top' }),
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
      els.top,
      el('div', { class: 'zoo-stage' }, el('div', { class: 'zoo-outside' }, els.arrive, els.hint), els.gate, els.inside));
    updateTally();
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
    }, el('div', { class: 'bob ring', style: `background:${card.color.hex}` }, cardArt(card, null)));
    root.append(walker);
    hint(`Welcome, ${card.label} keeper!`);
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

  function openGate() {
    if (state.open) return;
    state.open = true;
    save();
    els.gate?.classList.remove('ajar');
    els.gate?.classList.add('open');
    Sound.fanfare();
    Confetti.rain(colors());
    Badge.later(parade, 1600);
  }

  function parade() {
    root.classList.add('finale');
    const lane = el('div', { class: 'parade' });
    root.append(lane);
    const vmin = Math.min(innerWidth, innerHeight) / 100;
    const cards = present();
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
    root.className = 'scene scene-zoo scene-gate finale';
    root.replaceChildren(el('div', { class: 'zoo-finale' },
      el('div', { class: 'huge-emoji-sm pop' }, '🏆'),
      el('div', { class: 'title finale-title pop' }, 'Congratulations, Official Zookeepers!'),
      el('div', { class: 'finale-animals' }, present().map((c) => ring(c, 10)))));
    if (celebrate) {
      Sound.fanfare();
      Confetti.rain(colors(), { count: 450 });
    }
  }

  function render() {
    if (state.open) showFinale(false);
    else renderGate();
  }


  function bounce(node) {
    if (!node) return;
    node.classList.remove('pop');
    void node.offsetWidth;
    node.classList.add('pop');
  }

  const flow = createZooFlow({
    root: () => root,
    state: () => state,
    enter(card) {
      walkIn(card, insideCards().length - 1);
      if (card.role === 'special') Badge.later(openGate, WALK_MS + 600);
    },
    inside(card) {
      Sound.tick(4);
      bounce(slots.find((s) => s.dataset.id === card.canonical_id));
      hint(`${card.emoji} is already inside!`);
      hintTimer = Badge.later(idleHint, 2000);
    },
    tallyChanged: () => updateTally(true),
    party: () => openGate(),
    reset: () => Badge.show('gate'),
  });

  return {
    id: 'gate',
    name: '🏰 Zoo Gate (2D backup)',
    key: '6',
    kid: true,
    onEnter(r) {
      root = r;
      flow.clear();
      state = ZooStore.load();
      render();
      addEventListener('resize', layoutSlots);
    },
    onExit() {
      removeEventListener('resize', layoutSlots);
      generation++;
      flow.clear();
    },
    onCards() {
      if (!state.open && !root.classList.contains('finale')) {
        render();
        flow.restore();
      }
    },
    onSkip: () => Commands.send('party'),
    skipLabel: '🎉 Start the party',
    onCommand: (action, card) => flow.command(action, card),
    state: () => ({
      inside: insideCards().map((c) => c.canonical_id),
      tally: state.tally,
      finale: state.open,
      pendingVote: flow.pendingVote,
      specialDenied: !!root.querySelector('.zoo-special-denied'),
      listOpen: !!root.querySelector('.zoo-list'),
    }),
    onTap(ev) {
      if (state.open && ev.card) {
        Sound.chime();
        Confetti.burst([ev.card.color.hex]);
        bounce(root.querySelector(`.finale-animals [data-id="${ev.card.canonical_id}"]`));
        return;
      }
      flow.tap(ev);
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
    else if (lookup.card) result = [cardArt(lookup.card, null), ` ${lookup.card.label}!`];
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
          class: `list-row ${c.canonical_id === hitId ? 'hit' : ''} ${c.away ? 'away' : ''}`,
          'data-id': c.canonical_id,
        },
        el('span', { class: 'list-num mono' }, c.canonical_id),
        cardArt(c, null),
        c.away ? el('span', { class: 'away-mark' }, '💤') : null,
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
      if (!ev.card) return zooRetry(root);
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
        } else {
          Sound.buzzer();
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
    const cards = Badge.cards.filter((c) => !c.away);
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

  function next() {
    Badge.cancel(timer);
    pickNext();
    ask();
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
      const fresh = target && Badge.cards.find((c) => c.canonical_id === target.canonical_id && !c.away);
      if (fresh) {
        target = fresh;
        ask();
      } else next();
    },
    onTap(ev) {
      if (celebrating || !target) return;
      if (!ev.card) return zooRetry(root);
      Badge.cancel(timer);
      if (ev.card?.canonical_id === target.canonical_id) {
        celebrating = true;
        root.className = 'scene scene-who';
        root.replaceChildren(
          el('div', { class: 'title pop' }, 'Yes! 🎉'),
          cardCircle(target),
          el('div', { class: 'big-label' }, `It's the ${target.label}!`));
        Sound.chime();
        Confetti.burst([target.color.hex], { y: 0.45, count: 260 });
        timer = Badge.later(next, NEXT_AFTER_CORRECT_MS);
        return;
      }
      Sound.silly();
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
// Scene: Zoo (3D playground)
// ===================================================================

/** A texture of the card's sticker photo, or of its emoji when there is no photo. */
const cardTexture = (() => {
  const cache = new Map();
  function emojiCanvas(emoji) {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d');
    g.font = '200px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(emoji, 128, 140);
    return c;
  }
  return function cardTexture(card) {
    const key = card.image || `emoji:${card.emoji}`;
    if (cache.has(key)) return cache.get(key);
    let tex;
    if (card.image) {
      tex = new THREE.TextureLoader().load(card.image);
      tex.aspect = 1;
      tex.ready = new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
          tex.aspect = img.naturalWidth / img.naturalHeight || 1;
          resolve();
        };
        img.onerror = resolve;
        img.src = card.image;
      });
    } else {
      tex = new THREE.CanvasTexture(emojiCanvas(card.emoji));
      tex.aspect = 1;
      tex.ready = Promise.resolve();
    }
    cache.set(key, tex);
    return tex;
  };
})();

Badge.registerScene((() => {
  const ANIMAL_H = 3.2;
  const GATE_Z = 22;
  const OUTSIDE_Z = 27;
  const PLAY_EDGE_Z = 9;
  const REASSIGN_MS = 12000;
  const PARTY_DELAY_MS = 1500;
  const OVERVIEW = { pos: [0, 19, 29], look: [0, 0, 1.5] };
  const PARTY_VIEW = { pos: [0, 11, 21], look: [0, 1.5, 0] };
  const AT_GATE = { pos: [0, 5, 35], look: [0, 2.2, 20] };
  const GOOSE_IDLE_TURN = 0.45; // facing the path, a little toward the visitors
  const LOCK_SIZE = 1.4;
  const VISIT_MS = 2800; // an animal already inside runs to the gate and waves this long
  const TITLE_AFTER_MS = 1500; // the party title waits for the balloons
  const CALM_AFTER_MS = 15000; // no taps for this long: everyone sits still while the presenter talks
  const BALLOONS = 16;
  const PARTY_COLORS = ['#ff5d8f', '#ffd43b', '#4dabf7', '#69db7c', '#b197fc', '#ff922b'];

  let root;
  let state;
  let w = null; // three.js world while the scene is open
  let animals = new Map(); // canonical_id -> { card, sprite, shadow, arrived, station, slot, phase, bounceAt }
  let queue = []; // jobs at the gate: { card, act: 'arrive' | 'bye' | 'no' }
  let busy = false;
  let finale = false;
  let gatekeeper = 'idle'; // the goose: 'idle', 'curious' (trick vote), 'bye' (kept out), 'no' (special denied)
  let voteDecided = null; // resolves the trick vote waiting at the gate
  let raising = false; // the goose is lifting its clipboard
  let lastActivity = performance.now(); // last tap or command; long enough ago means calm
  let calm = false;
  let visitor = null; // canonical_id of a sticker turned away at the gate
  let generation = 0;
  let hud;

  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const cardById = (id) => Badge.cards.find((c) => c.canonical_id === id);

  // ---------- tiny tween system driven by the render loop ----------
  const tasks = new Set();
  const tween = (ms, fn) => new Promise((done) => tasks.add({ t0: performance.now(), ms, fn, done }));
  const wait = (ms) => tween(ms, () => {});

  // ---------- world ----------
  const lam = (c) => new THREE.MeshLambertMaterial({ color: c });
  const box = (wd, h, d, c) => new THREE.Mesh(new THREE.BoxGeometry(wd, h, d), lam(c));
  const flat = (geo, c, y) => {
    const m = new THREE.Mesh(geo, lam(c));
    m.rotation.x = -Math.PI / 2;
    m.position.y = y;
    return m;
  };

  function textTexture(text, { size = 84, bg = '#fffaf0', fg = '#1d2251', border = '#8a5a3b', wd = 512, h = 128 } = {}) {
    const c = document.createElement('canvas');
    c.width = wd;
    c.height = h;
    const g = c.getContext('2d');
    g.fillStyle = bg;
    g.strokeStyle = border;
    g.lineWidth = 12;
    g.beginPath();
    if (g.roundRect) g.roundRect(6, 6, wd - 12, h - 12, 28);
    else g.rect(6, 6, wd - 12, h - 12);
    g.fill();
    g.stroke();
    g.fillStyle = fg;
    g.font = `bold ${size}px "Chalkboard SE", ui-rounded, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, wd / 2, h / 2 + 4);
    return new THREE.CanvasTexture(c);
  }

  const shadowTexture = (() => {
    let tex;
    return () => {
      if (tex) return tex;
      const c = document.createElement('canvas');
      c.width = c.height = 64;
      const g = c.getContext('2d');
      const r = g.createRadialGradient(32, 32, 2, 32, 32, 30);
      r.addColorStop(0, 'rgba(0,0,0,0.35)');
      r.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = r;
      g.fillRect(0, 0, 64, 64);
      tex = new THREE.CanvasTexture(c);
      return tex;
    };
  })();

  function blob(size) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size),
      new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false }));
    m.rotation.x = -Math.PI / 2;
    m.position.y = 0.03;
    return m;
  }

  function spriteOf(tex, h = ANIMAL_H) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    retexture(s, tex, h);
    return s;
  }

  /** Shows `tex` on a sprite, sized to its shape once it has loaded. */
  function retexture(s, tex, h = ANIMAL_H) {
    s.material.map = tex;
    s.material.needsUpdate = true;
    const fit = () => {
      if (s.material.map === tex) s.scale.set(h * (tex.aspect || 1), h, 1);
    };
    fit();
    tex.ready?.then(fit);
  }

  const emojiSprite = (emoji, h) => spriteOf(cardTexture({ emoji }), h);

  function buildGate(scene) {
    const gate = new THREE.Group();
    gate.position.z = GATE_Z;
    const postL = box(0.9, 5.5, 0.9, '#8a5a3b');
    postL.position.set(-2.4, 2.75, 0);
    const postR = postL.clone();
    postR.position.x = 2.4;
    const wood = lam('#8a5a3b');
    const sign = new THREE.Mesh(new THREE.BoxGeometry(6.6, 1.6, 0.5), [wood, wood, wood, wood,
      new THREE.MeshBasicMaterial({ map: textTexture('🦒 ZOO 🐘', { bg: '#8a5a3b', fg: '#fff3c4', border: '#5d3a22' }) }), wood]);
    sign.position.y = 5.8;
    gate.add(postL, postR, sign);
    const doors = [-1, 1].map((side) => {
      const pivot = new THREE.Group();
      pivot.position.set(side * 1.95, 0, 0);
      for (let i = 0; i < 6; i++) {
        const bar = box(0.12, 3.6, 0.12, '#b8b8b8');
        bar.position.set(-side * (0.2 + i * 0.33), 1.9, 0);
        pivot.add(bar);
      }
      for (const y of [0.4, 3.5]) {
        const rail = box(1.95, 0.2, 0.14, '#9a9a9a');
        rail.position.set(-side * 0.98, y, 0);
        pivot.add(rail);
      }
      gate.add(pivot);
      return pivot;
    });
    scene.add(gate);
    for (const side of [-1, 1]) {
      for (let i = 0; i < 12; i++) {
        const p = box(0.25, 1.4, 0.25, '#8a5a3b');
        p.position.set(side * (3.5 + i * 1.6), 0.7, GATE_Z);
        scene.add(p);
      }
      const rail = box(18, 0.18, 0.12, '#8a5a3b');
      rail.position.set(side * 12.3, 1.1, GATE_Z);
      scene.add(rail);
    }
    return doors;
  }

  /** The gatekeeper goose: stands beside the gate, waves a wing, shakes its head. */
  function buildGoose(scene) {
    // A touch of glow keeps the goose white instead of picking up the grass's green.
    const white = new THREE.MeshLambertMaterial({ color: '#f4f2ea', emissive: '#45453f' });
    const orange = lam('#ff9f1c');
    const ink = lam('#1d2251');
    const pink = lam('#ffb3c7');
    const sphere = (r, m) => new THREE.Mesh(new THREE.SphereGeometry(r, 20, 16), m);
    const goose = new THREE.Group();

    const body = sphere(1, white);
    body.scale.set(0.95, 0.8, 1.25);
    body.position.set(0, 1.55, -0.2);
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.45, 0.9, 12), white);
    tail.rotation.x = -Math.PI / 2 + 0.5;
    tail.position.set(0, 1.9, -1.5);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.36, 1.7, 16), white);
    neck.rotation.x = 0.25;
    neck.position.set(0, 2.75, 0.75);

    const head = new THREE.Group();
    head.position.set(0, 3.6, 0.95);
    const beak = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.6, 12), orange);
    beak.rotation.x = Math.PI / 2;
    beak.position.set(0, -0.08, 0.6);
    head.add(sphere(0.48, white), beak);
    for (const side of [-1, 1]) {
      const eye = sphere(0.09, ink);
      eye.position.set(side * 0.27, 0.1, 0.33);
      const cheek = sphere(0.1, pink);
      cheek.scale.set(1, 0.6, 0.4);
      cheek.position.set(side * 0.34, -0.1, 0.27);
      head.add(eye, cheek);
    }

    const wings = {};
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(side * 0.85, 1.9, -0.1);
      const wing = sphere(1, white);
      wing.scale.set(0.18, 0.55, 0.95);
      wing.position.set(side * 0.08, -0.35, -0.25);
      pivot.add(wing);
      wings[side] = pivot;
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.8, 8), orange);
      leg.position.set(side * 0.35, 0.4, 0.05);
      const foot = box(0.45, 0.08, 0.6, '#ff9f1c');
      foot.position.set(side * 0.35, 0.04, 0.25);
      goose.add(pivot, leg, foot);
    }
    const clipboard = new THREE.Group(); // held up for the Zoo List
    const board = box(1.1, 1.5, 0.08, '#a0522d');
    const paper = box(0.9, 1.2, 0.03, '#ffffff');
    paper.position.set(0, -0.05, 0.05);
    const clip = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.16, 0.12),
      new THREE.MeshPhongMaterial({ color: '#cfd4da', shininess: 120 }));
    clip.position.set(0, 0.72, 0.06);
    clipboard.add(board, paper, clip);
    for (let i = 0; i < 4; i++) {
      const line = box(0.65, 0.05, 0.02, i === 3 ? '#e64980' : '#5c6b8a');
      line.position.set(0, 0.35 - i * 0.25, 0.08);
      clipboard.add(line);
    }
    clipboard.position.set(0.9, 2.4, 1.0);
    clipboard.visible = false;
    clipboard.userData.model = 'clipboard';
    goose.add(body, tail, neck, head, clipboard);
    goose.position.set(-3.6, 0, GATE_Z + 2.8);
    goose.rotation.y = GOOSE_IDLE_TURN;
    goose.userData.model = 'goose';
    const shadow = blob(2.8);
    shadow.position.set(goose.position.x, 0.03, goose.position.z);
    scene.add(goose, shadow);
    return { goose, head, wings, clipboard, home: goose.position.clone() };
  }

  /** The blank card an unknown badge shows up as. */
  const mysteryTexture = (() => {
    let tex;
    return () => {
      if (tex) return tex;
      const c = document.createElement('canvas');
      c.width = c.height = 256;
      const g = c.getContext('2d');
      g.fillStyle = '#dfe5ec';
      g.strokeStyle = '#8a94a3';
      g.lineWidth = 12;
      g.beginPath();
      if (g.roundRect) g.roundRect(30, 14, 196, 228, 30);
      else g.rect(30, 14, 196, 228);
      g.fill();
      g.stroke();
      g.fillStyle = '#8a94a3';
      g.font = 'bold 170px "Chalkboard SE", ui-rounded, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('?', 128, 140);
      tex = new THREE.CanvasTexture(c);
      tex.aspect = 1;
      return tex;
    };
  })();

  /** Party balloons that float up around the playground, over and over. */
  function launchBalloons() {
    if (w.balloons.length) return;
    for (let i = 0; i < BALLOONS; i++) {
      const balloon = new THREE.Group();
      const skin = new THREE.Mesh(new THREE.SphereGeometry(0.6, 18, 14),
        new THREE.MeshPhongMaterial({ color: PARTY_COLORS[i % PARTY_COLORS.length], shininess: 80, specular: '#ffffff' }));
      skin.scale.y = 1.15;
      const string = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.6, 4), lam('#555555'));
      string.position.y = -1.5;
      balloon.add(skin, string);
      const ang = (i / BALLOONS) * Math.PI * 2;
      const r = 4 + (i % 4) * 2;
      balloon.userData = { x: Math.cos(ang) * r, z: Math.sin(ang) * r + 1, speed: 1 + (i % 5) * 0.25, phase: i * 0.7, y: -1 - (i % 6) * 2 };
      w.scene.add(balloon);
      w.balloons.push(balloon);
    }
  }

  /** A shiny padlock that pops onto the gate doors when the special badge isn't on the list yet. */
  function buildPadlock(scene) {
    const gold = new THREE.MeshPhongMaterial({ color: '#e9b824', shininess: 90, specular: '#fff6c0' });
    const steel = new THREE.MeshPhongMaterial({ color: '#cfd4da', shininess: 120, specular: '#ffffff' });
    const lock = new THREE.Group(); // pivots at the top of the shackle, so it swings like it's hanging
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.25, 0.55), gold);
    body.position.y = -1.15;
    const shackle = new THREE.Mesh(new THREE.TorusGeometry(0.48, 0.13, 12, 28, Math.PI), steel);
    shackle.position.y = -0.52;
    const hole = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.08, 16), lam('#3b2a14'));
    hole.rotation.x = Math.PI / 2;
    hole.position.set(0, -1.05, 0.29);
    const slot = box(0.09, 0.3, 0.08, '#3b2a14');
    slot.position.set(0, -1.28, 0.29);
    lock.add(body, shackle, hole, slot);
    lock.position.set(0, 3.2, GATE_Z + 0.4);
    lock.visible = false;
    lock.userData.model = 'padlock';
    scene.add(lock);
    return lock;
  }

  // Each station places an animal for a slot at time t (seconds).
  function buildPlayground(scene) {
    const stations = [];
    const add = (obj, x, y, z) => {
      obj.position.set(x, y, z);
      scene.add(obj);
      return obj;
    };

    // Slide: ladder at the back, slide down toward the front.
    const SL = { x: -7, z: -3 };
    add(box(0.2, 4, 0.2, '#e8590c'), SL.x - 0.8, 2, SL.z - 1.5);
    add(box(0.2, 4, 0.2, '#e8590c'), SL.x + 0.8, 2, SL.z - 1.5);
    add(box(2, 0.25, 1.6, '#e8590c'), SL.x, 4, SL.z - 1.2);
    const slide = add(box(1.6, 0.2, 6.2, '#ffd43b'), SL.x, 2.1, SL.z + 1.6);
    slide.rotation.x = 0.63;
    stations.push({
      name: 'slide', slots: 3, period: 5,
      pos(slot, t) {
        const p = (t / this.period + slot / this.slots) % 1;
        if (p < 0.4) return V(SL.x, (p / 0.4) * 4, SL.z - 1.6);
        if (p < 0.65) {
          const k = (p - 0.4) / 0.25;
          return V(SL.x, 4 - k * 4, SL.z - 1.2 + k * 5.6);
        }
        const k = (p - 0.65) / 0.35;
        return V(SL.x + 1.6 * Math.sin(k * Math.PI), 0, SL.z + 4.4 - k * 6);
      },
    });

    // Swings: a frame with three seats swinging toward the camera.
    const SW = { x: 7, z: -4 };
    for (const dx of [-3.2, 3.2]) {
      const leg = add(box(0.25, 5, 0.25, '#1c7ed6'), SW.x + dx, 2.5, SW.z);
      leg.rotation.z = dx > 0 ? -0.12 : 0.12;
    }
    add(box(6.8, 0.3, 0.3, '#1c7ed6'), SW.x, 5, SW.z);
    const seats = [-2, 0, 2].map((dx) => {
      const pivot = add(new THREE.Group(), SW.x + dx, 5, SW.z);
      const rope = box(0.06, 3.6, 0.06, '#495057');
      rope.position.y = -1.8;
      const seat = box(1, 0.15, 0.6, '#c92a2a');
      seat.position.y = -3.7;
      pivot.add(rope, seat);
      return pivot;
    });
    stations.push({
      name: 'swings', slots: 3, period: 2.6,
      pos(slot, t) {
        const a = Math.sin((t / this.period) * Math.PI * 2 + slot * 1.3) * 0.7;
        seats[slot].rotation.x = a;
        return V(SW.x + (slot - 1) * 2, 5 - Math.cos(a) * 3.7 + 0.05, SW.z + Math.sin(a) * 3.7);
      },
    });

    // Seesaw: a plank tipping on a pivot.
    const SS = { x: 7, z: 5 };
    add(box(0.8, 0.9, 0.8, '#5f3dc4'), SS.x, 0.45, SS.z);
    const plank = add(box(7, 0.25, 0.9, '#9775fa'), SS.x, 1, SS.z);
    stations.push({
      name: 'seesaw', slots: 2, period: 2.2,
      pos(slot, t) {
        const a = Math.sin((t / this.period) * Math.PI * 2) * 0.32;
        plank.rotation.z = a;
        const side = slot ? 1 : -1;
        return V(SS.x + side * 3 * Math.cos(a), 1.15 + side * 3 * Math.sin(a), SS.z);
      },
    });

    // Merry-go-round: a spinning disk with riders.
    const MG = { x: -7, z: 5 };
    const disk = add(new THREE.Mesh(new THREE.CylinderGeometry(2.8, 2.8, 0.35, 24),
      [lam('#37b24d'), lam('#ffd43b'), lam('#37b24d')]), MG.x, 0.4, MG.z);
    add(box(0.25, 2, 0.25, '#868e96'), MG.x, 1.2, MG.z);
    stations.push({
      name: 'merry', slots: 4, period: 6,
      pos(slot, t) {
        const a = (t / this.period) * Math.PI * 2 + (slot / this.slots) * Math.PI * 2;
        disk.rotation.y = (t / this.period) * Math.PI * 2;
        return V(MG.x + Math.cos(a) * 1.9, 0.6, MG.z + Math.sin(a) * 1.9);
      },
    });

    // Open grass: everyone else hops around the middle.
    stations.push({
      name: 'grass', slots: Infinity, period: 4,
      pos(slot, t) {
        const a = slot * 2.399 + t * 0.15;
        const r = 2.2 + (slot % 4) * 0.9;
        return V(Math.cos(a) * r, Math.abs(Math.sin(t * 3 + slot)) * 0.5, Math.sin(a) * r * 0.8 + 1);
      },
    });
    return stations;
  }

  function buildWorld(container) {
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch {
      return null;
    }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    container.append(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#8fd8ff');
    scene.fog = new THREE.Fog('#8fd8ff', 55, 110);
    const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 300);
    camera.position.set(...OVERVIEW.pos);
    scene.add(new THREE.HemisphereLight('#ffffff', '#5aa83c', 0.95));
    const sun = new THREE.DirectionalLight('#fff4d6', 0.55);
    sun.position.set(15, 30, 10);
    scene.add(sun);

    scene.add(flat(new THREE.PlaneGeometry(300, 300), '#6cc24a', 0));
    scene.add(flat(new THREE.CircleGeometry(12, 48), '#f2d49b', 0.01));
    const path = flat(new THREE.PlaneGeometry(3, OUTSIDE_Z + 4 - 10), '#f2d49b', 0.012);
    path.position.z = (OUTSIDE_Z + 4 + 10) / 2;
    scene.add(path);
    for (let i = 0; i < 44; i++) {
      const a = (i / 44) * Math.PI * 2;
      if (Math.abs(Math.sin(a / 2)) < 0.14) continue;
      const r = 20 + (i % 5) * 2.4;
      const trunk = box(0.5, 1.6, 0.5, '#7a4b2a');
      trunk.position.set(Math.sin(a) * r, 0.8, Math.cos(a) * r);
      const top = new THREE.Mesh(new THREE.ConeGeometry(1.6 + (i % 3) * 0.3, 3.4, 7), lam(i % 3 ? '#3f9a3a' : '#2f7d33'));
      top.position.set(trunk.position.x, 3.1, trunk.position.z);
      scene.add(trunk, top);
    }
    const doors = buildGate(scene);
    const goose = buildGoose(scene);
    const padlock = buildPadlock(scene);
    const stations = buildPlayground(scene);
    const look = V(...OVERVIEW.look);
    return {
      renderer, scene, camera, doors, goose, padlock, stations, look, balloons: [],
      cam: { pos: V(...OVERVIEW.pos), look: V(...OVERVIEW.look), follow: null },
      reassignAt: performance.now() + REASSIGN_MS,
      raf: 0,
    };
  }

  // ---------- animals ----------
  function addAnimal(card, arrived) {
    const sprite = spriteOf(cardTexture(card));
    sprite.userData.animal = card.canonical_id;
    const shadow = blob(2);
    w.scene.add(sprite, shadow);
    const a = { card, sprite, shadow, arrived, station: null, slot: 0, bounceAt: 0, visitAt: -Infinity, imageKey: card.image || '' };
    animals.set(card.canonical_id, a);
    return a;
  }

  function removeAnimal(id) {
    const a = animals.get(id);
    if (!a) return;
    w.scene.remove(a.sprite, a.shadow);
    animals.delete(id);
  }

  function assignStations() {
    const playing = [...animals.values()].filter((a) => a.arrived);
    const order = shuffle(playing);
    const free = w.stations.filter((s) => s.name !== 'grass').flatMap((s) => Array.from({ length: s.slots }, (_, i) => [s, i]));
    const spots = shuffle(free);
    const grass = w.stations.find((s) => s.name === 'grass');
    order.forEach((a, i) => {
      const [station, slot] = spots[i] || [grass, i];
      a.station = station;
      a.slot = slot;
    });
  }

  function syncAnimals() {
    // Kids still waiting at the gate get their sticker when their turn comes, not here.
    const waiting = new Set(queue.filter((j) => j.act === 'arrive').map((j) => j.card.canonical_id));
    const want = state.checkedIn.map(cardById).filter((c) => c && !c.away && !waiting.has(c.canonical_id));
    const ids = new Set(want.map((c) => c.canonical_id));
    for (const id of [...animals.keys()]) if (!ids.has(id) && !waiting.has(id)) removeAnimal(id);
    for (const card of want) {
      const a = animals.get(card.canonical_id);
      if (!a) addAnimal(card, true);
      else {
        // A new photo: same animal, new picture, so one that's mid-walk keeps walking.
        if ((card.image || '') !== a.imageKey) {
          retexture(a.sprite, cardTexture(card));
          a.imageKey = card.image || '';
        }
        a.card = card;
      }
    }
    assignStations();
  }

  function hearts(at) {
    for (let i = 0; i < 6; i++) {
      const h = emojiSprite('❤️', 0.9);
      h.position.copy(at).add(V((Math.random() - 0.5) * 2, 1.5, (Math.random() - 0.5) * 2));
      w.scene.add(h);
      const y0 = h.position.y;
      tween(1300 + i * 100, (t) => {
        h.position.y = y0 + t * 3;
        h.material.opacity = 1 - t;
      }).then(() => w?.scene.remove(h));
    }
  }

  function screenPoint(v) {
    const p = v.clone().project(w.camera);
    return { x: (p.x + 1) / 2, y: (1 - p.y) / 2 };
  }

  // ---------- arrivals ----------
  async function arrive(card) {
    const gen = generation;
    const fast = queue.length > 0;
    removeAnimal(card.canonical_id);
    const a = addAnimal(card, false);
    a.sprite.position.set(0, ANIMAL_H / 2, OUTSIDE_Z);
    w.cam.follow = null;
    setCam(AT_GATE);
    await wait(fast ? 250 : 900);
    if (gen !== generation) return;

    const bubble = new THREE.Sprite(new THREE.SpriteMaterial({ map: textTexture(`Welcome, ${card.label}!`, { size: 64 }), transparent: true }));
    bubble.scale.set(6, 1.5, 1);
    bubble.position.set(0, ANIMAL_H + 1.2, OUTSIDE_Z);
    w.scene.add(bubble);
    Sound.chime();
    Confetti.burst([card.color.hex], { ...screenPoint(V(0, 5.5, GATE_Z)), count: 200 });
    await tween(500, (t) => {
      const e = 1 - (1 - t) ** 3;
      w.doors[0].rotation.y = -e * 1.9;
      w.doors[1].rotation.y = e * 1.9;
    });
    if (gen !== generation) return;
    w.scene.remove(bubble);

    w.cam.follow = fast ? null : a;
    const from = a.sprite.position.clone();
    const to = V(0, 0, PLAY_EDGE_Z);
    const dist = from.distanceTo(to);
    await tween(fast ? 1300 : 2600, (t) => {
      a.sprite.position.lerpVectors(from, to, t);
      a.sprite.position.y = ANIMAL_H / 2 + Math.abs(Math.sin(t * dist * 0.9)) * 0.8;
    });
    if (gen !== generation) return;
    tween(600, (t) => {
      const e = 1 - (1 - t) ** 3;
      w.doors[0].rotation.y = -(1 - e) * 1.9;
      w.doors[1].rotation.y = (1 - e) * 1.9;
    });

    // Friends cheer.
    const now = performance.now();
    for (const f of animals.values()) if (f.arrived) f.bounceAt = now;
    hearts(V(0, 0, 4));
    Sound.tick(6);
    a.arrived = true;
    assignStations();
    if (!fast) {
      await wait(1500);
      if (gen !== generation) return;
    }
    w.cam.follow = null;
    if (!queue.length) setCam(OVERVIEW);
  }

  // ---------- at the gate ----------
  /** The goose turns to look at a spot (and back to keeping watch with `to` = null). */
  function gooseLooksAt(to, ms = 300) {
    const g = w.goose;
    const goal = to ? Math.atan2(to.x - g.goose.position.x, to.z - g.goose.position.z) : GOOSE_IDLE_TURN;
    const from = g.goose.rotation.y;
    return tween(ms, (t) => { g.goose.rotation.y = from + (goal - from) * t; });
  }

  /** Unknown badge: a blank card hops up to the gate, the goose tilts its head, then "Oops! Tap again". */
  async function puzzled(retry) {
    const gen = generation;
    const g = w.goose;
    w.cam.follow = null;
    setCam(AT_GATE);
    const card = spriteOf(mysteryTexture(), 2.6);
    const shadow = blob(1.8);
    w.scene.add(card, shadow);
    const home = V(0, 1.6, OUTSIDE_Z - 2.5); // far enough back that the Oops pill doesn't cover it
    visitor = '?';
    gatekeeper = 'puzzled';
    gooseLooksAt(home);
    await tween(700, (t) => {
      card.position.set(home.x, home.y + Math.abs(Math.sin(t * Math.PI * 2)) * 0.6, home.z + (1 - t) * 4);
      shadow.position.set(home.x, 0.03, card.position.z);
      g.head.rotation.z = t * 0.35;
    });
    if (gen !== generation) return;
    retry();
    await tween(1300, (t) => { g.head.rotation.z = 0.35 + Math.sin(t * Math.PI * 4) * 0.1; });
    if (gen !== generation) return;
    await tween(500, (t) => {
      card.position.z = home.z + t * 4;
      card.material.opacity = 1 - t;
    });
    if (gen !== generation) return;
    w.scene.remove(card, shadow);
    g.head.rotation.z = 0;
    visitor = null;
    gatekeeper = 'idle';
    if (!queue.length) setCam(OVERVIEW);
  }

  /** Zoo List: the goose holds up its clipboard at the gate, then the paper list shows. */
  async function holdUpList(show) {
    const gen = generation;
    const clipboard = w.goose.clipboard;
    w.cam.follow = null;
    setCam(AT_GATE);
    gooseLooksAt(V(0, 0, AT_GATE.pos[2]));
    clipboard.visible = true;
    raising = true;
    await tween(600, (t) => {
      const e = 1 - (1 - t) ** 3;
      clipboard.scale.setScalar(Math.max(0.01, e));
      clipboard.position.y = 1.6 + e * 0.8;
    });
    raising = false;
    if (gen !== generation) return;
    // A badge tapped meanwhile closes the list, so don't open it over that arrival.
    if (!queue.some((j) => j.act === 'arrive')) show();
  }

  /** Trick badge: it walks up to the gate, the goose looks it over, then the class votes. */
  async function waitForVote(card, show) {
    const gen = generation;
    const g = w.goose;
    w.cam.follow = null;
    setCam(AT_GATE);
    const sticker = spriteOf(cardTexture(card));
    const shadow = blob(2);
    w.scene.add(sticker, shadow);
    visitor = card.canonical_id;
    gatekeeper = 'curious';
    const decided = new Promise((resolve) => { voteDecided = resolve; });
    const home = V(0, ANIMAL_H / 2, OUTSIDE_Z);
    const faceVisitor = Math.atan2(home.x - g.goose.position.x, home.z - g.goose.position.z);
    const turnFrom = g.goose.rotation.y;
    await tween(1100, (t) => {
      sticker.position.set(home.x, ANIMAL_H / 2 + Math.abs(Math.sin(t * Math.PI * 3)) * 0.6, home.z + (1 - t) * 5);
      shadow.position.set(home.x, 0.03, sticker.position.z);
      g.goose.rotation.y = turnFrom + (faceVisitor - turnFrom) * Math.min(1, t * 2);
      g.head.rotation.z = Math.min(1, t * 2) * 0.35; // head tilt: hmm, who's this?
    });
    if (gen !== generation) return;
    show();
    await decided;
    voteDecided = null;
    if (gen !== generation) return;
    w.scene.remove(sticker, shadow);
    g.head.rotation.z = 0;
    visitor = null;
    gatekeeper = 'idle';
  }

  // ---------- turned away at the gate ----------
  /** 'bye': kept out by the class vote, the goose waves it off. 'no': the special badge isn't on the list yet. */
  async function turnAway(card, act) {
    const gen = generation;
    const g = w.goose;
    w.cam.follow = null;
    setCam(AT_GATE);
    const sticker = spriteOf(cardTexture(card));
    const home = act === 'no' ? V(2.3, ANIMAL_H / 2, OUTSIDE_Z - 2) : V(0, ANIMAL_H / 2, OUTSIDE_Z);
    sticker.position.copy(home);
    const shadow = blob(2);
    w.scene.add(sticker, shadow);
    const follow = () => shadow.position.set(sticker.position.x, 0.03, sticker.position.z);
    follow();
    visitor = card.canonical_id;
    gatekeeper = act;
    const faceVisitor = Math.atan2(home.x - g.goose.position.x, home.z - g.goose.position.z);
    const turnFrom = g.goose.rotation.y;
    await tween(300, (t) => { g.goose.rotation.y = turnFrom + (faceVisitor - turnFrom) * t; });
    if (gen !== generation) return;
    Sound.honk();

    if (act === 'no') {
      const lock = w.padlock;
      lock.visible = true;
      Badge.later(() => Sound.silly(), 550);
      await tween(2600, (t) => {
        const pop = Math.min(1, t * 8);
        lock.scale.setScalar(LOCK_SIZE * (pop < 1 ? pop * 1.25 : 1));
        lock.rotation.z = Math.sin(t * Math.PI * 14) * 0.28;
        g.head.rotation.y = Math.sin(t * Math.PI * 12) * 0.6;
        sticker.position.x = home.x + Math.sin(t * Math.PI * 3) * 0.4; // peeking
      });
      if (gen !== generation) return;
      await tween(300, (t) => lock.scale.setScalar(LOCK_SIZE * (1 - t)));
      if (gen !== generation) return;
      lock.visible = false;
    } else {
      const bubble = new THREE.Sprite(new THREE.SpriteMaterial({ map: textTexture('Bye-bye!', { size: 80 }), transparent: true }));
      bubble.scale.set(5, 1.25, 1);
      w.scene.add(bubble);
      await tween(2600, (t) => {
        g.wings[1].rotation.z = 0.9 + Math.sin(t * Math.PI * 12) * 0.6;
        const away = Math.max(0, (t - 0.35) / 0.65);
        sticker.position.z = home.z + away * 9;
        sticker.position.y = ANIMAL_H / 2 + Math.abs(Math.sin(away * Math.PI * 4)) * 0.7;
        sticker.material.opacity = 1 - Math.max(0, (away - 0.6) / 0.4);
        bubble.position.set(sticker.position.x, ANIMAL_H + 1.4, sticker.position.z);
        bubble.material.opacity = sticker.material.opacity;
        follow();
      });
      if (gen !== generation) return;
      w.scene.remove(bubble);
      g.wings[1].rotation.z = 0;
    }
    w.scene.remove(sticker, shadow);
    g.head.rotation.y = 0;
    visitor = null;
    gatekeeper = 'idle';
    if (!queue.length) setCam(OVERVIEW);
  }

  async function drain() {
    if (busy) return;
    busy = true;
    while (queue.length && w) {
      const job = queue.shift();
      const { card, act } = job;
      if (act === 'vote') {
        await waitForVote(card, job.show);
        continue;
      }
      if (act === 'oops') {
        await puzzled(job.show);
        continue;
      }
      if (act === 'list') {
        await holdUpList(job.show);
        continue;
      }
      if (act !== 'arrive') {
        await turnAway(card, act);
        continue;
      }
      await arrive(card);
      if (card.role === 'special' && w) Badge.later(startParty, PARTY_DELAY_MS);
    }
    busy = false;
  }

  function setCam(view) {
    w.cam.pos.set(...view.pos);
    w.cam.look.set(...view.look);
  }

  // ---------- party ----------
  /** Balloons go up and everyone dances (the goose too); the title follows. */
  function startParty() {
    if (finale || !w) return;
    finale = true;
    state.open = true;
    ZooStore.save(state);
    partyScene();
    Sound.fanfare();
    Confetti.rain(Badge.cards.map((c) => c.color.hex), { count: 450 });
    Badge.later(showTitle, TITLE_AFTER_MS);
  }

  function partyScene() {
    if (!w) return;
    gatekeeper = 'dancing';
    w.goose.clipboard.visible = false;
    setCam(PARTY_VIEW);
    launchBalloons();
  }

  function showTitle() {
    root.querySelector('.zoo3d-finale')?.remove();
    root.append(el('div', { class: 'zoo3d-finale' },
      el('div', { class: 'huge-emoji-sm pop' }, '🏆'),
      el('div', { class: 'title finale-title pop' }, 'Congratulations, Official Zookeepers!')));
  }

  // ---------- render loop ----------
  function frame(now) {
    if (!w) return;
    w.raf = requestAnimationFrame(frame);
    for (const t of tasks) {
      const p = Math.min(1, (now - t.t0) / t.ms);
      t.fn(p);
      if (p >= 1) {
        tasks.delete(t);
        t.done();
      }
    }
    calm = !finale && !busy && !queue.length && gatekeeper === 'idle' && now - lastActivity > CALM_AFTER_MS;
    if (now > w.reassignAt && !calm) {
      assignStations();
      w.reassignAt = now + REASSIGN_MS;
    }
    const secs = now / 1000;
    const all = [...animals.values()];
    all.forEach((a, i) => {
      if (a.arrived) {
        let target;
        const visiting = !finale && now - a.visitAt < VISIT_MS;
        a.sprite.material.rotation = visiting ? Math.sin(secs * 14) * 0.18 : 0; // waving hello
        if (visiting) {
          target = V(0, Math.abs(Math.sin(secs * 6)) * 1.8, GATE_Z - 1.6); // hops to see over the bars
        } else if (finale) {
          const ang = (i / all.length) * Math.PI * 2 + secs * 0.4;
          target = V(Math.cos(ang) * 6, Math.abs(Math.sin(secs * 4 + i)) * 1.2, Math.sin(ang) * 5 + 1);
        } else if (calm) {
          // Everyone strolls to a spot on the grass and sits still.
          const ang = (i / all.length) * Math.PI * 2;
          const r = 4.5 + (i % 2) * 2.5;
          target = V(Math.cos(ang) * r, 0, Math.sin(ang) * r + 1);
        } else target = (a.station || w.stations.at(-1)).pos(a.slot, secs);
        const goal = target.clone().setY(target.y + ANIMAL_H / 2);
        const ease = visiting ? 0.12 : calm ? 0.03 : a.station?.name === 'grass' || finale ? 0.08 : 0.25;
        a.sprite.position.lerp(goal, ease);
        const since = now - a.bounceAt;
        if (since < 900) a.sprite.position.y += Math.abs(Math.sin((since / 900) * Math.PI * 2)) * 1.4;
      }
      a.shadow.position.set(a.sprite.position.x, 0.03, a.sprite.position.z);
    });
    const g = w.goose;
    if (gatekeeper === 'idle') {
      g.goose.rotation.y += (GOOSE_IDLE_TURN - g.goose.rotation.y) * 0.05;
      // Little nods while it keeps watch; still when the zoo is calm.
      g.head.rotation.x = calm ? g.head.rotation.x * 0.9 : Math.sin(secs * 1.6) * 0.12;
    } else if (gatekeeper === 'dancing') {
      g.goose.position.lerp(V(0, Math.abs(Math.sin(secs * 5)) * 0.5, 1), 0.04); // into the middle of the ring
      g.goose.rotation.y += 0.05;
      g.wings[1].rotation.z = 0.6 + Math.sin(secs * 10) * 0.5;
      g.wings[-1].rotation.z = -0.6 - Math.sin(secs * 10) * 0.5;
      g.head.rotation.x = Math.sin(secs * 5) * 0.2;
    }
    if (g.clipboard.visible && !raising && !root.querySelector('.zoo-list') && !queue.some((j) => j.act === 'list')) {
      g.clipboard.visible = false;
    }
    for (const b of w.balloons) {
      const d = b.userData;
      d.y += d.speed * 0.016;
      if (d.y > 16) d.y = -1;
      b.position.set(d.x + Math.sin(secs + d.phase) * 0.4, d.y, d.z);
    }
    const followPos = w.cam.follow?.sprite.position;
    const camGoal = followPos ? followPos.clone().add(V(0, 4, 9)) : w.cam.pos;
    const lookGoal = followPos ? followPos.clone().add(V(0, 0.5, -6)) : w.cam.look;
    w.camera.position.lerp(camGoal, 0.05);
    w.look.lerp(lookGoal, 0.07);
    w.camera.lookAt(w.look);
    w.renderer.render(w.scene, w.camera);
  }

  function resize() {
    if (!w) return;
    const { clientWidth: wd, clientHeight: h } = root;
    w.renderer.setSize(wd, h, false);
    w.camera.aspect = wd / h;
    w.camera.updateProjectionMatrix();
  }

  function updateHud(fresh = false) {
    hud.replaceChildren(tallyMarks(state.tally, fresh));
  }

  function teardown() {
    generation++;
    tasks.clear();
    queue = [];
    busy = false;
    gatekeeper = 'idle';
    visitor = null;
    voteDecided = null;
    raising = false;
    animals = new Map();
    removeEventListener('resize', resize);
    if (w) {
      cancelAnimationFrame(w.raf);
      w.renderer.dispose();
      w = null;
    }
  }

  const flow = createZooFlow({
    root: () => root,
    state: () => state,
    enter(card) {
      if (!w) return;
      queue.push({ card, act: 'arrive' });
      drain();
    },
    voting(card, show) {
      if (!w) return show();
      queue.push({ card, act: 'vote', show });
      drain();
    },
    voted: () => voteDecided?.(),
    keptOut(card) {
      if (!w) return zooGoose(root, card);
      queue.push({ card, act: 'bye' });
      drain();
    },
    denied(card) {
      if (!w) return zooSpecialDenied(root, card);
      queue.push({ card, act: 'no' });
      drain();
    },
    inside(card) {
      const a = animals.get(card.canonical_id);
      Sound.tick(4);
      if (finale) {
        if (a) a.bounceAt = performance.now();
        Confetti.burst([card.color.hex]);
        return;
      }
      if (!a || !w) return;
      // Already inside: it runs to the gate and waves hello.
      a.visitAt = performance.now();
      if (!busy) {
        setCam(AT_GATE);
        Badge.later(() => {
          const now = performance.now();
          if (w && !busy && ![...animals.values()].some((x) => now - x.visitAt < VISIT_MS)) setCam(OVERVIEW);
        }, VISIT_MS);
      }
    },
    unknown(retry) {
      if (!w) return retry();
      queue.push({ act: 'oops', show: retry });
      drain();
    },
    listing(show) {
      if (!w) return show();
      queue.push({ act: 'list', show });
      drain();
    },
    tallyChanged: () => updateHud(true),
    party: () => startParty(),
    reset: () => Badge.show('zoo'),
  });

  return {
    id: 'zoo',
    name: '🎠 Zoo playground (3D)',
    key: '3',
    kid: true,
    skipLabel: '🎉 Start the party',
    onEnter(r) {
      root = r;
      flow.clear();
      root.className = 'scene scene-zoo3d';
      lastActivity = performance.now();
      state = ZooStore.load();
      finale = state.open;
      hud = el('div', { class: 'zoo-top zoo3d-hud' });
      root.append(hud);
      updateHud();
      w = buildWorld(root);
      if (!w) {
        root.append(el('div', { class: 'zoo3d-fallback' }, "3D isn't available here: press ⌥6 for the Zoo Gate"));
        return;
      }
      resize();
      addEventListener('resize', resize);
      syncAnimals();
      if (finale) {
        partyScene();
        showTitle();
      }
      w.raf = requestAnimationFrame(frame);
    },
    onExit() {
      flow.clear();
      teardown();
    },
    onCards() {
      updateHud();
      if (w) syncAnimals();
    },
    onSkip: () => Commands.send('party'),
    onCommand: (action, card) => {
      lastActivity = performance.now();
      flow.command(action, card);
    },
    onTap: (ev) => {
      lastActivity = performance.now();
      flow.tap(ev);
    },
    state: () => ({
      pendingVote: flow.pendingVote,
      specialDenied: gatekeeper === 'no' || queue.some((j) => j.act === 'no') || !!root.querySelector('.zoo-special-denied'),
      gatekeeper,
      visitor,
      calm,
      models: {
        goose: !!w?.goose, padlock: !!w?.padlock.visible, clipboard: !!w?.goose.clipboard.visible,
        balloons: w ? w.balloons.length : 0,
      },
      waving: [...animals.values()].filter((a) => performance.now() - a.visitAt < VISIT_MS).map((a) => a.card.canonical_id),
      listOpen: !!root.querySelector('.zoo-list'),
      inside: [...animals.values()].filter((a) => a.arrived).map((a) => a.card.canonical_id),
      queued: queue.length,
      finale,
      tally: state.tally,
      sprites: w ? w.scene.children.filter((o) => o.userData.animal).length : 0,
      heights: Object.fromEntries([...animals.values()].map((a) => [a.card.canonical_id, a.sprite.position.y])),
    }),
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
        ? el('td', {}, cardArt(ev.card, 4), ` ${ev.card.label}${{ trick: ' 🎭', special: ' ⭐' }[ev.card.role] || ''} ${flags}`)
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
