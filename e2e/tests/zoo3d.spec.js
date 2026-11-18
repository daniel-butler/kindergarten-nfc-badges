const { test, expect } = require('@playwright/test');
const {
  PENGUIN, LION, FOX_TRICK, manyCards, setCards, phoneTap, openScene, reloadPage, scene,
} = require('./helpers');

const OWL_AWAY = { canonical_id: '04BEEFBEEFBEEF', emoji: '🦉', label: 'Owl', color: { hex: '#8D6E63', name: 'Brown' }, away: true };
const zooState = (page) => page.evaluate(() => window.Badge.current.state());
const inside = async (page) => (await zooState(page)).inside;
const counter = (page) => page.locator('.zoo-counter');

test.beforeEach(async ({ request }) => {
  await setCards(request, [PENGUIN, LION, FOX_TRICK, OWL_AWAY]);
});

test('zoo loads with no page errors and counts only present, real animals', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await openScene(page, 'zoo', 4);
  await expect(counter(page)).toHaveText('0 of 2 animals are home');
  await expect(page.locator('#scene canvas')).toBeVisible();
  await page.waitForTimeout(500);
  expect(errors).toEqual([]);
});

test('known tap: counter updates at once and the animal is inside after arriving', async ({ page, request }) => {
  await openScene(page, 'zoo', 4);
  await phoneTap(request, PENGUIN.canonical_id);
  await expect(counter(page)).toHaveText('1 of 2 animals are home');
  await expect.poll(() => inside(page), { timeout: 10000 }).toContain(PENGUIN.canonical_id);
});

test('five quick taps all arrive', async ({ page, request }) => {
  const cards = manyCards(5);
  await setCards(request, cards);
  await openScene(page, 'zoo', 5);
  for (const c of cards) await phoneTap(request, c.canonical_id);
  await expect(counter(page)).toHaveText('5 of 5 animals are home');
  await expect.poll(async () => (await inside(page)).length, { timeout: 25000 }).toBe(5);
});

test('a not-here-today kid tapping during a rush leaves exactly one sticker per animal', async ({ page, request }) => {
  const cards = manyCards(3);
  await setCards(request, [...cards, OWL_AWAY]);
  await openScene(page, 'zoo', 4);
  for (const c of cards) await phoneTap(request, c.canonical_id);
  await phoneTap(request, OWL_AWAY.canonical_id); // clears away → cards event mid-queue
  await expect(counter(page)).toHaveText('4 of 4 animals are home');
  await expect.poll(async () => (await inside(page)).length, { timeout: 30000 }).toBe(4);
  await page.waitForTimeout(500);
  expect((await zooState(page)).sprites).toBe(4);
});

test('unknown badge shows ACCESS DENIED and nobody goes in', async ({ page, request }) => {
  await openScene(page, 'zoo', 4);
  await phoneTap(request, 'DEADBEEF');
  await expect(page.locator('.zoo-denied')).toContainText('ACCESS DENIED');
  expect(await zooState(page)).toMatchObject({ inside: [], queued: 0, finale: false });
});

test('a badge marked not here today checks in when tapped and the total grows', async ({ page, request }) => {
  await openScene(page, 'zoo', 4);
  await phoneTap(request, OWL_AWAY.canonical_id);
  await expect(counter(page)).toHaveText('1 of 3 animals are home');
});

test('the last real arrival starts the party', async ({ page, request }) => {
  await openScene(page, 'zoo', 4);
  await phoneTap(request, PENGUIN.canonical_id);
  await phoneTap(request, LION.canonical_id);
  await expect(page.locator('.zoo3d-finale')).toContainText('Congratulations, Official Zookeepers!', { timeout: 20000 });
  expect((await zooState(page)).finale).toBe(true);
});

test('Option+S starts the party early', async ({ page }) => {
  await openScene(page, 'zoo', 4);
  await page.keyboard.press('Alt+s');
  await expect(page.locator('.zoo3d-finale')).toContainText('Congratulations, Official Zookeepers!', { timeout: 10000 });
});

test('check-ins survive reload and are shared with the backup Zoo Gate', async ({ page, request }) => {
  await openScene(page, 'zoo', 4);
  await phoneTap(request, PENGUIN.canonical_id);
  await expect(counter(page)).toHaveText('1 of 2 animals are home');
  await reloadPage(page, 4);
  await expect(counter(page)).toHaveText('1 of 2 animals are home');
  expect(await inside(page)).toContain(PENGUIN.canonical_id);
  await page.keyboard.press('Alt+6');
  await expect(page.locator('#scene')).toHaveClass(/scene-gate/);
  await expect(counter(page)).toHaveText('1 of 2 animals are home');
});

test('Reset check-ins clears them', async ({ page, request }) => {
  await openScene(page, 'zoo', 4);
  await phoneTap(request, PENGUIN.canonical_id);
  await expect(counter(page)).toHaveText('1 of 2 animals are home');
  await page.keyboard.press('Alt+p');
  await page.locator('#panel button', { hasText: 'Reset check-ins' }).click();
  await expect(counter(page)).toHaveText('0 of 2 animals are home');
  expect(await inside(page)).toEqual([]);
});

test('without WebGL the scene points to the backup', async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
      return /webgl/.test(type) ? null : original.call(this, type, ...rest);
    };
  });
  await openScene(page, 'zoo', 4);
  await expect(page.locator('.zoo3d-fallback')).toContainText('⌥6');
});

test('with no real badges it says so and never parties', async ({ page, request }) => {
  await setCards(request, [FOX_TRICK]);
  await openScene(page, 'zoo', 1);
  await expect(counter(page)).toHaveText('No animals registered yet');
  await phoneTap(request, FOX_TRICK.canonical_id);
  await expect.poll(() => inside(page), { timeout: 10000 }).toContain(FOX_TRICK.canonical_id);
  await page.waitForTimeout(3000);
  expect((await zooState(page)).finale).toBe(false);
});
