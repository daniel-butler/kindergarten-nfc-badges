const { test, expect } = require('@playwright/test');
const { PENGUIN, LION, setCards, getCards, phoneTap, setLinkMode } = require('./helpers');

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

test('cards require a cardstock color and keep the trick flag', async ({ request }) => {
  const { color, ...noColor } = PENGUIN;
  expect((await request.put('/api/cards', { data: [noColor] })).status()).toBe(422);
  expect((await request.put('/api/cards', { data: [{ ...PENGUIN, color: { hex: 'blue', name: 'Blue' } }] })).status()).toBe(409);

  const saved = await setCards(request, [{ ...PENGUIN, color: { hex: '#1e5bd8', name: 'Blue' } }, { ...LION, trick: true }]);
  expect(saved[0]).toMatchObject({ color: { hex: '#1E5BD8', name: 'Blue' }, trick: false });
  expect(saved[1].trick).toBe(true);
  const ev = await (await tap(request, LION.canonical_id)).json();
  expect(ev.card).toMatchObject({ trick: true, color: { name: 'Yellow' } });
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
