const { test, expect } = require('@playwright/test');
const {
  PENGUIN, LION, FOX_TRICK, manyCards, command, setCards, phoneTap, openScene, reloadPage, scene,
} = require('./helpers');

const OWL_AWAY = { canonical_id: '04BEEFBEEFBEEF', emoji: '🦉', label: 'Owl', color: { hex: '#8D6E63', name: 'Brown' }, away: true };
const zooState = (page) => page.evaluate(() => window.Badge.current.state());
const inside = async (page) => (await zooState(page)).inside;
const tally = (page, n) => page.locator(`.zoo-tally[data-count="${n}"]`);
const spyBuzzer = (page) => page.evaluate(() => {
  window.__buzzes = 0;
  const original = window.Badge.sound.buzzer;
  window.Badge.sound.buzzer = () => { window.__buzzes++; original(); };
});
const resetKeys = async (page) => {
  await page.keyboard.press('Alt+r');
  await page.keyboard.press('Alt+r');
};

test.beforeEach(async ({ request }) => {
  await setCards(request, [PENGUIN, LION, FOX_TRICK, OWL_AWAY]);
  await command(request, 'reset');
});

test('zoo loads with no page errors and an empty tally', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await openScene(page, 'zoo', 4);
  await expect(tally(page, 0)).toBeVisible();
  await expect(page.locator('#scene canvas')).toBeVisible();
  await page.waitForTimeout(500);
  expect(errors).toEqual([]);
});

test('normal taps add tally marks at once and the animal goes inside', async ({ page, request }) => {
  await openScene(page, 'zoo', 4);
  await phoneTap(request, PENGUIN.canonical_id);
  await expect(tally(page, 1)).toBeVisible();
  await phoneTap(request, LION.canonical_id);
  await expect(tally(page, 2)).toBeVisible();
  await expect.poll(() => inside(page), { timeout: 15000 }).toEqual(expect.arrayContaining([PENGUIN.canonical_id, LION.canonical_id]));
  await expect(page.locator('.zoo-tally svg')).toHaveCount(1);
});

test('tally marks group in fives', async ({ page, request }) => {
  const cards = manyCards(7);
  await setCards(request, cards);
  await openScene(page, 'zoo', 7);
  for (const c of cards) await phoneTap(request, c.canonical_id);
  await expect(tally(page, 7)).toBeVisible();
  await expect(page.locator('.zoo-tally svg')).toHaveCount(2);
  await expect(page.locator('.zoo-tally svg').first().locator('line')).toHaveCount(5);
});

test('five quick taps all arrive', async ({ page, request }) => {
  const cards = manyCards(5);
  await setCards(request, cards);
  await openScene(page, 'zoo', 5);
  for (const c of cards) await phoneTap(request, c.canonical_id);
  await expect(tally(page, 5)).toBeVisible();
  await expect.poll(async () => (await inside(page)).length, { timeout: 25000 }).toBe(5);
});

test('unknown badge: gentle retry, no buzzer, nobody enters', async ({ page, request }) => {
  await openScene(page, 'zoo', 4);
  await spyBuzzer(page);
  await phoneTap(request, 'DEADBEEF');
  await expect(page.locator('.zoo-oops')).toHaveText('Oops! Tap again 🔄');
  await expect(page.locator('.zoo-denied')).toHaveCount(0);
  expect(await page.evaluate(() => window.__buzzes)).toBe(0);
  expect(await zooState(page)).toMatchObject({ inside: [], queued: 0, finale: false, tally: 0 });
  await expect(page.locator('.zoo-oops')).toHaveCount(0, { timeout: 3000 });
});

test('a not-here-today kid who taps goes in and adds a mark', async ({ page, request }) => {
  await openScene(page, 'zoo', 4);
  await phoneTap(request, OWL_AWAY.canonical_id);
  await expect(tally(page, 1)).toBeVisible();
});

test('a not-here-today kid tapping during a rush leaves exactly one sticker per animal', async ({ page, request }) => {
  const cards = manyCards(3);
  await setCards(request, [...cards, OWL_AWAY]);
  await openScene(page, 'zoo', 4);
  for (const c of cards) await phoneTap(request, c.canonical_id);
  await phoneTap(request, OWL_AWAY.canonical_id); // clears away → cards event mid-queue
  await expect(tally(page, 4)).toBeVisible();
  await expect.poll(async () => (await inside(page)).length, { timeout: 30000 }).toBe(4);
  await page.waitForTimeout(500);
  expect((await zooState(page)).sprites).toBe(4);
});

test('everyone normal going in does not start the party by itself', async ({ page, request }) => {
  await setCards(request, [PENGUIN, LION]);
  await openScene(page, 'zoo', 2);
  await phoneTap(request, PENGUIN.canonical_id);
  await phoneTap(request, LION.canonical_id);
  await expect.poll(async () => (await inside(page)).length, { timeout: 15000 }).toBe(2);
  await page.waitForTimeout(3000);
  expect((await zooState(page)).finale).toBe(false);
});

test('Option+S starts the party', async ({ page }) => {
  await openScene(page, 'zoo', 4);
  await page.keyboard.press('Alt+s');
  await expect(page.locator('.zoo3d-finale')).toContainText('Congratulations, Official Zookeepers!', { timeout: 10000 });
});

test('the party command from the phone starts the party', async ({ page, request }) => {
  await openScene(page, 'zoo', 4);
  await command(request, 'party');
  await expect(page.locator('.zoo3d-finale')).toContainText('Congratulations, Official Zookeepers!', { timeout: 10000 });
});

test('Option+R twice resets tally, check-ins and party; once does nothing', async ({ page, request }) => {
  await openScene(page, 'zoo', 4);
  await phoneTap(request, PENGUIN.canonical_id);
  await expect(tally(page, 1)).toBeVisible();
  await page.keyboard.press('Alt+s');
  await expect(page.locator('.zoo3d-finale')).toBeVisible({ timeout: 10000 });
  await page.keyboard.press('Alt+r');
  await expect(page.locator('#banner')).toContainText('⌥R again');
  await expect(tally(page, 1)).toBeVisible();
  await page.keyboard.press('Alt+r');
  await expect(tally(page, 0)).toBeVisible();
  await expect(page.locator('.zoo3d-finale')).toHaveCount(0);
  expect(await zooState(page)).toMatchObject({ inside: [], finale: false, tally: 0 });
});

test('reset from the phone while another scene is showing still clears the zoo', async ({ page, request }) => {
  await openScene(page, 'zoo', 4);
  await phoneTap(request, PENGUIN.canonical_id);
  await expect(tally(page, 1)).toBeVisible();
  await page.keyboard.press('Alt+4');
  await command(request, 'reset');
  await page.waitForTimeout(300);
  await page.keyboard.press('Alt+3');
  await expect(tally(page, 0)).toBeVisible();
  expect(await inside(page)).toEqual([]);
});

test('scene commands from the phone switch scenes', async ({ page, request }) => {
  await openScene(page, 'zoo', 4);
  await command(request, 'scene-list');
  await expect(page.locator('#scene')).toHaveClass(/scene-list/);
  await command(request, 'scene-zoo');
  await expect(page.locator('#scene')).toHaveClass(/scene-zoo3d/);
});

test('check-ins and tally survive reload and are shared with the backup Zoo Gate', async ({ page, request }) => {
  await openScene(page, 'zoo', 4);
  await phoneTap(request, PENGUIN.canonical_id);
  await expect(tally(page, 1)).toBeVisible();
  await reloadPage(page, 4);
  await expect(tally(page, 1)).toBeVisible();
  expect(await inside(page)).toContain(PENGUIN.canonical_id);
  await page.keyboard.press('Alt+6');
  await expect(page.locator('#scene')).toHaveClass(/scene-gate/);
  await expect(tally(page, 1)).toBeVisible();
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
