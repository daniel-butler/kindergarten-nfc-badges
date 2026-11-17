const { test, expect } = require('@playwright/test');
const { PENGUIN, LION, setCards, getCards, phoneTap, setLinkMode, openScene, readerScan, scene } = require('./helpers');

test.beforeEach(async ({ request }) => {
  await setLinkMode(request, false);
  await setCards(request, [PENGUIN, LION]);
});

test.describe('Free tap', () => {
  test('known card shows emoji and label; unknown shows ACCESS DENIED', async ({ page, request }) => {
    await openScene(page, 'free', 2);
    await phoneTap(request, LION.canonical_id);
    await expect(scene(page)).toContainText('🦁');
    await expect(scene(page)).toContainText('Lion');
    await expect(scene(page).locator('.badge-circle')).toHaveCSS('background-color', 'rgb(253, 216, 53)');

    await phoneTap(request, 'DEADBEEF');
    await expect(scene(page)).toContainText('ACCESS DENIED');
    await expect(page.locator('#scene')).toHaveClass(/denied/);
  });

  test('returns to idle after a few seconds', async ({ page, request }) => {
    await openScene(page, 'free', 2);
    await phoneTap(request, PENGUIN.canonical_id);
    await expect(scene(page)).toContainText('Penguin');
    await expect(scene(page)).toContainText('Tap your badge!', { timeout: 6000 });
  });

  test('a quick repeat of the same badge is ignored', async ({ page, request }) => {
    await openScene(page, 'free', 2);
    await phoneTap(request, PENGUIN.canonical_id);
    await expect(scene(page)).toContainText('Penguin');
    await page.evaluate(() => {
      window.__taps = 0;
      const free = window.Badge.current;
      const orig = free.onTap;
      free.onTap = (ev) => { window.__taps++; orig.call(free, ev); };
    });
    await phoneTap(request, 'C3B2A104'); // same badge via reader-style id
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => window.__taps)).toBe(0);
  });
});

test.describe('Setup', () => {
  test('shows registered count and turns link mode on only while open', async ({ page, request }) => {
    await openScene(page, 'setup', 2);
    await expect(scene(page)).toContainText('2 badges registered');
    await expect.poll(async () => (await (await request.get('/api/link-mode')).json()).enabled).toBe(true);
    await page.keyboard.press('Alt+2');
    await expect.poll(async () => (await (await request.get('/api/link-mode')).json()).enabled).toBe(false);
  });

  test('unknown badge → pick animal and color → saved', async ({ page, request }) => {
    await openScene(page, 'setup', 2);
    await phoneTap(request, '04112233445566');
    await expect(scene(page)).toContainText('New badge!');
    await expect(page.locator('button', { hasText: 'Save' })).toBeDisabled();
    await expect(page.locator('button.animal[title=Penguin]')).toHaveClass(/taken/);

    await page.locator('button.animal[title=Fox]').click();
    await page.locator('button.swatch[title=Orange]').click();
    await page.locator('button', { hasText: 'Save' }).click();
    await expect(scene(page)).toContainText('Saved');
    await expect(scene(page)).toContainText('3 badges registered');

    const fox = (await getCards(request)).find((c) => c.canonical_id === '04112233445566');
    expect(fox).toMatchObject({ emoji: '🦊', label: 'Fox', color: '#FB8C00' });
  });

  test('known badge can be changed and deleted', async ({ page, request }) => {
    await openScene(page, 'setup', 2);
    await phoneTap(request, LION.canonical_id);
    await expect(scene(page)).toContainText('Already registered');
    await page.locator('button', { hasText: 'Change' }).click();
    await page.locator('button.swatch[title=Purple]').click();
    await page.locator('button', { hasText: 'Save' }).click();
    await expect(scene(page)).toContainText('Saved');
    expect((await getCards(request)).find((c) => c.label === 'Lion').color).toBe('#8E24AA');

    await page.locator('button', { hasText: 'Done' }).click();
    await page.locator('.mini-card[title=Lion]').click();
    await page.locator('button', { hasText: 'Delete' }).click();
    await expect(scene(page)).toContainText('1 badge registered');
    expect(await getCards(request)).toHaveLength(1);
  });

  test('tap phone then reader links the reader id', async ({ page, request }) => {
    await openScene(page, 'setup', 2);
    await phoneTap(request, PENGUIN.canonical_id);
    await expect(scene(page)).toContainText('Already registered');
    await readerScan(page, '99887766');
    await expect(scene(page)).toContainText('Linked reader ID 99887766');
    expect((await getCards(request)).find((c) => c.label === 'Penguin').aliases).toContain('99887766');
  });

  test('duplicate badge is flagged loudly', async ({ page, request }) => {
    // Two cards sharing a first 4 bytes make a 4-byte reader id ambiguous → unknown → save conflicts.
    await setCards(request, [PENGUIN, { ...LION, canonical_id: '04A1B2C3999999' }]);
    await openScene(page, 'setup', 2);
    await readerScan(page, '04A1B2C3');
    await page.locator('button.animal[title=Owl]').click();
    await page.locator('button.swatch[title=Brown]').click();
    await page.locator('button', { hasText: 'Save' }).click();
    await expect(scene(page)).toContainText('DUPLICATE BADGE');
    await expect(page.locator('#scene')).toHaveClass(/dup/);
    expect(await getCards(request)).toHaveLength(2);
  });
});

test.describe('Debug and presenter panel', () => {
  test('debug lists source, raw id, canonical id, and matched card', async ({ page, request }) => {
    await openScene(page, 'debug', 2);
    await phoneTap(request, 'f6:e5:d4:c3:b2:a1:04');
    const row = scene(page).locator('tr', { hasText: 'f6:e5:d4:c3:b2:a1:04' });
    await expect(row).toContainText('📱 phone');
    await expect(row).toContainText('F6E5D4C3B2A104');
    await expect(row).toContainText('Penguin');
  });

  test('panel lists scenes and switches between them', async ({ page }) => {
    await openScene(page, 'free', 2);
    await page.keyboard.press('Alt+p');
    const panel = page.locator('#panel');
    await expect(panel).toBeVisible();
    await expect(panel).not.toContainText('null');
    await panel.locator('button', { hasText: 'Debug' }).click();
    await expect(page.locator('#scene')).toHaveClass(/scene-debug/);
    await page.keyboard.press('Alt+p');
    await expect(panel).toBeHidden();
  });
});

test.describe('720p layout', () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test('setup picker fits on screen without scrolling', async ({ page, request }) => {
    await openScene(page, 'setup', 2);
    await phoneTap(request, '04112233445566');
    await expect(scene(page)).toContainText('New badge!');
    for (const sel of ['.animal-grid', '.swatches', 'button:has-text("Save")', '.count-pill']) {
      const box = await page.locator(sel).boundingBox();
      expect(box.y, sel).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height, sel).toBeLessThanOrEqual(720);
      expect(box.x + box.width, sel).toBeLessThanOrEqual(1280);
    }
  });
});

test('no page errors across scenes', async ({ page, request }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await openScene(page, 'setup', 2);
  for (const key of ['Alt+2', 'Alt+0', 'Alt+1']) {
    await page.keyboard.press(key);
    await phoneTap(request, PENGUIN.canonical_id);
    await phoneTap(request, 'DEADBEEF');
  }
  await page.waitForTimeout(300);
  expect(errors).toEqual([]);
});
