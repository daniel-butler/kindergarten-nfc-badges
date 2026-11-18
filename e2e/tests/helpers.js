const { expect } = require('@playwright/test');

const PENGUIN = { canonical_id: '04A1B2C3D4E5F6', emoji: '🐧', label: 'Penguin', color: { hex: '#1E5BD8', name: 'Blue' } };
const LION = { canonical_id: '04AABBCCDDEEFF', emoji: '🦁', label: 'Lion', color: { hex: '#FDD835', name: 'Yellow' } };
const FOX_TRICK = { canonical_id: '04CAFEF00DBEEF', emoji: '🦊', label: 'Fox', color: { hex: '#E53935', name: 'Red' }, trick: true };

/** n distinct cards whose 4-byte prefixes/suffixes never collide. */
function manyCards(n) {
  return Array.from({ length: n }, (_, i) => {
    const b = (i + 16).toString(16).toUpperCase();
    return { canonical_id: `04${b.repeat(6)}`, emoji: '🐶', label: `Dog ${i + 1}`, color: { hex: '#1E5BD8', name: 'Blue' }, trick: i % 9 === 8 };
  });
}

/** A real 1×1 PNG. */
const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

async function uploadImage(request, id, body = PNG_1PX, contentType = 'image/png') {
  return request.put(`/api/cards/${id}/image`, { data: body, headers: { 'content-type': contentType } });
}

const spoken = (page) => page.evaluate(() => window.Badge.voice.history);

async function setCards(request, cards) {
  const res = await request.put('/api/cards', { data: cards });
  expect(res.status(), await res.text()).toBe(200);
  return res.json();
}

async function getCards(request) {
  return (await request.get('/api/cards')).json();
}

async function phoneTap(request, id) {
  const res = await request.post('/tap', { data: { id, source: 'phone' } });
  expect(res.ok()).toBeTruthy();
  return res.json();
}

async function setLinkMode(request, enabled) {
  await request.put('/api/link-mode', { data: { enabled } });
}

/** Open the page on a scene, dismiss the start overlay, and wait for SSE + cards. */
async function openScene(page, scene, expectedCards) {
  await page.goto(`/#${scene}`);
  await page.locator('#start').click();
  await expect(page.locator('#start')).toBeHidden();
  await page.waitForFunction(() => window.Badge.connected);
  if (expectedCards !== undefined) {
    await page.waitForFunction((n) => window.Badge.cards.length === n, expectedCards);
  }
}

/** Full page reload (same-URL goto would only be a hash navigation). */
async function reloadPage(page, expectedCards) {
  await page.reload();
  await page.locator('#start').click();
  await page.waitForFunction((n) => window.Badge.connected && window.Badge.cards.length === n, expectedCards);
}

/** Type like the USB keyboard-wedge reader: fast keystrokes then Enter. */
async function readerScan(page, id) {
  await page.keyboard.type(id, { delay: 5 });
  await page.keyboard.press('Enter');
}

async function humanType(page, id) {
  await page.keyboard.type(id, { delay: 150 });
  await page.keyboard.press('Enter');
}

const scene = (page) => page.locator('#scene');

/** Debug-log rows for real taps (not notes). */
const tapRows = (page, source) => scene(page).locator('tr', { hasText: source === 'phone' ? '📱 phone' : '⌨️ reader' });

module.exports = { PNG_1PX, uploadImage, reloadPage, PENGUIN, LION, FOX_TRICK, manyCards, spoken, setCards, getCards, phoneTap, setLinkMode, openScene, readerScan, humanType, scene, tapRows };
