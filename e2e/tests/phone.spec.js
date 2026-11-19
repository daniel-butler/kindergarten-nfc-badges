// Phone + page together: Zookeeper runs in the iOS simulator (XCUITest presses its real buttons)
// against the same server as the projector page. Needs Xcode; run with `npm run test:phone`.
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { test, expect } = require('@playwright/test');
const { PENGUIN, FOX_TRICK, STAR_SPECIAL, getCards, command, setCards, phoneTap, openScene, logLines, relay } = require('./helpers');

const run = promisify(execFile);
const IOS = path.resolve(__dirname, '../../ios');
const DERIVED = path.resolve(__dirname, '../.ios-build');
const SERVER = 'http://localhost:8181';

test.skip(!process.env.BADGE_PHONE_E2E, 'needs Xcode and an iOS simulator: npm run test:phone');
test.describe.configure({ timeout: 360_000 });

/** BADGE_SIM, else a booted iPhone simulator, else the first available one. */
async function simulator() {
  if (process.env.BADGE_SIM) return process.env.BADGE_SIM;
  const { stdout } = await run('xcrun', ['simctl', 'list', 'devices', 'available', '-j']);
  const phones = Object.values(JSON.parse(stdout).devices).flat().filter((d) => d.name.startsWith('iPhone'));
  const pick = phones.find((d) => d.state === 'Booted') ?? phones[0];
  if (!pick) throw new Error('No iPhone simulator available');
  return pick.udid;
}

let destination;

async function xcodebuild(args, env = {}) {
  const all = ['-project', path.join(IOS, 'ClassroomZoo.xcodeproj'), '-scheme', 'ClassroomZoo',
    '-destination', destination, '-derivedDataPath', DERIVED, 'CODE_SIGNING_ALLOWED=NO', ...args];
  try {
    await run('xcodebuild', all, { env: { ...process.env, ...env }, maxBuffer: 64 * 1024 * 1024 });
  } catch (e) {
    const out = `${e.stdout ?? ''}\n${e.stderr ?? ''}`;
    const lines = out.split('\n');
    // The Swift assertion line says what went wrong; simulator log noise also says "failed".
    const asserts = lines.filter((l) => /\.swift:\d+: error/.test(l));
    const failures = (asserts.length ? asserts : lines.filter((l) => /error|failed|XCTAssert/i.test(l)).slice(-25)).join('\n');
    throw new Error(`xcodebuild ${args[0]} failed:\n${failures || out.slice(-4000)}`);
  }
}

/** Runs one ClassroomZooUITests method in the simulator; it fails this test if the phone side fails. */
async function phone(method, { tags = [], expect: shown = '', server = SERVER } = {}) {
  const args = ['test-without-building', `-only-testing:ClassroomZooUITests/ClassroomZooUITests/${method}`];
  const env = { TEST_RUNNER_BADGE_SERVER: server, TEST_RUNNER_ZOO_FAKE_TAGS: tags.join(','), TEST_RUNNER_PHONE_EXPECT: shown };
  try {
    await xcodebuild(args, env);
  } catch (e) {
    // The simulator sometimes drops the test runner before it starts; that says nothing about the app.
    if (!/never finished bootstrapping/.test(e.message)) throw e;
    await xcodebuild(args, env);
  }
}

const tally = (page, n) => page.locator(`.zoo-tally[data-count="${n}"]`);
const zooState = (page) => page.evaluate(() => window.Badge.current.state());
const inside = async (page) => (await zooState(page)).inside;

test.beforeAll(async () => {
  test.setTimeout(900_000);
  const id = await simulator();
  destination = `platform=iOS Simulator,id=${id}`;
  // A cold simulator can drop the first test runner while it boots, so boot it fully first.
  await run('xcrun', ['simctl', 'bootstatus', id, '-b']);
  await xcodebuild(['build-for-testing']);
});

test.beforeEach(async ({ request }) => {
  await setCards(request, [PENGUIN, FOX_TRICK, STAR_SPECIAL]);
  await command(request, 'reset');
});

test('a badge read by the phone walks into the zoo on the projector', async ({ page }) => {
  await openScene(page, 'zoo', 3);
  await phone('testCheckInSendsTaps', { tags: [PENGUIN.canonical_id], expect: '🐧 Penguin' });
  await expect(tally(page, 1)).toBeVisible();
  // The phone's side of the story is in the shared log too.
  const phoneLines = logLines().filter((l) => l.includes('[phone]'));
  expect(phoneLines.some((l) => /app active/.test(l))).toBe(true);
  expect(phoneLines.some((l) => new RegExp(`badge read ${PENGUIN.canonical_id}`).test(l))).toBe(true);
  expect(phoneLines.some((l) => /screen stays awake on Check in/.test(l))).toBe(true);
  await expect.poll(() => inside(page), { timeout: 15000 }).toContain(PENGUIN.canonical_id);
});

test('the phone sees the waiting trick badge and Let in admits it', async ({ page, request }) => {
  await openScene(page, 'zoo', 3);
  await phoneTap(request, FOX_TRICK.canonical_id);
  await expect(page.locator('.zoo-vote')).toBeVisible();
  await page.waitForTimeout(1100); // a vote needs a moment on screen before a decision counts
  await phone('testPresenterLetsInTrick', { expect: 'Fox' });
  await expect(page.locator('.zoo-vote')).toHaveCount(0);
  await expect(tally(page, 1)).toBeVisible();
});

test('Keep out from the phone sends the trick badge away with the goose', async ({ page, request }) => {
  await openScene(page, 'zoo', 3);
  await phoneTap(request, FOX_TRICK.canonical_id);
  await expect(page.locator('.zoo-vote')).toBeVisible();
  await page.waitForTimeout(1100);
  await phone('testPresenterKeepsOutTrick');
  await expect(page.locator('.zoo-vote')).toHaveCount(0);
  await expect(tally(page, 0)).toBeVisible();
  await expect.poll(async () => (await zooState(page)).inside).toEqual([]);
  // Kept out isn't final: the badge's next tap gets a new vote.
  await phoneTap(request, FOX_TRICK.canonical_id);
  await expect(page.locator('.zoo-vote')).toBeVisible({ timeout: 15000 });
  expect((await zooState(page)).pendingVote).toBe(FOX_TRICK.canonical_id);
});

test('Allow special from the phone opens the Zoo List; the special then starts the party', async ({ page, request }) => {
  await openScene(page, 'zoo', 3);
  await phoneTap(request, STAR_SPECIAL.canonical_id);
  await expect.poll(async () => (await zooState(page)).specialDenied).toBe(true);
  await phone('testPresenterAllowsSpecial', { expect: 'Star' });
  // The list waits for the goose's clipboard (and any gate moment before it); slow on CI's software 3D.
  await expect(page.locator(`.zoo-list-new[data-id="${STAR_SPECIAL.canonical_id}"]`)).toBeVisible({ timeout: 20000 });
  await page.waitForTimeout(1600); // same badge again within 1.5 s is ignored as a repeat
  await phoneTap(request, STAR_SPECIAL.canonical_id);
  await expect(page.locator('.zoo3d-finale')).toContainText('Congratulations, Official Zookeepers!', { timeout: 20000 });
});

test('Reset from the phone empties the zoo', async ({ page, request }) => {
  await openScene(page, 'zoo', 3);
  await phoneTap(request, PENGUIN.canonical_id);
  await expect(tally(page, 1)).toBeVisible();
  await phone('testPresenterResets');
  await expect(tally(page, 0)).toBeVisible();
  expect(await inside(page)).toEqual([]);
});

test('Not here today on the phone reaches the projector page', async ({ page, request }) => {
  await openScene(page, 'list', 3);
  await phone('testRegisterMarksAway', { tags: [PENGUIN.canonical_id], expect: 'Penguin' });
  await expect.poll(async () => (await getCards(request)).find((c) => c.label === 'Penguin').away).toBe(true);
  await expect.poll(() => page.evaluate(() => window.Badge.cards.find((c) => c.label === 'Penguin').away)).toBe(true);
});

test('the app shows it is connected to the Mac', async () => {
  await phone('testShowsConnectedToTheMac');
});

test('reopening the app with the Mac unreachable: it says so, and Reconnect gets it back', async () => {
  const r = relay();
  const port = await r.start();
  r.down();
  const running = phone('testReconnectsWhenTheMacComesBack', { server: `http://localhost:${port}` });
  try {
    // The Mac comes back only once the app has tried it (launching the app can take a while on CI),
    // with time for the app to show that it can't reach it.
    await expect.poll(() => r.refused, { timeout: 120000 }).toBeGreaterThan(0);
    await new Promise((ok) => setTimeout(ok, 5000));
    r.up();
    await running;
  } finally {
    await r.stop();
  }
  expect(logLines().some((l) => /\[phone\] \S+ can't reach the Mac/.test(l))).toBe(true);
  expect(logLines().some((l) => /\[phone\] \S+ connected to the Mac/.test(l))).toBe(true);
});

test("the app's log can be read, copied and shared on the phone", async () => {
  await phone('testLogsCanBeCopied');
});

test('scanning a trick badge on Check in: Let in right there, and it walks into the zoo', async ({ page }) => {
  await openScene(page, 'zoo', 3);
  await phone('testCheckInDecidesTrick', { tags: [FOX_TRICK.canonical_id], expect: 'Fox' });
  await expect(tally(page, 1)).toBeVisible({ timeout: 10000 });
  await expect.poll(() => inside(page), { timeout: 20000 }).toContain(FOX_TRICK.canonical_id);
});

test('scanning the special badge on Check in: Allow right there, and its next tap starts the party', async ({ page, request }) => {
  await openScene(page, 'zoo', 3);
  await phone('testCheckInAllowsSpecial', { tags: [STAR_SPECIAL.canonical_id], expect: 'Star' });
  await expect(page.locator(`.zoo-list-new[data-id="${STAR_SPECIAL.canonical_id}"]`)).toBeVisible({ timeout: 20000 });
  await page.waitForTimeout(1600);
  await phoneTap(request, STAR_SPECIAL.canonical_id);
  await expect(page.locator('.zoo3d-finale')).toContainText('Congratulations, Official Zookeepers!', { timeout: 20000 });
});
