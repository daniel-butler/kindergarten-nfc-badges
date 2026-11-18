const { test, expect } = require('@playwright/test');
const { PENGUIN, setCards, phoneTap, openScene, command, logLines } = require('./helpers');

const logged = (re) => logLines().some((l) => re.test(l));

test.beforeEach(async ({ request }) => {
  await setCards(request, [PENGUIN]);
});

test('the phone and the page can add lines to the shared log', async ({ request }) => {
  const res = await request.post('/api/log', { data: { source: 'phone', lines: ['10:15:59.123 app moved to the background'] } });
  expect(res.status()).toBe(204);
  expect(logged(/\[phone\] 10:15:59\.123 app moved to the background$/)).toBe(true);
  expect((await request.post('/api/log', { data: { source: 'hacker', lines: ['x'] } })).status()).toBe(400);
});

test('a log line cannot forge extra lines', async ({ request }) => {
  await request.post('/api/log', { data: { source: 'page', lines: ['one\n2026 [server] fake'] } });
  expect(logged(/\[page\] one 2026 \[server\] fake$/)).toBe(true);
});

test('the server logs taps, commands, and page connections', async ({ page, request }) => {
  await phoneTap(request, PENGUIN.canonical_id);
  await command(request, 'party');
  expect(logged(/\[server\] tap from phone 04A1B2C3D4E5F6 → 🐧 Penguin/)).toBe(true);
  expect(logged(/\[server\] command party/)).toBe(true);
  await openScene(page, 'zoo', 1);
  await expect.poll(() => logged(/\[server\] page connected \(\d+ open\)/)).toBe(true);
  await page.close();
  await expect.poll(() => logged(/\[server\] page disconnected \(\d+ open\)/)).toBe(true);
});

test('the page logs its connection, scene changes and errors to the shared log', async ({ page }) => {
  await openScene(page, 'zoo', 1);
  await expect.poll(() => logged(/\[page\] \S+ connected to server/)).toBe(true);
  await page.keyboard.press('Alt+4');
  await expect.poll(() => logged(/\[page\] \S+ scene → list/)).toBe(true);
  await page.evaluate(() => setTimeout(() => { throw new Error('boom from a test'); }));
  await expect.poll(() => logged(/\[page\] \S+ error: .*boom from a test/)).toBe(true);
});
