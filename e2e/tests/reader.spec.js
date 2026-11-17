const { test, expect } = require('@playwright/test');
const { PENGUIN, setCards, openScene, readerScan, humanType, scene, tapRows } = require('./helpers');

test.beforeEach(async ({ page, request }) => {
  await setCards(request, [PENGUIN]);
  await openScene(page, 'debug', 1);
});

test('fast keyboard-wedge input becomes a reader tap', async ({ page }) => {
  await readerScan(page, 'c3b2a104');
  const row = tapRows(page, 'reader');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('C3B2A104');
  await expect(row).toContainText('Penguin');
});

test('slow human typing is ignored unless typing test mode is on', async ({ page }) => {
  await humanType(page, '04a1b2c3');
  await expect(scene(page)).toContainText('ignored slow typing');
  await expect(tapRows(page, 'reader')).toHaveCount(0);

  await page.keyboard.press('Alt+t');
  await expect(page.locator('#banner')).toContainText('test mode ON');
  await humanType(page, '04a1b2c3');
  await expect(tapRows(page, 'reader')).toContainText('Penguin');
  await page.keyboard.press('Alt+t');
});

test('non-hex and too-short input never reach the server', async ({ page }) => {
  await readerScan(page, '04a1zzb2c3d4');
  await readerScan(page, '04a1');
  await expect(scene(page)).toContainText('non-hex');
  await expect(scene(page)).toContainText('too short');
  await expect(tapRows(page, 'reader')).toHaveCount(0);
});

test('a stray slow keypress before a scan does not corrupt the scan', async ({ page }) => {
  await page.keyboard.press('7');
  await page.waitForTimeout(200);
  await readerScan(page, '04A1B2C3D4E5F6');
  await expect(tapRows(page, 'reader')).toContainText('Penguin');
});

test('reader digits do not switch scenes; Option+digit does', async ({ page }) => {
  await readerScan(page, '1212121212');
  await expect(page.locator('#scene')).toHaveClass(/scene-debug/);
  await page.keyboard.press('Alt+1');
  await expect(page.locator('#scene')).toHaveClass(/scene-setup/);
  await page.keyboard.press('Alt+2');
  await expect(page.locator('#scene')).toHaveClass(/scene-secret/);
});

test('page keeps keyboard focus after clicks', async ({ page }) => {
  await page.keyboard.press('Alt+p');
  await page.locator('#panel button', { hasText: 'Chime' }).click();
  await page.keyboard.press('Alt+p');
  await page.mouse.click(50, 500);
  await expect(page.locator('#wedge')).toBeFocused();
  await readerScan(page, '04A1B2C3D4E5F6');
  await expect(tapRows(page, 'reader')).toContainText('Penguin');
});
