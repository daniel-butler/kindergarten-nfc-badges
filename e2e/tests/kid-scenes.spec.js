const { test, expect } = require('@playwright/test');
const {
  STAR_SPECIAL, command, reloadPage, uploadImage, getCards, PENGUIN, LION, FOX_TRICK, manyCards, setCards, phoneTap, openScene, readerScan, scene,
} = require('./helpers');

const slot = (page, card) => page.locator(`.zoo-slot.filled[data-id="${card.canonical_id}"]`);

test.beforeEach(async ({ request }) => {
  await setCards(request, [PENGUIN, LION, FOX_TRICK]);
  await command(request, 'reset');
});

test.describe('Zoo Gate (backup, ⌥6)', () => {
  const tally = (page, n) => page.locator(`.zoo-tally[data-count="${n}"]`);

  test('normal badges walk in and add marks; unknown badges get a gentle retry', async ({ page, request }) => {
    await openScene(page, 'gate', 3);
    await expect(tally(page, 0)).toBeVisible();
    await phoneTap(request, PENGUIN.canonical_id);
    await expect(page.locator('.walker')).toHaveCount(1);
    await expect(tally(page, 1)).toBeVisible();
    await expect(slot(page, PENGUIN)).toBeVisible({ timeout: 5000 });

    await phoneTap(request, 'DEADBEEF');
    await expect(page.locator('.zoo-oops')).toHaveText('Oops! Tap again 🔄');
    await expect(page.locator('.zoo-denied')).toHaveCount(0);
    await expect(tally(page, 1)).toBeVisible();
  });

  test('trick badges get the same vote in the backup', async ({ page, request }) => {
    await openScene(page, 'gate', 3);
    await phoneTap(request, FOX_TRICK.canonical_id);
    await expect(page.locator('.zoo-vote')).toBeVisible();
    await page.keyboard.press('Alt+y');
    await expect(tally(page, 1)).toBeVisible();
    await expect(slot(page, FOX_TRICK)).toBeVisible({ timeout: 5000 });
  });

  test('the special badge finale works in the backup too', async ({ page, request }) => {
    await setCards(request, [PENGUIN, STAR_SPECIAL]);
    await command(request, 'reset');
    await openScene(page, 'gate', 2);
    await phoneTap(request, STAR_SPECIAL.canonical_id);
    await expect(page.locator('.zoo-special-denied')).toBeVisible();
    await expect(tally(page, 0)).toBeVisible();
    await page.keyboard.press('Alt+a');
    await expect(page.locator('.zoo-list-new')).toBeVisible();
    await page.waitForTimeout(1600); // same badge again within 1.5 s counts as a repeat
    await phoneTap(request, STAR_SPECIAL.canonical_id);
    await expect(tally(page, 1)).toBeVisible();
    await expect(scene(page)).toContainText('Congratulations, Official Zookeepers!', { timeout: 20000 });
  });

  test('Option+S opens the gate, parades, and congratulates', async ({ page, request }) => {
    await openScene(page, 'gate', 3);
    await phoneTap(request, PENGUIN.canonical_id);
    await page.keyboard.press('Alt+s');
    await expect(page.locator('.zoo-gate')).toHaveClass(/open/, { timeout: 5000 });
    await expect(scene(page)).toContainText('Congratulations, Official Zookeepers!', { timeout: 15000 });
  });

  test('check-ins survive reload; Option+R twice resets', async ({ page, request }) => {
    await openScene(page, 'gate', 3);
    await phoneTap(request, PENGUIN.canonical_id);
    await expect(tally(page, 1)).toBeVisible();
    await reloadPage(page, 3);
    await expect(tally(page, 1)).toBeVisible();
    await expect(slot(page, PENGUIN)).toBeVisible();
    await page.keyboard.press('Alt+r');
    await page.keyboard.press('Alt+r');
    await expect(tally(page, 0)).toBeVisible();
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
  });

  test('reader-format ids are looked up too; unknown ids get a gentle retry', async ({ page, request }) => {
    await openScene(page, 'list', 3);
    await readerScan(page, 'C3B2A104');
    await expect(page.locator(`.list-row.hit[data-id="${PENGUIN.canonical_id}"]`)).toBeVisible({ timeout: 3000 });
    await expect(page.locator('.list-lookup')).toContainText('C3B2A104');

    await page.evaluate(() => {
      window.__buzzes = 0;
      const s = window.Badge.sound;
      for (const name of ['buzzer', 'silly']) { const o = s[name]; s[name] = () => { window.__buzzes++; o(); }; }
    });
    await phoneTap(request, 'DEADBEEF');
    await expect(page.locator('.zoo-oops')).toHaveText('Oops! Tap again 🔄');
    await page.waitForTimeout(500);
    await expect(page.locator('.list-lookup')).not.toContainText('Not on the list');
    expect(await page.evaluate(() => window.__buzzes)).toBe(0);
  });
});

test.describe('Who has the ___?', () => {
  const targetId = (page) => page.locator('.who-target').getAttribute('data-id');
  const byId = (id) => [PENGUIN, LION, FOX_TRICK].find((c) => c.canonical_id === id);

  test('wrong badge buzzes, right badge celebrates, then a new animal is asked', async ({ page, request }) => {
    await openScene(page, 'who', 3);
    const first = byId(await targetId(page));
    await expect(scene(page)).toContainText(`${first.label}?`);

    const wrong = [PENGUIN, LION, FOX_TRICK].find((c) => c !== first);
    await phoneTap(request, wrong.canonical_id);
    await expect(scene(page)).toContainText('Nope!');
    await expect(scene(page)).toContainText(`That's the ${wrong.label}`);
    await expect(page.locator('.who-target')).toHaveAttribute('data-id', first.canonical_id, { timeout: 4000 });

    await phoneTap(request, first.canonical_id);
    await expect(scene(page)).toContainText(`It's the ${first.label}!`);
    await expect(page.locator('.who-target')).toBeVisible({ timeout: 6000 });
    expect(await targetId(page)).not.toBe(first.canonical_id);
  });

  test('an unknown badge gets a gentle retry, not a Nope', async ({ page, request }) => {
    await openScene(page, 'who', 3);
    const first = await page.locator('.who-target').getAttribute('data-id');
    await phoneTap(request, 'DEADBEEF');
    await expect(page.locator('.zoo-oops')).toHaveText('Oops! Tap again 🔄');
    await expect(scene(page)).not.toContainText('Nope!');
    await expect(page.locator('.who-target')).toHaveAttribute('data-id', first);
  });

  test('presenter key skips to a different animal', async ({ page }) => {
    await openScene(page, 'who', 3);
    const first = await targetId(page);
    await page.keyboard.press('Alt+s');
    await expect.poll(() => targetId(page)).not.toBe(first);
  });
});

test.describe('kid theme and sound', () => {
  test('kid scenes use the bright theme; setup and debug do not', async ({ page }) => {
    await openScene(page, 'gate', 3);
    for (const [key, kid] of [['Alt+2', true], ['Alt+3', true], ['Alt+4', true], ['Alt+5', true], ['Alt+6', true], ['Alt+1', false], ['Alt+0', false]]) {
      await page.keyboard.press(key);
      if (kid) await expect(page.locator('body')).toHaveClass(/kid-mode/);
      else await expect(page.locator('body')).not.toHaveClass(/kid-mode/);
    }
  });

  test('the page never speaks', async ({ page, request }) => {
    await page.addInitScript(() => {
      window.__spoken = [];
      Object.defineProperty(window, 'speechSynthesis', {
        configurable: true,
        value: { getVoices: () => [], speak: (u) => window.__spoken.push(u.text), cancel() {}, addEventListener() {} },
      });
    });
    await openScene(page, 'secret', 3);
    for (const key of ['Alt+2', 'Alt+3', 'Alt+4', 'Alt+5', 'Alt+6']) {
      await page.keyboard.press(key);
      await phoneTap(request, PENGUIN.canonical_id);
      await phoneTap(request, 'DEADBEEF');
      await page.waitForTimeout(400);
    }
    expect(await page.evaluate(() => window.__spoken)).toEqual([]);
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

    await page.keyboard.press('Alt+6');
    await expect(page.locator('.zoo-slot')).toHaveCount(25);
    await expect(page.locator('.zoo-tally[data-count="0"]')).toBeVisible();
    await expect(page.locator('.zoo-grid')).toHaveAttribute('style', /grid-template-columns/);
    for (const s of [page.locator('.zoo-slot').first(), page.locator('.zoo-slot').last()]) {
      const box = await s.boundingBox();
      expect(box.y + box.height).toBeLessThanOrEqual(720);
      expect(box.x + box.width).toBeLessThanOrEqual(1280);
    }
  });
});

test.describe('sticker photos and not here today', () => {
  const sticker = (page, card) => page.locator(`img.sticker[src^="/images/${card.canonical_id}.png"]`);

  test('The List shows the sticker photo for cards that have one', async ({ page, request }) => {
    await uploadImage(request, PENGUIN.canonical_id);
    await openScene(page, 'list', 3);
    const row = page.locator(`.list-row[data-id="${PENGUIN.canonical_id}"]`);
    await expect(row.locator('img.sticker')).toHaveAttribute('src', /^\/images\/04A1B2C3D4E5F6\.png\?v=\d+$/);
    await expect(page.locator(`.list-row[data-id="${LION.canonical_id}"]`)).toContainText('🦁');
  });

  test('Who has the ___? shows the sticker photo', async ({ page, request }) => {
    for (const c of [PENGUIN, LION, FOX_TRICK]) await uploadImage(request, c.canonical_id);
    await openScene(page, 'who', 3);
    await expect(page.locator('.who-target img.sticker')).toBeVisible();
  });

  test('Setup and Debug show sticker photos too', async ({ page, request }) => {
    await uploadImage(request, PENGUIN.canonical_id);
    await openScene(page, 'setup', 3);
    await expect(sticker(page, PENGUIN)).toBeVisible();
    await page.keyboard.press('Alt+0');
    await phoneTap(request, PENGUIN.canonical_id);
    await expect(page.locator('.debug-log').locator('img.sticker')).toHaveCount(1);
  });

  test('not here today: The List fades it with 💤 and Who has never asks for it', async ({ page, request }) => {
    await setCards(request, [PENGUIN, { ...LION, away: true }]);
    await openScene(page, 'list', 2);
    const lion = page.locator(`.list-row[data-id="${LION.canonical_id}"]`);
    await expect(lion).toHaveClass(/away/);
    await expect(lion).toContainText('💤');
    await page.keyboard.press('Alt+5');
    for (let i = 0; i < 5; i++) {
      await expect(page.locator('.who-target')).toHaveAttribute('data-id', PENGUIN.canonical_id);
      await page.keyboard.press('Alt+s');
    }
  });

  test("Everyone's here clears not here today from the panel", async ({ page, request }) => {
    await setCards(request, [{ ...PENGUIN, away: true }, { ...LION, away: true }]);
    await openScene(page, 'setup', 2);
    await expect(page.locator('.mini-card.away')).toHaveCount(2);
    await page.keyboard.press('Alt+p');
    await page.locator('#panel button', { hasText: "Everyone's here" }).click();
    await expect.poll(async () => (await getCards(request)).filter((c) => c.away).length).toBe(0);
    await expect(page.locator('.mini-card.away')).toHaveCount(0);
  });
});
