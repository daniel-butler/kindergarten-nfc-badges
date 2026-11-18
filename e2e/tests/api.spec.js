const { test, expect } = require('@playwright/test');
const { PENGUIN, LION, FOX_TRICK, STAR_SPECIAL, command, setCards, getCards, phoneTap, setLinkMode, uploadImage, PNG_1PX } = require('./helpers');

test.beforeEach(async ({ request }) => {
  await setLinkMode(request, false);
  await setCards(request, [PENGUIN, LION]);
});

const tap = (request, id, source = 'reader') => request.post('/tap', { data: { id, source } });

test('tap resolves exact, reversed, and all four 4-byte truncations', async ({ request }) => {
  for (const id of ['04A1B2C3D4E5F6', '04:a1:b2:c3:d4:e5:f6', 'F6E5D4C3B2A104', '04A1B2C3', 'C3D4E5F6', 'F6E5D4C3', 'C3B2A104']) {
    const ev = await (await tap(request, id)).json();
    expect(ev.card?.label, id).toBe('Penguin');
    expect(ev.raw_id).toBe(id);
    expect(ev.canonical_id).toMatch(/^[0-9A-F]+$/);
    expect(ev.source).toBe('reader');
    expect(typeof ev.ts).toBe('number');
  }
});

test('unknown id has null card; bad id is 400', async ({ request }) => {
  const ev = await (await tap(request, 'deadbeef', 'phone')).json();
  expect(ev).toMatchObject({ canonical_id: 'DEADBEEF', source: 'phone', card: null });
  expect((await tap(request, 'zebra')).status()).toBe(400);
  expect((await tap(request, '04A1B2C3D4E5F6', 'laptop')).status()).toBe(422);
});

test('registry normalizes ids and rejects the same badge on two cards', async ({ request }) => {
  const saved = await setCards(request, [{ ...PENGUIN, canonical_id: '04:a1:b2:c3:d4:e5:f6', aliases: ['deadbeef'] }]);
  expect(saved[0]).toMatchObject({ canonical_id: '04A1B2C3D4E5F6', aliases: ['DEADBEEF'] });

  const dup = await request.put('/api/cards', { data: [PENGUIN, { ...LION, canonical_id: 'F6E5D4C3B2A104' }] });
  expect(dup.status()).toBe(409);
  expect(await dup.text()).toContain('duplicate badge');
  expect(await getCards(request)).toHaveLength(1);
});

test('cards require a cardstock color and keep their role', async ({ request }) => {
  const { color, ...noColor } = PENGUIN;
  expect((await request.put('/api/cards', { data: [noColor] })).status()).toBe(422);
  expect((await request.put('/api/cards', { data: [{ ...PENGUIN, color: { hex: 'blue', name: 'Blue' } }] })).status()).toBe(409);

  const saved = await setCards(request, [{ ...PENGUIN, color: { hex: '#1e5bd8', name: 'Blue' } }, { ...LION, role: 'trick' }]);
  expect(saved[0]).toMatchObject({ color: { hex: '#1E5BD8', name: 'Blue' }, role: 'normal' });
  expect(saved[1].role).toBe('trick');
  const ev = await (await tap(request, LION.canonical_id)).json();
  expect(ev.card).toMatchObject({ role: 'trick', color: { name: 'Yellow' } });
});

test('link mode attaches an unrelated reader id to the card tapped on the phone', async ({ request }) => {
  await phoneTap(request, PENGUIN.canonical_id);
  expect((await (await tap(request, '99887766')).json()).card).toBeNull(); // link mode off

  await setLinkMode(request, true);
  await phoneTap(request, PENGUIN.canonical_id);
  const ev = await (await tap(request, '99887766')).json();
  expect(ev.linked).toBe(true);
  expect(ev.card.aliases).toContain('99887766');
  await setLinkMode(request, false);
  expect((await (await tap(request, '99887766')).json()).card.label).toBe('Penguin');
});

test('SSE delivers tap and cards events', async ({ page, request }) => {
  await page.goto('/');
  const events = page.evaluate(() => new Promise((resolve) => {
    const got = [];
    const es = new EventSource('/events');
    const done = (type) => (e) => {
      got.push({ type, data: JSON.parse(e.data) });
      if (got.length === 2) { es.close(); resolve(got); }
    };
    es.addEventListener('tap', done('tap'));
    es.addEventListener('cards', done('cards'));
    es.addEventListener('open', () => window.__sseOpen = true);
  }));
  await page.waitForFunction(() => window.__sseOpen);
  await phoneTap(request, 'C3B2A104');
  await setCards(request, [PENGUIN]);
  const got = await events;
  expect(got[0]).toMatchObject({ type: 'tap', data: { canonical_id: 'C3B2A104', card: { label: 'Penguin' } } });
  expect(got[1].type).toBe('cards');
  expect(got[1].data).toHaveLength(1);
});

test('upsert one card and resolve it in reader form', async ({ request }) => {
  const owl = { canonical_id: '04:11:22:33:44:55:66', emoji: '🦉', label: 'Owl', color: { hex: '#8D6E63', name: 'Brown' } };
  const res = await request.post('/api/cards', { data: owl });
  expect(res.status(), await res.text()).toBe(200);
  expect((await res.json()).canonical_id).toBe('04112233445566');
  expect(await getCards(request)).toHaveLength(3);

  const resolved = await (await request.get('/api/cards/resolve?id=66554433')).json();
  expect(resolved).toMatchObject({ canonical_id: '66554433', card: { label: 'Owl' } });
  const unknown = await (await request.get('/api/cards/resolve?id=DEADBEEF')).json();
  expect(unknown).toEqual({ canonical_id: 'DEADBEEF', card: null });
  expect((await request.get('/api/cards/resolve?id=zebra')).status()).toBe(400);

  const dup = await request.post('/api/cards', { data: { ...owl, canonical_id: 'F6E5D4C3B2A104' } });
  expect(dup.status()).toBe(409);
});

test('image upload is stored, served, and versioned', async ({ request }) => {
  const res = await uploadImage(request, PENGUIN.canonical_id);
  expect(res.status(), await res.text()).toBe(200);
  const card = await res.json();
  expect(card.image).toMatch(/^\/images\/04A1B2C3D4E5F6\.png\?v=\d+$/);
  const img = await request.get(card.image);
  expect(img.status()).toBe(200);
  expect(img.headers()['content-type']).toBe('image/png');
  expect(Buffer.compare(await img.body(), PNG_1PX)).toBe(0);
  expect((await getCards(request)).find((c) => c.canonical_id === PENGUIN.canonical_id).image).toBe(card.image);
});

test('image upload rejects unknown id, non-png, and oversized', async ({ request }) => {
  expect((await uploadImage(request, '04999999999999')).status()).toBe(404);
  expect((await uploadImage(request, PENGUIN.canonical_id, Buffer.from('hello'), 'image/jpeg')).status()).toBe(415);
  const big = Buffer.concat([PNG_1PX, Buffer.alloc(5 * 1024 * 1024 + 2048)]);
  expect((await uploadImage(request, PENGUIN.canonical_id, big)).status()).toBe(413);
  expect((await getCards(request)).every((c) => !c.image)).toBe(true);
});

test('images route refuses path tricks', async ({ request }) => {
  for (const path of ['/images/..%2Fcards.json', '/images/cards.json', '/images/04a1b2c3d4e5f6.png', '/images/.png']) {
    expect((await request.get(path)).status(), path).toBe(404);
  }
});

test('away card tapped clears away; clear-away resets all', async ({ request }) => {
  await setCards(request, [{ ...PENGUIN, away: true }, { ...LION, away: true }]);
  const ev = await phoneTap(request, PENGUIN.canonical_id);
  expect(ev.card.away).toBe(false);
  const cards = await getCards(request);
  expect(cards.find((c) => c.label === 'Penguin').away).toBe(false);
  expect(cards.find((c) => c.label === 'Lion').away).toBe(true);
  const cleared = await (await request.post('/api/cards/clear-away')).json();
  expect(cleared.every((c) => c.away === false)).toBe(true);
});

test('role round-trips and legacy trick maps to trick', async ({ request }) => {
  const saved = await setCards(request, [{ ...PENGUIN, trick: true }, STAR_SPECIAL, LION]);
  expect(saved.map((c) => c.role)).toEqual(['trick', 'special', 'normal']);
  expect(saved[0]).not.toHaveProperty('trick');
  expect(saved[1].allowed).toBe(false);
});

test('presenter shows the waiting trick badge and the last unknown id', async ({ request }) => {
  await setCards(request, [PENGUIN, FOX_TRICK]);
  await command(request, 'reset');
  await phoneTap(request, 'deadbeef');
  await phoneTap(request, FOX_TRICK.canonical_id);
  const p = await (await request.get('/api/presenter')).json();
  expect(p.last_unknown.raw_id).toBe('deadbeef');
  expect(p.waiting).toMatchObject({ kind: 'trick', raw_id: FOX_TRICK.canonical_id, card: { label: 'Fox' } });
  await command(request, 'keep-out');
  expect((await (await request.get('/api/presenter')).json()).waiting).toBeNull();
});

test('allow-special flips allowed, and commands reach the page over SSE', async ({ page, request }) => {
  await setCards(request, [PENGUIN, STAR_SPECIAL]);
  await page.goto('/');
  const got = page.evaluate(() => new Promise((resolve) => {
    const es = new EventSource('/events');
    es.addEventListener('open', () => (window.__sseOpen = true));
    es.addEventListener('command', (e) => { es.close(); resolve(JSON.parse(e.data)); });
  }));
  await page.waitForFunction(() => window.__sseOpen);
  expect((await command(request, 'allow-special')).status()).toBe(200);
  expect(await got).toEqual({ action: 'allow-special' });
  const star = (await getCards(request)).find((c) => c.role === 'special');
  expect(star.allowed).toBe(true);
  await phoneTap(request, STAR_SPECIAL.canonical_id);
  expect((await (await request.get('/api/presenter')).json()).waiting).toBeNull();
});

test('reset denies the special again and clears presenter state', async ({ request }) => {
  await setCards(request, [STAR_SPECIAL]);
  await phoneTap(request, STAR_SPECIAL.canonical_id);
  await phoneTap(request, 'deadbeef');
  await command(request, 'allow-special');
  await command(request, 'reset');
  expect((await getCards(request))[0].allowed).toBe(false);
  expect(await (await request.get('/api/presenter')).json()).toEqual({ waiting: null, last_unknown: null });
});

test('unknown command is rejected', async ({ request }) => {
  expect((await command(request, 'nope')).status()).toBe(400);
});

test('a tap says when a trick or special badge is waiting; a trick that was let in stops waiting', async ({ request }) => {
  await setCards(request, [PENGUIN, FOX_TRICK, STAR_SPECIAL]);
  await command(request, 'reset');
  expect((await phoneTap(request, PENGUIN.canonical_id)).waiting).toBeUndefined();
  expect((await phoneTap(request, STAR_SPECIAL.canonical_id)).waiting).toBe('special');
  expect((await phoneTap(request, FOX_TRICK.canonical_id)).waiting).toBe('trick');
  await command(request, 'keep-out');
  expect((await phoneTap(request, FOX_TRICK.canonical_id)).waiting).toBe('trick'); // kept out isn't final
  await command(request, 'let-in');
  expect((await phoneTap(request, FOX_TRICK.canonical_id)).waiting).toBeUndefined(); // it's inside
});

test('a command can name the badge it is for, and the page hears which', async ({ page, request }) => {
  await page.goto('/#debug');
  await page.evaluate(() => {
    window.__commands = [];
    new EventSource('/events').addEventListener('command', (e) => window.__commands.push(JSON.parse(e.data)));
  });
  await page.waitForTimeout(500);
  await request.post('/api/command', { data: { action: 'let-in', card: '04:ca:fe:f0:0d:be:ef' } });
  await expect.poll(() => page.evaluate(() => window.__commands)).toContainEqual({ action: 'let-in', card: '04CAFEF00DBEEF' });
});
