const { test, expect } = require('@playwright/test');
const { FOX_TRICK, command, PENGUIN, LION, setCards, getCards, phoneTap, setLinkMode, openScene, readerScan, scene } = require('./helpers');

test.beforeEach(async ({ request }) => {
  await setLinkMode(request, false);
  await setCards(request, [PENGUIN, LION]);
});

test.describe('Secret Number', () => {
  test('reveals the raw id digit by digit, for known and unknown badges', async ({ page, request }) => {
    await openScene(page, 'secret', 2);
    await expect(scene(page)).toContainText('secret number');
    await phoneTap(request, 'DEADBEEF');
    await expect(scene(page).locator('.digit')).toHaveCount(8);
    await expect(scene(page).locator('.digit.hidden')).not.toHaveCount(0);
    await expect(scene(page).locator('.digit.hidden')).toHaveCount(0, { timeout: 10000 });
    await expect(scene(page).locator('.digits')).toHaveText('DEADBEEF');

    await phoneTap(request, PENGUIN.canonical_id);
    await expect(scene(page).locator('.digits')).toHaveText('04A1B2C3D4E5F6', { timeout: 10000 });
  });

  test('shows the raw id as the reader typed it', async ({ page }) => {
    await openScene(page, 'secret', 2);
    await readerScan(page, 'c3b2a104');
    await expect(scene(page).locator('.digits')).toHaveText('C3B2A104', { timeout: 10000 });
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
    expect(fox).toMatchObject({ emoji: '🦊', label: 'Fox', color: { hex: '#FB8C00', name: 'Orange' }, role: 'normal' });
  });

  test('known badge can be changed and deleted', async ({ page, request }) => {
    await openScene(page, 'setup', 2);
    await phoneTap(request, LION.canonical_id);
    await expect(scene(page)).toContainText('Already registered');
    await expect(scene(page)).toContainText('Lion · Yellow');
    await expect(scene(page).locator('.badge-circle')).toHaveCSS('background-color', 'rgb(253, 216, 53)');
    await page.locator('button', { hasText: 'Change' }).click();
    await page.locator('button.swatch[title=Purple]').click();
    await page.locator('button', { hasText: 'Save' }).click();
    await expect(scene(page)).toContainText('Saved');
    expect((await getCards(request)).find((c) => c.label === 'Lion').color).toEqual({ hex: '#8E24AA', name: 'Purple' });

    await page.locator('button', { hasText: 'Done' }).click();
    await page.locator('.mini-card[title=Lion]').click();
    await page.locator('button', { hasText: 'Delete' }).click();
    await expect(scene(page)).toContainText('1 badge registered');
    expect(await getCards(request)).toHaveLength(1);
  });

  test('Setup sets a badge to trick or special', async ({ page, request }) => {
    await openScene(page, 'setup', 2);
    await page.locator('.mini-card[title=Penguin]').click();
    await expect(page.locator('button.role[data-role=normal]')).toHaveClass(/selected/);
    await page.locator('button.animal[title=Owl]').click();
    await page.locator('button.role[data-role=trick]').click();
    await page.locator('button', { hasText: 'Save' }).click();
    await expect(scene(page)).toContainText('trick badge');
    await page.locator('button', { hasText: 'Done' }).click();
    await expect(page.locator('.mini-card.role-trick')).toHaveCount(1);
    await expect(page.locator('.count-pill')).toContainText('1 🎭');
    const owl = (await getCards(request)).find((c) => c.canonical_id === PENGUIN.canonical_id);
    expect(owl).toMatchObject({ emoji: '🦉', label: 'Owl', role: 'trick', color: { name: 'Blue' } });

    await page.locator('.mini-card[title=Owl]').click();
    await page.locator('button.role[data-role=special]').click();
    await page.locator('button', { hasText: 'Save' }).click();
    await expect(scene(page)).toContainText('golden badge');
    await page.locator('button', { hasText: 'Done' }).click();
    await expect(page.locator('.mini-card.role-special')).toHaveCount(1);
    await expect(page.locator('.count-pill')).toContainText('1 ⭐');
    expect((await getCards(request)).find((c) => c.canonical_id === PENGUIN.canonical_id).role).toBe('special');
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

  test('the panel is readable over a kid scene: light text on its dark background', async ({ page }) => {
    await openScene(page, 'list');
    await page.keyboard.press('Alt+p');
    const contrast = await page.evaluate(() => {
      const lum = (rgb) => {
        const [r, g, b] = rgb.match(/\d+/g).slice(0, 3).map((v) => {
          const c = v / 255;
          return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      const ratio = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
      const buttons = [...document.querySelectorAll('#panel button:not(.active)')];
      return Math.min(...buttons.map((b) => ratio(getComputedStyle(b).color, getComputedStyle(b).backgroundColor)));
    });
    expect(contrast).toBeGreaterThan(4.5);
  });

  test('the panel shows which version of the server is running', async ({ page, request }) => {
    const { version } = await (await request.get('/api/version')).json();
    expect(version).toMatch(/^([0-9a-f]{7,}|unknown)/);
    await openScene(page, 'zoo');
    await page.keyboard.press('Alt+p');
    await expect(page.locator('#panel')).toContainText(`Version ${version}`);
  });

  test('the panel asks for the version each time it opens (a restarted server has a new one)', async ({ page }) => {
    let n = 0;
    await page.route('**/api/version', (route) => {
      n += 1;
      return route.fulfill({ json: { version: n === 1 ? 'aaaaaaa' : 'bbbbbbb', date: 'Nov 19 07:00' } });
    });
    await openScene(page, 'zoo');
    await page.keyboard.press('Alt+p');
    await expect(page.locator('#panel')).toContainText('Version aaaaaaa (Nov 19 07:00)');
    await page.keyboard.press('Alt+p');
    await page.keyboard.press('Alt+p');
    await expect(page.locator('#panel')).toContainText('Version bbbbbbb');
  });

  test('panel shows the last unknown badge and has the zoo command buttons', async ({ page, request }) => {
    await setCards(request, [PENGUIN, LION, FOX_TRICK]);
    await command(request, 'reset');
    await openScene(page, 'zoo', 3);
    await phoneTap(request, 'DEADBEEF');
    await page.keyboard.press('Alt+p');
    const panel = page.locator('#panel');
    await expect(panel).toContainText('Last unknown: DEADBEEF');
    for (const label of ['📋 Zoo List', '👍 Let in', '👎 Keep out', '⭐ Allow golden', '🔄 Reset the zoo']) {
      await expect(panel.locator('button', { hasText: label })).toHaveCount(1);
    }
    await page.waitForTimeout(1600);
    await phoneTap(request, FOX_TRICK.canonical_id);
    await expect(page.locator('.zoo-vote')).toBeVisible();
    await page.waitForTimeout(1100); // the class votes
    await panel.locator('button', { hasText: '👍 Let in' }).click();
    await expect(page.locator('.zoo-tally[data-count="1"]')).toBeVisible();
  });

  test("the panel's Reset needs a second click", async ({ page, request }) => {
    await setCards(request, [PENGUIN, LION]);
    await command(request, 'reset');
    await openScene(page, 'zoo', 2);
    await phoneTap(request, PENGUIN.canonical_id);
    await expect(page.locator('.zoo-tally[data-count="1"]')).toBeVisible();
    await page.keyboard.press('Alt+p');
    await page.locator('#panel button', { hasText: 'Reset the zoo' }).click();
    await page.waitForTimeout(500);
    await expect(page.locator('.zoo-tally[data-count="1"]')).toBeVisible();
    await page.locator('#panel button', { hasText: 'Click again to reset' }).click();
    await expect(page.locator('.zoo-tally[data-count="0"]')).toBeVisible();
  });

  test('panel lists scenes and switches between them', async ({ page }) => {
    await openScene(page, 'secret', 2);
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

  test('a full 14-digit secret number fits on one line', async ({ page, request }) => {
    await openScene(page, 'secret', 2);
    await phoneTap(request, PENGUIN.canonical_id);
    await expect(scene(page).locator('.digit.hidden')).toHaveCount(0, { timeout: 12000 });
    // Layout boxes, not getBoundingClientRect: the reveal's scale animation would skew those.
    const boxes = await scene(page).locator('.digit').evaluateAll((els) => els.map((e) => ({
      top: e.offsetTop, left: e.offsetLeft, right: e.offsetLeft + e.offsetWidth,
    })));
    expect(new Set(boxes.map((b) => Math.round(b.top))).size).toBe(1);
    expect(Math.min(...boxes.map((b) => b.left))).toBeGreaterThanOrEqual(0);
    expect(Math.max(...boxes.map((b) => b.right))).toBeLessThanOrEqual(1280);
  });
});

test('no page errors across scenes', async ({ page, request }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await openScene(page, 'setup', 2);
  for (const key of ['Alt+2', 'Alt+3', 'Alt+4', 'Alt+5', 'Alt+6', 'Alt+0', 'Alt+1']) {
    await page.keyboard.press(key);
    await phoneTap(request, PENGUIN.canonical_id);
    await phoneTap(request, 'DEADBEEF');
  }
  await page.waitForTimeout(300);
  expect(errors).toEqual([]);
});
