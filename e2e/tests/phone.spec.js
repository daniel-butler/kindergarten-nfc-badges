// Phone + page together: Zoo Tap runs in the iOS simulator (XCUITest presses its real buttons)
// against the same server as the projector page. Needs Xcode; run with `npm run test:phone`.
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { test, expect } = require('@playwright/test');
const { PENGUIN, FOX_TRICK, STAR_SPECIAL, getCards, command, setCards, phoneTap, openScene } = require('./helpers');

const run = promisify(execFile);
const IOS = path.resolve(__dirname, '../../ios');
const DERIVED = path.resolve(__dirname, '../.ios-build');
const SERVER = 'http://localhost:8181';

test.skip(!process.env.BADGE_PHONE_E2E, 'needs Xcode and an iOS simulator: npm run test:phone');
test.describe.configure({ timeout: 240_000 });

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
    const failures = out.split('\n').filter((l) => /error|failed|XCTAssert/i.test(l)).slice(-25).join('\n');
    throw new Error(`xcodebuild ${args[0]} failed:\n${failures || out.slice(-4000)}`);
  }
}

/** Runs one ClassroomZooUITests method in the simulator; it fails this test if the phone side fails. */
function phone(method, { tags = [], expect: shown = '' } = {}) {
  return xcodebuild(['test-without-building', `-only-testing:ClassroomZooUITests/ClassroomZooUITests/${method}`], {
    TEST_RUNNER_BADGE_SERVER: SERVER,
    TEST_RUNNER_ZOO_FAKE_TAGS: tags.join(','),
    TEST_RUNNER_PHONE_EXPECT: shown,
  });
}

const tally = (page, n) => page.locator(`.zoo-tally[data-count="${n}"]`);
const inside = (page) => page.evaluate(() => window.Badge.current.state().inside);

test.beforeAll(async () => {
  test.setTimeout(900_000);
  destination = `platform=iOS Simulator,id=${await simulator()}`;
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
  await expect(page.locator('.zoo-goose')).toBeVisible();
  await expect(tally(page, 0)).toBeVisible();
});

test('Allow special from the phone opens the Zoo List; the special then starts the party', async ({ page, request }) => {
  await openScene(page, 'zoo', 3);
  await phoneTap(request, STAR_SPECIAL.canonical_id);
  await expect(page.locator('.zoo-special-denied')).toBeVisible();
  await phone('testPresenterAllowsSpecial', { expect: 'Star' });
  await expect(page.locator(`.zoo-list-new[data-id="${STAR_SPECIAL.canonical_id}"]`)).toBeVisible();
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
