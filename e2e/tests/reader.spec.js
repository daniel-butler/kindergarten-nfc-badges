const { test, expect } = require('@playwright/test');
const { PENGUIN, setCards, openScene, readerScan, humanType, scene } = require('./helpers');

test.beforeEach(async ({ page, request }) => {
  await setCards(request, [PENGUIN]);
  await openScene(page, 'free', 1);
});

test('fast keyboard-wedge input becomes a reader tap', async ({ page }) => {
  await readerScan(page, 'c3b2a104');
  await expect(scene(page)).toContainText('Penguin');
  await page.keyboard.press('Alt+0');
  await expect(scene(page)).toContainText('⌨️ reader');
  await expect(scene(page)).toContainText('C3B2A104');
});

test('slow human typing is ignored unless typing test mode is on', async ({ page }) => {
  await humanType(page, '04a1b2c3');
  await expect(scene(page)).toContainText('Tap your badge!');

  await page.keyboard.press('Alt+t');
  await expect(page.locator('#banner')).toContainText('test mode ON');
  await humanType(page, '04a1b2c3');
  await expect(scene(page)).toContainText('Penguin');

  await page.keyboard.press('Alt+t');
  await page.keyboard.press('Alt+0');
  await expect(scene(page)).toContainText('ignored slow typing');
});

test('non-hex and too-short input never reach the server', async ({ page }) => {
  await readerScan(page, '04a1zzb2c3d4');
  await readerScan(page, '04a1');
  await page.keyboard.press('Alt+0');
  await expect(scene(page)).toContainText('non-hex');
  await expect(scene(page)).toContainText('too short');
  await expect(scene(page).locator('td', { hasText: '📱' }).or(scene(page).locator('td', { hasText: '⌨️' }))).toHaveCount(0);
});

test('a stray slow keypress before a scan does not corrupt the scan', async ({ page }) => {
  await page.keyboard.press('7');
  await page.waitForTimeout(200);
  await readerScan(page, '04A1B2C3D4E5F6');
  await expect(scene(page)).toContainText('Penguin');
});

test('reader digits do not switch scenes; Option+digit does', async ({ page }) => {
  await readerScan(page, '1010101010');
  await expect(page.locator('#scene')).toHaveClass(/scene-free/);
  await page.keyboard.press('Alt+1');
  await expect(page.locator('#scene')).toHaveClass(/scene-setup/);
  await page.keyboard.press('Alt+2');
  await expect(page.locator('#scene')).toHaveClass(/scene-free/);
});

test('page keeps keyboard focus after clicks', async ({ page }) => {
  await page.keyboard.press('Alt+p');
  await page.locator('#panel button', { hasText: 'Chime' }).click();
  await page.keyboard.press('Alt+p');
  await page.mouse.click(50, 500);
  await expect(page.locator('#wedge')).toBeFocused();
  await readerScan(page, '04A1B2C3D4E5F6');
  await expect(scene(page)).toContainText('Penguin');
});
