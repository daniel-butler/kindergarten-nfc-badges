const { test, expect } = require('@playwright/test');
const {
  reloadPage, PENGUIN, LION, FOX_TRICK, manyCards, spoken, setCards, phoneTap, openScene, readerScan, scene,
} = require('./helpers');

const slot = (page, card) => page.locator(`.zoo-slot.filled[data-id="${card.canonical_id}"]`);

test.beforeEach(async ({ request }) => {
  await setCards(request, [PENGUIN, LION, FOX_TRICK]);
});

test.describe('Zoo Gate', () => {
  test('check-ins walk in, count only real badges, and deny unknown badges', async ({ page, request }) => {
    await openScene(page, 'zoo', 3);
    await expect(page.locator('.zoo-counter')).toHaveText('0 of 2 zookeepers checked in');

    await phoneTap(request, PENGUIN.canonical_id);
    await expect(page.locator('.walker')).toHaveCount(1);
    await expect(page.locator('.zoo-counter')).toHaveText('1 of 2 zookeepers checked in');
    await expect(slot(page, PENGUIN)).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.zoo-progress-fill')).toHaveAttribute('style', /width: 50%/);
    expect(await spoken(page)).toContain('Welcome, Penguin keeper!');

    await phoneTap(request, FOX_TRICK.canonical_id); // trick badge: walks in, not counted
    await expect(slot(page, FOX_TRICK)).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.zoo-counter')).toHaveText('1 of 2 zookeepers checked in');

    await phoneTap(request, PENGUIN.canonical_id); // already inside
    await expect(page.locator('.zoo-counter')).toHaveText('1 of 2 zookeepers checked in');
    await expect(page.locator('.zoo-slot.filled')).toHaveCount(2);

    await phoneTap(request, 'DEADBEEF');
    await expect(page.locator('.zoo-denied')).toContainText('ACCESS DENIED');
    expect(await spoken(page)).toContain('Access denied!');
    await expect(page.locator('.zoo-denied')).toBeHidden({ timeout: 4000 });
  });

  test('last real check-in opens the gate, parades, and congratulates', async ({ page, request }) => {
    await openScene(page, 'zoo', 3);
    await phoneTap(request, PENGUIN.canonical_id);
    await phoneTap(request, LION.canonical_id);
    await expect(page.locator('.zoo-counter')).toHaveText('2 of 2 zookeepers checked in');
    await expect(page.locator('.zoo-gate')).toHaveClass(/open/, { timeout: 5000 });
    await expect(page.locator('.marcher')).toHaveCount(3, { timeout: 5000 });
    await expect(scene(page)).toContainText('Congratulations, Official Zookeepers!', { timeout: 15000 });
    await expect(page.locator('.finale-animals .ring')).toHaveCount(3);
    expect(await spoken(page)).toContain('Congratulations, Official Zookeepers!');
  });

  test('presenter can open the gate early; check-ins survive reload; reset clears', async ({ page, request }) => {
    await openScene(page, 'zoo', 3);
    await phoneTap(request, PENGUIN.canonical_id);
    await expect(page.locator('.zoo-counter')).toHaveText('1 of 2 zookeepers checked in');

    await reloadPage(page, 3);
    await expect(page.locator('.zoo-counter')).toHaveText('1 of 2 zookeepers checked in');
    await expect(slot(page, PENGUIN)).toBeVisible();

    await page.keyboard.press('Alt+s');
    await expect(page.locator('.zoo-gate')).toHaveClass(/open/);
    await expect(scene(page)).toContainText('Congratulations', { timeout: 15000 });

    await page.keyboard.press('Alt+p');
    await page.locator('#panel button', { hasText: 'Reset check-ins' }).click();
    await expect(page.locator('.zoo-counter')).toHaveText('0 of 2 zookeepers checked in');
  });
});

test.describe('The List', () => {
  test('lists every card and scans down to the tapped one', async ({ page, request }) => {
    await openScene(page, 'list', 3);
    const rows = page.locator('.list-row');
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(1)).toContainText(LION.canonical_id);
    await expect(rows.nth(1)).toContainText('🦁');
    await expect(rows.nth(1).locator('.list-swatch')).toHaveCSS('background-color', 'rgb(253, 216, 53)');

    await phoneTap(request, LION.canonical_id);
    await expect(page.locator('.list-lookup')).toContainText('looking');
    await expect(page.locator(`.list-row.hit[data-id="${LION.canonical_id}"]`)).toBeVisible({ timeout: 3000 });
    await expect(page.locator('.list-lookup')).toContainText('Lion!');
    await expect(page.locator('.list-row.hit')).toHaveCount(1);
    expect(await spoken(page)).toContain('Found it! Lion!');
  });

  test('reader-format ids are looked up too; unknown ids are not on the list', async ({ page, request }) => {
    await openScene(page, 'list', 3);
    await readerScan(page, 'C3B2A104');
    await expect(page.locator(`.list-row.hit[data-id="${PENGUIN.canonical_id}"]`)).toBeVisible({ timeout: 3000 });
    await expect(page.locator('.list-lookup')).toContainText('C3B2A104');

    await phoneTap(request, 'DEADBEEF');
    await expect(page.locator('.list-lookup')).toContainText('Not on the list!', { timeout: 3000 });
    await expect(page.locator('.list-row.hit')).toHaveCount(0);
  });
});

test.describe('Who has the ___?', () => {
  const targetId = (page) => page.locator('.who-target').getAttribute('data-id');
  const byId = (id) => [PENGUIN, LION, FOX_TRICK].find((c) => c.canonical_id === id);

  test('wrong badge buzzes, right badge celebrates, then a new animal is asked', async ({ page, request }) => {
    await openScene(page, 'who', 3);
    const first = byId(await targetId(page));
    await expect(scene(page)).toContainText(`${first.label}?`);
    expect(await spoken(page)).toContain(`Who has the ${first.label}?`);

    const wrong = [PENGUIN, LION, FOX_TRICK].find((c) => c !== first);
    await phoneTap(request, wrong.canonical_id);
    await expect(scene(page)).toContainText('Nope!');
    await expect(scene(page)).toContainText(`That's the ${wrong.label}`);
    await expect(page.locator('.who-target')).toHaveAttribute('data-id', first.canonical_id, { timeout: 4000 });

    await phoneTap(request, first.canonical_id);
    await expect(scene(page)).toContainText(`It's the ${first.label}!`);
    await expect(page.locator('.who-target')).toBeVisible({ timeout: 6000 });
    expect(await targetId(page), JSON.stringify(await spoken(page))).not.toBe(first.canonical_id);
  });

  test('presenter key skips to a different animal', async ({ page }) => {
    await openScene(page, 'who', 3);
    const first = await targetId(page);
    await page.keyboard.press('Alt+s');
    await expect.poll(() => targetId(page)).not.toBe(first);
  });
});

test.describe('kid theme and voice', () => {
  test('kid scenes use the bright theme; setup and debug do not', async ({ page }) => {
    await openScene(page, 'zoo', 3);
    for (const [key, kid] of [['Alt+2', true], ['Alt+3', true], ['Alt+4', true], ['Alt+5', true], ['Alt+1', false], ['Alt+0', false]]) {
      await page.keyboard.press(key);
      if (kid) await expect(page.locator('body')).toHaveClass(/kid-mode/);
      else await expect(page.locator('body')).not.toHaveClass(/kid-mode/);
    }
  });

  test('Option+V toggles the voice', async ({ page }) => {
    await openScene(page, 'who', 3);
    expect(await page.evaluate(() => window.Badge.voice.enabled)).toBe(true);
    await page.keyboard.press('Alt+v');
    expect(await page.evaluate(() => window.Badge.voice.enabled)).toBe(false);
  });
});

test.describe('25 badges at 720p', () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test('The List and the Zoo Gate fit on screen', async ({ page, request }) => {
    const cards = manyCards(25);
    await setCards(request, cards);
    await openScene(page, 'list', 25);
    const last = await page.locator('.list-row').last().boundingBox();
    expect(last.y + last.height).toBeLessThanOrEqual(720);
    await expect(page.locator('.list-row')).toHaveCount(25);

    await page.keyboard.press('Alt+3');
    await expect(page.locator('.zoo-slot')).toHaveCount(25);
    await expect(page.locator('.zoo-counter')).toHaveText('0 of 23 zookeepers checked in');
    await expect(page.locator('.zoo-grid')).toHaveAttribute('style', /grid-template-columns/);
    for (const s of [page.locator('.zoo-slot').first(), page.locator('.zoo-slot').last()]) {
      const box = await s.boundingBox();
      expect(box.y + box.height).toBeLessThanOrEqual(720);
      expect(box.x + box.width).toBeLessThanOrEqual(1280);
    }
  });
});
