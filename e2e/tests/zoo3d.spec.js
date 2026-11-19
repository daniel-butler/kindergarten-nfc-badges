const { test, expect } = require('@playwright/test');
const {
  STAR_SPECIAL, getCards, PENGUIN, LION, FOX_TRICK, manyCards, command, setCards, phoneTap, openScene, reloadPage, scene, uploadImage,
  PNG_1PX,
} = require('./helpers');

const OWL_AWAY = { canonical_id: '04BEEFBEEFBEEF', emoji: '🦉', label: 'Owl', color: { hex: '#8D6E63', name: 'Brown' }, away: true };
const zooState = (page) => page.evaluate(() => window.Badge.current.state());
const inside = async (page) => (await zooState(page)).inside;
const tally = (page, n) => page.locator(`.zoo-tally[data-count="${n}"]`);
const gatekeeper = async (page) => (await zooState(page)).gatekeeper;
const spyBuzzer = (page) => page.evaluate(() => {
  window.__buzzes = 0;
  const original = window.Badge.sound.buzzer;
  window.Badge.sound.buzzer = () => { window.__buzzes++; original(); };
});
const resetKeys = async (page) => {
  await page.keyboard.press('Alt+r');
  await page.keyboard.press('Alt+r');
};

test.beforeEach(async ({ request }) => {
  await setCards(request, [PENGUIN, LION, FOX_TRICK, OWL_AWAY]);
  await command(request, 'reset');
});

test('zoo loads with no page errors and an empty tally', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await openScene(page, 'zoo', 4);
  await expect(tally(page, 0)).toBeVisible();
  await expect(page.locator('#scene canvas')).toBeVisible();
  await page.waitForTimeout(500);
  expect(errors).toEqual([]);
});

test('normal taps add tally marks at once and the animal goes inside', async ({ page, request }) => {
  await openScene(page, 'zoo', 4);
  await phoneTap(request, PENGUIN.canonical_id);
  await expect(tally(page, 1)).toBeVisible();
  await phoneTap(request, LION.canonical_id);
  await expect(tally(page, 2)).toBeVisible();
  await expect.poll(() => inside(page), { timeout: 15000 }).toEqual(expect.arrayContaining([PENGUIN.canonical_id, LION.canonical_id]));
  await expect(page.locator('.zoo-tally svg')).toHaveCount(1);
});

test('tally marks group in fives', async ({ page, request }) => {
  const cards = manyCards(7);
  await setCards(request, cards);
  await openScene(page, 'zoo', 7);
  for (const c of cards) await phoneTap(request, c.canonical_id);
  await expect(tally(page, 7)).toBeVisible();
  await expect(page.locator('.zoo-tally svg')).toHaveCount(2);
  await expect(page.locator('.zoo-tally svg').first().locator('line')).toHaveCount(5);
});

test('five quick taps all arrive', async ({ page, request }) => {
  const cards = manyCards(5);
  await setCards(request, cards);
  await openScene(page, 'zoo', 5);
  for (const c of cards) await phoneTap(request, c.canonical_id);
  await expect(tally(page, 5)).toBeVisible();
  await expect.poll(async () => (await inside(page)).length, { timeout: 25000 }).toBe(5);
});

test('unknown badge: gentle retry, no buzzer, nobody enters', async ({ page, request }) => {
  await openScene(page, 'zoo', 4);
  await spyBuzzer(page);
  await phoneTap(request, 'DEADBEEF');
  await expect.poll(() => gatekeeper(page)).toBe('puzzled'); // a blank card hops up; the goose tilts its head
  expect((await zooState(page)).visitor).toBe('?');
  await expect(page.locator('.zoo-oops')).toHaveText('Oops! Tap again 🔄');
  await expect(page.locator('.zoo-denied')).toHaveCount(0);
  expect(await page.evaluate(() => window.__buzzes)).toBe(0);
  expect(await zooState(page)).toMatchObject({ inside: [], queued: 0, finale: false, tally: 0 });
  await expect(page.locator('.zoo-oops')).toHaveCount(0, { timeout: 3000 });
});

test('tapping again when already inside: that animal runs to the gate and waves', async ({ page, request }) => {
  await openScene(page, 'zoo', 4);
  await phoneTap(request, PENGUIN.canonical_id);
  await expect.poll(async () => (await zooState(page)).queued + (await zooState(page)).inside.length, { timeout: 15000 }).toBe(1);
  await expect.poll(() => gatekeeper(page), { timeout: 15000 }).toBe('idle');
  await page.waitForTimeout(1600); // same badge within 1.5 s is a repeat
  await phoneTap(request, PENGUIN.canonical_id);
  await expect.poll(async () => (await zooState(page)).waving).toEqual([PENGUIN.canonical_id]);
  await expect.poll(async () => (await zooState(page)).waving, { timeout: 6000 }).toEqual([]);
  expect((await zooState(page)).tally).toBe(1);
});

test('the party: balloons rise and the goose dances before the title shows', async ({ page }) => {
  await openScene(page, 'zoo', 4);
  await page.keyboard.press('Alt+s');
  await expect.poll(async () => (await zooState(page)).models.balloons).toBeGreaterThan(0);
  expect((await zooState(page)).gatekeeper).toBe('dancing');
  await expect(page.locator('.zoo3d-finale')).toHaveCount(0);
  await expect(page.locator('.zoo3d-finale')).toContainText('Congratulations, Official Zookeepers!', { timeout: 10000 });
});

test('a new sticker photo arriving while that animal walks in: it still ends up playing, not stuck in the ground', async ({ page, request }) => {
  await openScene(page, 'zoo', 4);
  await phoneTap(request, PENGUIN.canonical_id);
  await expect.poll(async () => (await zooState(page)).queued).toBe(0); // walking in now
  await uploadImage(request, PENGUIN.canonical_id); // e.g. the photo is retaken (or cleaned) right now
  await expect.poll(() => inside(page), { timeout: 15000 }).toContain(PENGUIN.canonical_id);
  await page.waitForTimeout(1500);
  const heights = await page.evaluate(() => window.Badge.current.state().heights);
  expect(heights[PENGUIN.canonical_id]).toBeGreaterThan(1); // standing on the ground, not half under it
  expect((await zooState(page)).sprites).toBe(1);
});

test('the zoo goes calm when nobody taps for a while, and the next tap wakes it', async ({ page, request }) => {
  test.setTimeout(90000);
  await openScene(page, 'zoo', 4);
  await phoneTap(request, PENGUIN.canonical_id);
  await expect.poll(() => inside(page), { timeout: 15000 }).toContain(PENGUIN.canonical_id);
  expect((await zooState(page)).calm).toBe(false);
  await expect.poll(async () => (await zooState(page)).calm, { timeout: 25000 }).toBe(true);
  // Everyone strolls to the grass, then sits still while the presenter talks. How long the stroll
  // takes depends on the frame rate (slow on CI's software 3D), so wait for it to stop.
  const height = async () => (await zooState(page)).heights[PENGUIN.canonical_id];
  await expect.poll(async () => {
    const before = await height();
    await page.waitForTimeout(1000);
    return Math.abs((await height()) - before);
  }, { timeout: 30000 }).toBeLessThan(0.01);
  expect((await zooState(page)).calm).toBe(true);
  await phoneTap(request, LION.canonical_id);
  await expect.poll(async () => (await zooState(page)).calm).toBe(false);
});

test('a not-here-today kid who taps goes in and adds a mark', async ({ page, request }) => {
  await openScene(page, 'zoo', 4);
  await phoneTap(request, OWL_AWAY.canonical_id);
  await expect(tally(page, 1)).toBeVisible();
});

test('a not-here-today kid tapping during a rush leaves exactly one sticker per animal', async ({ page, request }) => {
  const cards = manyCards(3);
  await setCards(request, [...cards, OWL_AWAY]);
  await openScene(page, 'zoo', 4);
  for (const c of cards) await phoneTap(request, c.canonical_id);
  await phoneTap(request, OWL_AWAY.canonical_id); // clears away → cards event mid-queue
  await expect(tally(page, 4)).toBeVisible();
  await expect.poll(async () => (await inside(page)).length, { timeout: 30000 }).toBe(4);
  await page.waitForTimeout(500);
  expect((await zooState(page)).sprites).toBe(4);
});

test('everyone normal going in does not start the party by itself', async ({ page, request }) => {
  await setCards(request, [PENGUIN, LION]);
  await openScene(page, 'zoo', 2);
  await phoneTap(request, PENGUIN.canonical_id);
  await phoneTap(request, LION.canonical_id);
  await expect.poll(async () => (await inside(page)).length, { timeout: 15000 }).toBe(2);
  await page.waitForTimeout(3000);
  expect((await zooState(page)).finale).toBe(false);
});

test('the gatekeeper goose stands at the gate as a 3D model, with no padlock yet', async ({ page }) => {
  await openScene(page, 'zoo', 4);
  expect(await zooState(page)).toMatchObject({ models: { goose: true, padlock: false }, gatekeeper: 'idle', visitor: null });
});

test('Option+S starts the party', async ({ page }) => {
  await openScene(page, 'zoo', 4);
  await page.keyboard.press('Alt+s');
  await expect(page.locator('.zoo3d-finale')).toContainText('Congratulations, Official Zookeepers!', { timeout: 10000 });
});

test('the party command from the phone starts the party', async ({ page, request }) => {
  await openScene(page, 'zoo', 4);
  await command(request, 'party');
  await expect(page.locator('.zoo3d-finale')).toContainText('Congratulations, Official Zookeepers!', { timeout: 10000 });
});

test('Option+R twice resets tally, check-ins and party; once does nothing', async ({ page, request }) => {
  await openScene(page, 'zoo', 4);
  await phoneTap(request, PENGUIN.canonical_id);
  await expect(tally(page, 1)).toBeVisible();
  await page.keyboard.press('Alt+s');
  await expect(page.locator('.zoo3d-finale')).toBeVisible({ timeout: 10000 });
  await page.keyboard.press('Alt+r');
  await expect(page.locator('#banner')).toContainText('⌥R again');
  await expect(tally(page, 1)).toBeVisible();
  await page.keyboard.press('Alt+r');
  await expect(tally(page, 0)).toBeVisible();
  await expect(page.locator('.zoo3d-finale')).toHaveCount(0);
  expect(await zooState(page)).toMatchObject({ inside: [], finale: false, tally: 0 });
});

test('reset from the phone while another scene is showing still clears the zoo', async ({ page, request }) => {
  await openScene(page, 'zoo', 4);
  await phoneTap(request, PENGUIN.canonical_id);
  await expect(tally(page, 1)).toBeVisible();
  await page.keyboard.press('Alt+4');
  await command(request, 'reset');
  await page.waitForTimeout(300);
  await page.keyboard.press('Alt+3');
  await expect(tally(page, 0)).toBeVisible();
  expect(await inside(page)).toEqual([]);
});

test('scene commands from the phone switch scenes', async ({ page, request }) => {
  await openScene(page, 'zoo', 4);
  await command(request, 'scene-list');
  await expect(page.locator('#scene')).toHaveClass(/scene-list/);
  await command(request, 'scene-zoo');
  await expect(page.locator('#scene')).toHaveClass(/scene-zoo3d/);
});

test('check-ins and tally survive reload and are shared with the backup Zoo Gate', async ({ page, request }) => {
  await openScene(page, 'zoo', 4);
  await phoneTap(request, PENGUIN.canonical_id);
  await expect(tally(page, 1)).toBeVisible();
  await reloadPage(page, 4);
  await expect(tally(page, 1)).toBeVisible();
  expect(await inside(page)).toContain(PENGUIN.canonical_id);
  await page.keyboard.press('Alt+6');
  await expect(page.locator('#scene')).toHaveClass(/scene-gate/);
  await expect(tally(page, 1)).toBeVisible();
});

test.describe('trick badge votes', () => {
  test('the trick badge walks up to the gate and the goose looks it over before the vote card shows', async ({ page, request }) => {
    await openScene(page, 'zoo', 4);
    await phoneTap(request, FOX_TRICK.canonical_id);
    await expect.poll(() => gatekeeper(page)).toBe('curious');
    expect(await zooState(page)).toMatchObject({ visitor: FOX_TRICK.canonical_id, pendingVote: FOX_TRICK.canonical_id });
    await expect(page.locator('.zoo-vote')).toHaveCount(0);
    await expect(page.locator('.zoo-vote')).toBeVisible();
    expect(await gatekeeper(page)).toBe('curious'); // the fox waits at the gate during the vote
  });

  test('Let in pressed before the vote card shows does nothing', async ({ page, request }) => {
    await openScene(page, 'zoo', 4);
    await phoneTap(request, FOX_TRICK.canonical_id);
    await expect.poll(() => gatekeeper(page)).toBe('curious');
    await page.keyboard.press('Alt+y');
    await expect(page.locator('.zoo-vote')).toBeVisible();
    expect(await zooState(page)).toMatchObject({ pendingVote: FOX_TRICK.canonical_id, tally: 0 });
  });

  test('a trick badge shows the vote with its stored animal; nobody goes in yet', async ({ page, request }) => {
    await openScene(page, 'zoo', 4);
    await phoneTap(request, FOX_TRICK.canonical_id);
    const vote = page.locator('.zoo-vote');
    await expect(vote).toBeVisible();
    await expect(vote).toContainText('🦊');
    await expect(vote.locator('.vote-question')).toHaveText('?');
    await expect(vote.locator('.vote-yes')).toHaveText('👍 Let in');
    await expect(vote.locator('.vote-no')).toHaveText('👎 Keep out');
    expect(await zooState(page)).toMatchObject({ pendingVote: FOX_TRICK.canonical_id, tally: 0, inside: [] });
  });

  test('Option+Y lets it in: it enters with a tally mark', async ({ page, request }) => {
    await openScene(page, 'zoo', 4);
    await phoneTap(request, FOX_TRICK.canonical_id);
    await expect(page.locator('.zoo-vote')).toBeVisible();
    await page.waitForTimeout(1100); // the class votes
    await page.keyboard.press('Alt+y');
    await expect(page.locator('.zoo-vote')).toHaveCount(0);
    await expect(tally(page, 1)).toBeVisible();
    await expect.poll(() => inside(page), { timeout: 15000 }).toContain(FOX_TRICK.canonical_id);
    await phoneTap(request, PENGUIN.canonical_id);
    await phoneTap(request, FOX_TRICK.canonical_id); // already in: no second vote
    await page.waitForTimeout(300);
    await expect(page.locator('.zoo-vote')).toHaveCount(0);
  });

  test('Option+N keeps it out: goose bye-bye, no entry, no mark; its next tap gets a new vote', async ({ page, request }) => {
    await openScene(page, 'zoo', 4);
    await phoneTap(request, FOX_TRICK.canonical_id);
    await expect(page.locator('.zoo-vote')).toBeVisible();
    await page.waitForTimeout(1100); // the class votes
    await page.keyboard.press('Alt+n');
    await expect(page.locator('.zoo-vote')).toHaveCount(0);
    await expect.poll(() => gatekeeper(page)).toBe('bye');
    expect((await zooState(page)).visitor).toBe(FOX_TRICK.canonical_id);
    await expect(page.locator('.zoo-goose')).toHaveCount(0); // the 3D goose, not the flat one
    await expect(tally(page, 0)).toBeVisible();
    await expect.poll(() => gatekeeper(page), { timeout: 8000 }).toBe('idle');
    expect((await zooState(page)).visitor).toBe(null);
    await phoneTap(request, FOX_TRICK.canonical_id); // kept out isn't final: the class votes again
    await expect(page.locator('.zoo-vote')).toBeVisible();
    expect(await zooState(page)).toMatchObject({ pendingVote: FOX_TRICK.canonical_id, inside: [], tally: 0 });
    await page.waitForTimeout(1100);
    await page.keyboard.press('Alt+y');
    await expect(tally(page, 1)).toBeVisible();
  });

  test("the phone's Let in for this badge, sent before the vote card shows, counts once it's up", async ({ page, request }) => {
    await openScene(page, 'zoo', 4);
    await phoneTap(request, FOX_TRICK.canonical_id);
    await request.post('/api/command', { data: { action: 'let-in', card: FOX_TRICK.canonical_id } }); // straight away
    await expect(tally(page, 1)).toBeVisible({ timeout: 8000 });
    await expect(page.locator('.zoo-vote')).toHaveCount(0);
    await expect.poll(() => inside(page), { timeout: 15000 }).toContain(FOX_TRICK.canonical_id);
  });

  test('a decision named for a different badge is ignored', async ({ page, request }) => {
    await openScene(page, 'zoo', 4);
    await phoneTap(request, FOX_TRICK.canonical_id);
    await expect(page.locator('.zoo-vote')).toBeVisible();
    await page.waitForTimeout(1100);
    await request.post('/api/command', { data: { action: 'let-in', card: LION.canonical_id } });
    await page.waitForTimeout(1000);
    expect(await zooState(page)).toMatchObject({ pendingVote: FOX_TRICK.canonical_id, tally: 0 });
  });

  test('let-in from the phone works too', async ({ page, request }) => {
    await openScene(page, 'zoo', 4);
    await phoneTap(request, FOX_TRICK.canonical_id);
    await expect(page.locator('.zoo-vote')).toBeVisible();
    await page.waitForTimeout(1100); // the class votes
    await command(request, 'let-in');
    await expect(tally(page, 1)).toBeVisible();
    await expect(page.locator('.zoo-vote')).toHaveCount(0);
  });

  test('a tap during a vote waits, then goes in after the decision', async ({ page, request }) => {
    await openScene(page, 'zoo', 4);
    await phoneTap(request, FOX_TRICK.canonical_id);
    await expect(page.locator('.zoo-vote')).toBeVisible();
    await phoneTap(request, PENGUIN.canonical_id);
    await page.waitForTimeout(800);
    expect(await zooState(page)).toMatchObject({ tally: 0, inside: [] });
    await page.waitForTimeout(1100); // the class votes
    await page.keyboard.press('Alt+n');
    await expect(tally(page, 1)).toBeVisible();
    await expect.poll(() => inside(page), { timeout: 15000 }).toEqual([PENGUIN.canonical_id]);
  });

  test('a quick double Let in never admits the next trick badge without its own vote', async ({ page, request }) => {
    const LION_TRICK = { ...LION, role: 'trick' };
    await setCards(request, [PENGUIN, LION_TRICK, FOX_TRICK]);
    await openScene(page, 'zoo', 3);
    await phoneTap(request, FOX_TRICK.canonical_id);
    await expect(page.locator('.zoo-vote')).toBeVisible();
    await phoneTap(request, LION_TRICK.canonical_id); // waits behind the fox's vote
    await page.waitForTimeout(1100); // the class votes on the fox
    await page.keyboard.press('Alt+y');
    await page.keyboard.press('Alt+y');
    await expect(page.locator('.zoo-vote')).toContainText('🦁');
    expect(await zooState(page)).toMatchObject({ pendingVote: LION_TRICK.canonical_id, tally: 1 });
  });

  test('taps waiting behind a vote still get in if the presenter switches scenes', async ({ page, request }) => {
    await openScene(page, 'zoo', 4);
    await phoneTap(request, FOX_TRICK.canonical_id);
    await expect(page.locator('.zoo-vote')).toBeVisible();
    await phoneTap(request, PENGUIN.canonical_id);
    await page.waitForTimeout(300);
    await page.keyboard.press('Alt+4');
    await page.keyboard.press('Alt+3');
    await expect(tally(page, 1)).toBeVisible();
    expect(await inside(page)).toContain(PENGUIN.canonical_id);
  });

  test('let in with nothing waiting changes nothing', async ({ page }) => {
    await openScene(page, 'zoo', 4);
    await page.waitForTimeout(1100); // the class votes
    await page.keyboard.press('Alt+y');
    await expect(page.locator('#banner')).toContainText('Nothing is waiting');
    expect(await zooState(page)).toMatchObject({ tally: 0, inside: [] });
  });
});

test.describe('special badge finale', () => {
  test.beforeEach(async ({ request }) => {
    await setCards(request, [PENGUIN, LION, FOX_TRICK, OWL_AWAY, STAR_SPECIAL]);
    await command(request, 'reset');
  });
  const tapStar = (request) => phoneTap(request, STAR_SPECIAL.canonical_id);

  test('before Allow: silly denial with the goose and the padlock; nobody goes in', async ({ page, request }) => {
    await openScene(page, 'zoo', 5);
    await tapStar(request);
    await expect.poll(() => gatekeeper(page)).toBe('no');
    await expect.poll(async () => (await zooState(page)).models.padlock).toBe(true); // pops in once the goose turns
    expect(await zooState(page)).toMatchObject({
      specialDenied: true, visitor: STAR_SPECIAL.canonical_id, models: { goose: true, padlock: true },
      inside: [], tally: 0, finale: false,
    });
    await expect(page.locator('.zoo-special-denied')).toHaveCount(0); // the 3D padlock, not the flat one
    await expect.poll(() => gatekeeper(page), { timeout: 8000 }).toBe('idle');
    expect(await zooState(page)).toMatchObject({ specialDenied: false, visitor: null, models: { padlock: false } });
  });

  test('Option+A shows the Zoo List with everyone inside and scribbles the special in', async ({ page, request }) => {
    await openScene(page, 'zoo', 5);
    await phoneTap(request, PENGUIN.canonical_id);
    await expect.poll(() => inside(page), { timeout: 15000 }).toContain(PENGUIN.canonical_id);
    await tapStar(request);
    await page.keyboard.press('Alt+a');
    // The goose holds up its clipboard once the special's turn-away moment (about 3 s) is done.
    await expect.poll(async () => (await zooState(page)).models.clipboard, { timeout: 10000 }).toBe(true);
    const list = page.locator('.zoo-list');
    await expect(list).toBeVisible();
    await expect(list).toContainText('📋 Zoo List');
    await expect(list.locator(`.zoo-list-item[data-id="${PENGUIN.canonical_id}"]`)).toBeVisible();
    await expect(list.locator(`.zoo-list-new[data-id="${STAR_SPECIAL.canonical_id}"]`)).toBeVisible();
    expect((await zooState(page)).listOpen).toBe(true);
    await expect.poll(async () => (await getCards(request)).find((c) => c.role === 'special').allowed).toBe(true);
  });

  test('the allowed special closes the list, goes in with a mark, and starts the party', async ({ page, request }) => {
    await openScene(page, 'zoo', 5);
    await phoneTap(request, PENGUIN.canonical_id);
    await expect(tally(page, 1)).toBeVisible();
    await command(request, 'allow-special');
    // The list waits for the penguin's arrival to finish rather than covering it.
    await expect(page.locator('.zoo-list')).toBeVisible({ timeout: 15000 });
    await tapStar(request);
    await expect(page.locator('.zoo-list')).toHaveCount(0);
    await expect(tally(page, 2)).toBeVisible();
    await expect(page.locator('.zoo3d-finale')).toContainText('Congratulations, Official Zookeepers!', { timeout: 20000 });
    expect(await inside(page)).toContain(STAR_SPECIAL.canonical_id);
  });

  test('the Zoo List checks off who is in, and shows who is not in yet or not on the list', async ({ page, request }) => {
    await setCards(request, [PENGUIN, LION, FOX_TRICK, STAR_SPECIAL, OWL_AWAY]);
    await openScene(page, 'zoo', 5);
    await phoneTap(request, PENGUIN.canonical_id);
    await phoneTap(request, FOX_TRICK.canonical_id);
    await expect(page.locator('.zoo-vote')).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(1100);
    await page.keyboard.press('Alt+n'); // the fox is kept out
    await expect.poll(() => inside(page), { timeout: 20000 }).toContain(PENGUIN.canonical_id);
    await expect.poll(() => gatekeeper(page), { timeout: 10000 }).toBe('idle');
    await page.keyboard.press('Alt+l');
    const item = (card) => page.locator(`.zoo-list-item[data-id="${card.canonical_id}"]`);
    await expect(item(PENGUIN)).toHaveAttribute('data-status', 'in', { timeout: 10000 });
    await expect(item(PENGUIN).locator('.zoo-list-mark')).toHaveText('✅');
    await expect(item(LION)).toHaveAttribute('data-status', 'waiting');
    await expect(item(LION).locator('.zoo-list-mark.empty-box')).toBeVisible(); // an empty checkbox
    await expect(item(FOX_TRICK)).toHaveAttribute('data-status', 'unlisted');
    await expect(item(STAR_SPECIAL)).toHaveAttribute('data-status', 'unlisted');
    await expect(item(STAR_SPECIAL).locator('.zoo-list-mark')).toHaveText('❌');
    await expect(item(OWL_AWAY)).toHaveAttribute('data-status', 'away');
    await expect(item(OWL_AWAY).locator('.zoo-list-mark')).toHaveText('💤');
  });

  test('at the party the golden badge animal wears a snorkel and bounces around', async ({ page, request }) => {
    await openScene(page, 'zoo', 5);
    await command(request, 'allow-special');
    await expect(page.locator('.zoo-list')).toBeVisible({ timeout: 15000 });
    expect((await zooState(page)).snorkel).toBe(null);
    await tapStar(request);
    await expect(page.locator('.zoo3d-finale')).toBeVisible({ timeout: 20000 });
    expect((await zooState(page)).snorkel).toBe(STAR_SPECIAL.canonical_id);
    // Bigger hops than the other dancers. Compare in the same samples: CI's software 3D draws only
    // a few frames a second, which shrinks everyone's measured hops alike.
    const samples = [];
    for (let i = 0; i < 50; i++) {
      samples.push((await zooState(page)).heights);
      await page.waitForTimeout(100);
    }
    const range = (id) => {
      const hs = samples.map((h) => h[id]);
      return Math.max(...hs) - Math.min(...hs);
    };
    const others = Object.keys(samples[0]).filter((id) => id !== STAR_SPECIAL.canonical_id);
    const golden = range(STAR_SPECIAL.canonical_id);
    expect(golden).toBeGreaterThan(0.3);
    expect(golden).toBeGreaterThan(Math.max(...others.map(range)));
  });

  test('turned away, the golden badge is shown not on the Zoo List; Let in writes it on', async ({ page, request }) => {
    await openScene(page, 'zoo', 5);
    await tapStar(request);
    // After the goose says no, the list pops up by itself with the golden badge crossed out.
    const star = page.locator(`.zoo-list-item[data-id="${STAR_SPECIAL.canonical_id}"]`);
    await expect(star).toHaveAttribute('data-status', 'unlisted', { timeout: 15000 });
    await expect(star.locator('.zoo-list-mark')).toHaveText('❌');
    await command(request, 'allow-special');
    await expect(page.locator(`.zoo-list-new[data-id="${STAR_SPECIAL.canonical_id}"]`)).toBeVisible({ timeout: 15000 });
    await expect(star).toHaveAttribute('data-status', 'waiting');
  });

  test('a trick badge tapped during the turn-away gets its vote without the list on top', async ({ page, request }) => {
    await openScene(page, 'zoo', 5);
    await tapStar(request);
    await expect.poll(() => gatekeeper(page)).toBe('no');
    await phoneTap(request, FOX_TRICK.canonical_id);
    await expect(page.locator('.zoo-vote')).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(1500);
    await expect(page.locator('.zoo-list')).toHaveCount(0);
    await page.keyboard.press('Alt+y');
    await expect.poll(() => inside(page), { timeout: 20000 }).toContain(FOX_TRICK.canonical_id);
    await expect(page.locator('.zoo-list')).toHaveCount(0);
  });

  test('the fixed picture shows on the next vote for that trick badge', async ({ page, request }) => {
    await uploadImage(request, FOX_TRICK.canonical_id);
    await request.put(`/api/cards/${FOX_TRICK.canonical_id}/reveal-image`, { data: PNG_1PX, headers: { 'content-type': 'image/png' } });
    await openScene(page, 'zoo', 5);
    await phoneTap(request, FOX_TRICK.canonical_id);
    await expect(page.locator('.zoo-vote')).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(1100);
    await page.keyboard.press('Alt+n');
    await request.post(`/api/cards/${FOX_TRICK.canonical_id}/fix`);
    await expect.poll(() => gatekeeper(page), { timeout: 10000 }).toBe('idle');
    await phoneTap(request, FOX_TRICK.canonical_id);
    await expect(page.locator('.zoo-vote img')).toHaveAttribute('src', new RegExp(`${FOX_TRICK.canonical_id}-real\\.png`), { timeout: 10000 });
  });

  test('Option+L shows and hides the Zoo List', async ({ page }) => {
    await openScene(page, 'zoo', 5);
    await page.keyboard.press('Alt+l');
    await expect(page.locator('.zoo-list')).toBeVisible();
    await page.keyboard.press('Alt+l');
    await expect(page.locator('.zoo-list')).toHaveCount(0);
  });

  test('kids never see the word "special" from the golden badge being turned away to the party', async ({ page, request }) => {
    await openScene(page, 'zoo', 5);
    const visibleText = () => page.evaluate(() => document.body.innerText);
    await tapStar(request);
    await expect.poll(() => gatekeeper(page)).toBe('no');
    expect(await visibleText()).not.toMatch(/special/i);
    await command(request, 'allow-special');
    await expect(page.locator('.zoo-list')).toBeVisible({ timeout: 15000 });
    expect(await visibleText()).not.toMatch(/special/i);
    await page.waitForTimeout(1600);
    await tapStar(request);
    await expect(page.locator('.zoo3d-finale')).toBeVisible({ timeout: 20000 });
    expect(await visibleText()).not.toMatch(/special/i);
  });

  test('reset sends the special back to denied', async ({ page, request }) => {
    await openScene(page, 'zoo', 5);
    await command(request, 'allow-special');
    await expect(page.locator('.zoo-list')).toBeVisible();
    await resetKeys(page);
    await expect.poll(async () => (await getCards(request)).find((c) => c.role === 'special').allowed).toBe(false);
    await tapStar(request);
    await expect.poll(() => gatekeeper(page)).toBe('no');
    expect((await zooState(page)).tally).toBe(0);
  });
});

test('without WebGL the scene points to the backup', async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
      return /webgl/.test(type) ? null : original.call(this, type, ...rest);
    };
  });
  await openScene(page, 'zoo', 4);
  await expect(page.locator('.zoo3d-fallback')).toContainText('⌥6');
});
