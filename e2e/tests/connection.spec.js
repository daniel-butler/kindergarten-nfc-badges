// The projector page's live connection to the server, through a relay the test can cut, so a
// network blip, a sleeping Mac or a restarted server can be replayed. Runs in Chrome and Firefox.
const net = require('node:net');
const { test, expect } = require('@playwright/test');
const { PENGUIN, LION, setCards, phoneTap, command, logLines } = require('./helpers');

const SERVER_PORT = 8181;

/** A TCP relay in front of the server: `cut()` drops every open connection, `down()` refuses new ones. */
function relay() {
  const sockets = new Set();
  let refusing = false;
  const server = net.createServer((client) => {
    if (refusing) return client.destroy();
    const upstream = net.connect(SERVER_PORT, '127.0.0.1');
    for (const s of [client, upstream]) {
      sockets.add(s);
      s.on('close', () => sockets.delete(s));
      s.on('error', () => {});
    }
    client.pipe(upstream).pipe(client);
    client.on('close', () => upstream.destroy());
    upstream.on('close', () => client.destroy());
  });
  return {
    start: () => new Promise((ok) => server.listen(0, '127.0.0.1', () => ok(server.address().port))),
    cut: () => sockets.forEach((s) => s.destroy()),
    down() { refusing = true; this.cut(); },
    up() { refusing = false; },
    stop: () => new Promise((ok) => { sockets.forEach((s) => s.destroy()); server.close(ok); }),
  };
}

const connected = (page) => page.evaluate(() => window.Badge.connected);
const tally = (page, n) => page.locator(`.zoo-tally[data-count="${n}"]`);

let r;
let base;

test.beforeEach(async ({ request }) => {
  await setCards(request, [PENGUIN, LION]);
  await command(request, 'reset');
  r = relay();
  base = `http://localhost:${await r.start()}`;
});

test.afterEach(async () => {
  await r.stop();
});

async function openZoo(page) {
  await page.goto(`${base}/#zoo`);
  await page.locator('#start').click();
  await expect.poll(() => connected(page)).toBe(true);
}

/** After an outage the page is live again: no banner, and a tap made now reaches the zoo. */
async function liveAgain(page, request) {
  await expect.poll(() => connected(page), { timeout: 20000 }).toBe(true);
  await expect(page.getByText('Reconnecting to server')).toBeHidden();
  await phoneTap(request, PENGUIN.canonical_id);
  await expect(tally(page, 1)).toBeVisible({ timeout: 10000 });
}

test('the live connection drops and the server is right there: the page reconnects', async ({ page, request }) => {
  await openZoo(page);
  r.cut();
  await liveAgain(page, request);
});

test('the server is unreachable for 10 seconds, then back: the page reconnects by itself', async ({ page, request }) => {
  await openZoo(page);
  r.down();
  await expect.poll(() => connected(page), { timeout: 10000 }).toBe(false);
  await expect(page.locator('#banner')).toContainText('Reconnecting');
  await page.waitForTimeout(10000);
  r.up();
  await liveAgain(page, request);
});

test('a reconnect gets a bad answer and the browser gives up: the page still comes back', async ({ page, request }) => {
  await openZoo(page);
  let refuseOnce = true;
  await page.route('**/events', (route) => {
    if (refuseOnce) {
      refuseOnce = false;
      return route.fulfill({ status: 503, body: 'busy' }); // EventSource treats a non-200 as final
    }
    return route.continue();
  });
  r.cut();
  await liveAgain(page, request);
  expect(logLines().some((l) => /\[page\] \S+ lost connection to server \(closed\)/.test(l))).toBe(true);
});

test('taps during the outage are not lost: the zoo catches up when the page reconnects', async ({ page, request }) => {
  await openZoo(page);
  r.down();
  await expect.poll(() => connected(page), { timeout: 10000 }).toBe(false);
  await phoneTap(request, LION.canonical_id); // the phone still reaches the server directly
  r.up();
  await expect.poll(() => connected(page), { timeout: 20000 }).toBe(true);
  await expect(tally(page, 1)).toBeVisible({ timeout: 10000 });
});
