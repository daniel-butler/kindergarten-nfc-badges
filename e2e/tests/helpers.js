const { expect } = require('@playwright/test');

const PENGUIN = { canonical_id: '04A1B2C3D4E5F6', emoji: '🐧', label: 'Penguin', color: '#1E5BD8' };
const LION = { canonical_id: '04AABBCCDDEEFF', emoji: '🦁', label: 'Lion', color: '#FDD835' };

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

module.exports = { PENGUIN, LION, setCards, getCards, phoneTap, setLinkMode, openScene, readerScan, humanType, scene };
