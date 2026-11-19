// Desktop test (1280x800) for part 2: result, recovery drawer, saved, demo panel.
// Run: node qa/desktop-test.cjs   (needs Playwright + Chromium available globally)
// Flows: (1) happy path signup -> saved, (2) "Not quite" recovery incl. Undo,
// (3) ?fail=1 with Try again + template, (4) refresh mid-flow keeps progress.
// Also checks 1024px (two columns) and 880px (one column). Screenshots -> ../screenshots/desktop-*.png
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const URL = 'file://' + path.join(ROOT, 'index.html');
const SHOTS = path.join(ROOT, 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

let failures = 0;
const check = (ok, msg) => { console.log(`${ok ? '  ✓' : '  ✗'} ${msg}`); if (!ok) failures++; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const settle = () => wait(380); // screen slide (200ms) + frame morph (320ms) overlap
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `desktop-${name}.png`) });

async function open(browser, { width = 1280, height = 800, query = '?reset=1' } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2 });
  try { await ctx.grantPermissions(['clipboard-read', 'clipboard-write']); } catch (e) { /* not supported for file:// on some builds */ }
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(URL + query);
  await page.waitForSelector('.screen.is-active');
  return { ctx, page, errors };
}
const S = (page) => page.evaluate(() => App.getState());
const screenName = (page) => page.$eval('.screen.is-active', (el) => el.dataset.screen);
const caption = (page) => page.textContent('.screen.is-active .post__caption');
const events = async (page, name) => (await S(page)).events.filter((e) => e.name === name);
const btn = (page, name) => page.locator('.screen.is-active').getByRole('button', { name, exact: true });

// Walk W1 -> W4 for real and wait for the result screen.
async function toResult(page, { shots = false, idea = 'special' } = {}) {
  if (shots) await shot(page, '01-signup');
  await page.fill('#email', 'maya@sweetcrumbs.co');
  await page.getByRole('button', { name: 'Create account' }).click(); await settle();
  await page.fill('#businessName', 'Sweet Crumbs Bakery');
  await page.fill('#oneLiner', 'Home bakery selling custom cakes and cookies');
  if (shots) await shot(page, '02-setup');
  await page.getByRole('button', { name: 'Show me post ideas' }).click(); await settle();
  if (shots) await shot(page, '03-ideas');
  await page.click(`[data-idea="${idea}"]`); await settle();
}

(async () => {
  const browser = await chromium.launch();

  console.log('\n(1) Happy path: signup -> saved');
  {
    const { ctx, page, errors } = await open(browser);
    await toResult(page, { shots: true });
    await wait(1200);
    await shot(page, '04-generating');
    await wait(2200);
    check(await screenName(page) === 'result', 'reaches result');
    await wait(300);
    const frame = await page.$eval('#phone', (e) => e.getBoundingClientRect().width);
    check(frame > 800, `frame widens for result (${Math.round(frame)}px)`);
    const cols = await page.$$eval('.screen.is-active .two-col > .col', (els) => els.map((e) => Math.round(e.getBoundingClientRect().left)));
    check(cols.length === 2 && cols[1] > cols[0] + 200, 'two columns side by side');
    check((await page.textContent('.screen.is-active h1')) === "Here's your first post", 'heading');
    check((await page.textContent('.post__media-label')) === 'Image: chocolate cake (placeholder)', 'bakery image label');
    check((await page.textContent('.post__channel')) === 'Instagram', 'channel in post header');
    check((await page.textContent('.post__tags')) === '#SweetCrumbs #CakeLovers #WeekendTreat', 'hashtags');
    const gen = await events(page, 'first_post_generated');
    check(gen.length === 1 && gen[0].props.source === 'suggested' && gen[0].props.channel === 'instagram' && gen[0].props.latency_ms >= 2900,
      `first_post_generated once with props ${JSON.stringify(gen[0] && gen[0].props)}`);
    await shot(page, '05-result');

    await btn(page, 'Yes, looks good').click();
    check(await page.textContent('#toast-layer') === 'Great. Hit Save post to keep it.', '"Yes, looks good" toast');

    const original = await caption(page);
    await btn(page, 'Shorter').click();
    check(await caption(page) === 'This weekend only: our Belgian chocolate truffle cake is back. Order by Friday 6 PM.', 'Shorter: variant 1');
    await btn(page, 'Shorter').click();
    check(await caption(page) === 'Belgian chocolate truffle cake, this weekend only. Reserve yours by Friday 6 PM.', 'Shorter again: variant 2');
    await btn(page, 'More formal').click();
    check((await caption(page)).startsWith('We are pleased to announce'), 'More formal: variant 1');
    check(await btn(page, 'More formal').getAttribute('aria-pressed') === 'true' && await btn(page, 'Shorter').getAttribute('aria-pressed') === 'false', 'only the active chip is pressed');
    check((await S(page)).draft.toneChipUsed === 3, 'toneChipUsed counts taps');

    await btn(page, 'Try another version').click();
    const v1 = await caption(page);
    check(v1 !== original && v1.startsWith('Our Belgian chocolate truffle cake returns'), 'Try another version: version 2');
    check(await btn(page, 'More formal').getAttribute('aria-pressed') === 'false', 'new version clears the tone chip');
    await btn(page, 'Try another version').click();
    await btn(page, 'Try another version').click();
    check(await caption(page) === original && (await S(page)).draft.regenerations === 3, 'cycles through 3 versions, regenerations = 3');
    await btn(page, 'Warmer').click(); // a non-default caption? no: back on version 1 = default, so bakery variant
    check((await caption(page)).startsWith('Good news, friends'), 'Warmer on default caption');

    await btn(page, 'Copy caption').click();
    await wait(150);
    check(await page.textContent('#toast-layer') === 'Copied', 'Copy caption toast');
    const clip = await page.evaluate(() => navigator.clipboard.readText().catch(() => null));
    if (clip !== null) check(clip.startsWith('Good news, friends') && clip.includes('#SweetCrumbs'), 'clipboard holds caption + hashtags');

    await btn(page, 'Save post').click(); await settle();
    check(await screenName(page) === 'saved', 'Save post -> saved');
    const saved = await events(page, 'first_post_saved');
    const p = saved[0] && saved[0].props;
    check(saved.length === 1 && p.tone_chip_used === 4 && p.voice_fix_opened === false && p.regenerations === 3 && typeof p.seconds_since_signup === 'number',
      `first_post_saved props ${JSON.stringify(p)}`);
    await wait(700);
    check((await page.textContent('.screen.is-active h1')) === 'Post saved to your library', 'saved heading');
    check(await page.$eval('.meter__pct', (e) => e.textContent) === '40%', 'profile meter 40%');
    await shot(page, '07-saved');

    await btn(page, 'Yes, with edits').click();
    check(await page.textContent('.rating__thanks') === 'Thanks, noted', '"Thanks, noted" appears');
    await btn(page, 'No').click({ force: true }); // locked: aria-disabled, the click must be ignored
    const rated = await events(page, 'post_usefulness_rated');
    check(rated.length === 1 && rated[0].props.value === 'yes_with_edits', 'rating tracked once, choice locked');
    check(await btn(page, 'Yes, with edits').getAttribute('aria-pressed') === 'true', 'chosen button highlighted');
    await shot(page, '07b-saved-rated');

    await page.click('text=Link your website');
    check(await page.textContent('#toast-layer') === 'Not part of this prototype', 'profile item toast');
    await btn(page, 'Do this later').click();
    check(await page.textContent('#toast-layer') === 'Not part of this prototype', '"Do this later" toast');

    // Demo panel
    const funnel = await page.$$eval('.funnel__step', (els) => els.map((e) => e.classList.contains('is-reached')));
    check(funnel.length === 4 && funnel.every(Boolean), 'funnel: all 4 steps lit');
    const timing = await page.textContent('.timings');
    check(/Time to first draft: \d+ s/.test(timing) && /Time to save: \d+ s/.test(timing), `timings (${timing})`);
    const badges = await page.$$eval('.key-events__row', (rows) => rows.map((r) => r.textContent));
    check(badges[0].includes('Fired once') && badges[1].includes('Fired once') && badges[2].includes('Fired once') && badges[4].includes('yes_with_edits'), 'key event badges');
    await page.mouse.move(0, 0);
    await shot(page, '08-demo-panel-complete');

    await btn(page, 'Create another post').click(); await settle();
    const st = await S(page);
    check(await screenName(page) === 'ideas' && st.businessName === 'Sweet Crumbs Bakery' && st.draft === null, 'Create another post -> ideas, profile kept');
    check(!(await page.$eval('#phone', (e) => e.classList.contains('is-wide'))), 'frame narrows again on ideas');
    check(errors.length === 0, `no console errors ${errors.join(' | ')}`);
    await ctx.close();
  }

  console.log('\n(2) Recovery path: "Not quite" -> drawer -> rewrite -> Undo');
  {
    const { ctx, page, errors } = await open(browser);
    await toResult(page); await wait(3400);
    const original = await caption(page);

    // Open + close three ways
    await btn(page, 'Not quite').click(); await wait(300);
    check(await page.isVisible('.sheet--drawer'), 'drawer opens');
    const dw = await page.$eval('.sheet--drawer', (e) => Math.round(e.getBoundingClientRect().width));
    check(dw === 420, `drawer is 420px (${dw})`);
    check((await events(page, 'voice_fix_opened')).length === 1, 'voice_fix_opened tracked');
    check(await page.getByRole('button', { name: 'Rewrite my post' }).isDisabled(), 'Rewrite disabled with no words');
    for (let i = 0; i < 14; i++) await page.keyboard.press('Tab');
    check(await page.evaluate(() => document.querySelector('.sheet').contains(document.activeElement)), 'focus trapped in drawer after 14 Tabs');
    await page.keyboard.press('Shift+Tab');
    check(await page.evaluate(() => document.querySelector('.sheet').contains(document.activeElement)), 'Shift+Tab stays in drawer');
    await page.keyboard.press('Escape'); await wait(300);
    check(!(await page.isVisible('.sheet--drawer')), 'Escape closes');
    check(await page.evaluate(() => document.activeElement.textContent) === 'Not quite', 'focus returns to "Not quite"');

    await btn(page, 'Not quite').click(); await wait(300);
    await page.mouse.click(300, 400); await wait(300); // backdrop, left of the drawer
    check(!(await page.isVisible('.sheet--drawer')), 'backdrop click closes');
    await btn(page, 'Not quite').click(); await wait(300);
    await page.locator('.sheet').getByRole('button', { name: 'Cancel' }).click(); await wait(300);
    check(!(await page.isVisible('.sheet--drawer')), 'Cancel closes');

    // Cancel mid-rewrite: no change
    await btn(page, 'Not quite').click(); await wait(300);
    const sheet = page.locator('.sheet');
    await sheet.getByRole('button', { name: 'Bold' }).click();
    await sheet.getByRole('button', { name: 'Rewrite my post' }).click();
    await wait(500); await page.keyboard.press('Escape'); await wait(1500);
    check(await caption(page) === original, 'Escape during rewrite cancels it');

    // Real rewrite
    await btn(page, 'Not quite').click(); await wait(300);
    for (const w of ['Friendly', 'Warm', 'Playful']) await sheet.getByRole('button', { name: w }).click();
    await sheet.getByRole('button', { name: 'Luxury' }).click();
    check(await sheet.getByRole('button', { name: 'Luxury' }).getAttribute('aria-pressed') === 'false', '4th word ignored');
    check(await sheet.getByRole('button', { name: 'Luxury' }).evaluate((e) => e.classList.contains('shake')), '4th word shakes');
    check(!(await sheet.getByRole('button', { name: 'Rewrite my post' }).isDisabled()), 'Rewrite enabled with words');
    await page.fill('#voice-sample', 'Fresh cookies today! Come early. Bring a friend!');
    await wait(400);
    await shot(page, '06-recovery-drawer');
    await sheet.getByRole('button', { name: 'Rewrite my post' }).click();
    check((await sheet.locator('.btn__label').first().textContent()) === 'Rewriting…', 'loading state');
    await wait(1800);
    check(!(await page.isVisible('.sheet--drawer')), 'drawer closes after 1.5s');
    const rewritten = await caption(page);
    check(rewritten !== original && rewritten.startsWith('Hi friends!'), `caption rewritten: "${rewritten}"`);
    check((await page.textContent('.tag--voice')) === 'Voice: Friendly, Warm, Playful', 'voice tag under post');
    check(await page.evaluate(() => document.activeElement.textContent) === 'Undo', 'focus lands on Undo');
    const st = await S(page);
    check(st.voiceWords.join() === 'Friendly,Warm,Playful' && st.voiceSample.startsWith('Fresh cookies'), 'voiceWords + sample stored');
    await wait(900);
    await shot(page, '05b-result-voice');

    await btn(page, 'Undo').click();
    check(await caption(page) === original, 'Undo restores previous caption');
    check(!(await page.isVisible('.tag--voice')), 'voice tag gone after Undo');

    await btn(page, 'Save post').click(); await settle();
    const saved = await events(page, 'first_post_saved');
    check(saved[0].props.voice_fix_opened === true, 'first_post_saved: voice_fix_opened = true');

    // Voice words carry into the next post's first draft
    await btn(page, 'Create another post').click(); await settle();
    await page.click('[data-idea="review"]'); await wait(3500);
    check((await page.textContent('.tag--voice')) === 'Voice: Friendly, Warm, Playful', 'next draft starts in the saved voice');
    check((await events(page, 'first_post_generated')).length === 1, 'first_post_generated still once per user');
    check(errors.length === 0, `no console errors ${errors.join(' | ')}`);
    await ctx.close();
  }

  console.log('\n(3) ?fail=1: Try again + Use a ready template');
  {
    const { ctx, page, errors } = await open(browser, { query: '?reset=1&fail=1' });
    await toResult(page); await wait(3300);
    check(await page.isVisible('.fail-box'), 'failure box');
    await shot(page, '04b-generating-failed');
    await btn(page, 'Try again').click(); await wait(3300);
    check(await page.isVisible('.fail-box') && await screenName(page) === 'generating', 'Try again fails again while flag is on');
    await btn(page, 'Use a ready template').click(); await settle();
    const gen = await events(page, 'first_post_generated');
    check(await screenName(page) === 'result' && gen[0].props.source === 'template', 'template draft -> result, source = template');
    check((await caption(page)).startsWith('Say hello to Sweet Crumbs Bakery.'), 'template caption');
    await btn(page, 'Try another version').click();
    check((await caption(page)).startsWith('Welcome to Sweet Crumbs Bakery.'), 'template has its own versions');

    // Turn the flag off via the demo panel and retry from a fresh failure
    await page.evaluate(() => App.navigate('ideas')); await settle();
    await page.click('[data-idea="behind_the_scenes"]'); await wait(3300);
    check(await page.isVisible('.fail-box'), 'fails again with flag on');
    await page.click('label[for="demo-fail"]');
    check(!(await page.isChecked('#demo-fail')), 'demo toggle off');
    await btn(page, 'Try again').click(); await wait(3400);
    check(await screenName(page) === 'result' && (await S(page)).draft.source === 'suggested', 'Try again succeeds once the flag is off');
    check(errors.length === 0, `no console errors ${errors.join(' | ')}`);
    await ctx.close();
  }

  console.log('\n(4) Refresh mid-flow keeps progress');
  {
    const { ctx, page, errors } = await open(browser);
    await page.fill('#email', 'maya@sweetcrumbs.co');
    await page.getByRole('button', { name: 'Create account' }).click(); await settle();
    await page.fill('#businessName', 'Sweet Crumbs Bakery');
    await page.fill('#oneLiner', 'Home bakery selling');
    await page.goto(URL); await page.waitForSelector('.screen.is-active');
    check(await screenName(page) === 'setup' && await page.inputValue('#businessName') === 'Sweet Crumbs Bakery' && await page.inputValue('#oneLiner') === 'Home bakery selling', 'reload on setup keeps typed values');
    await page.fill('#oneLiner', 'Home bakery selling custom cakes and cookies');
    await page.getByRole('button', { name: 'Show me post ideas' }).click(); await settle();
    await page.click('[data-idea="special"]'); await wait(3400);
    await btn(page, 'Warmer').click();
    const warm = await caption(page);
    await page.goto(URL); await page.waitForSelector('.screen.is-active'); await wait(300);
    check(await screenName(page) === 'result' && await caption(page) === warm, 'reload on result keeps the toned caption');
    check(await btn(page, 'Warmer').getAttribute('aria-pressed') === 'true', 'tone chip still pressed');
    check((await events(page, 'first_post_generated')).length === 1, 'no duplicate first_post_generated after reload');
    check(await page.$eval('#phone', (e) => e.classList.contains('is-wide')), 'wide frame restored on reload');
    await btn(page, 'Save post').click(); await settle();
    await btn(page, 'No').click();
    await page.goto(URL); await page.waitForSelector('.screen.is-active');
    check(await screenName(page) === 'saved' && await btn(page, 'No').getAttribute('aria-pressed') === 'true'
      && await page.textContent('.rating__thanks') === 'Thanks, noted', 'reload on saved keeps the locked rating');
    check(errors.length === 0, `no console errors ${errors.join(' | ')}`);
    await ctx.close();
  }

  console.log('\nLayout widths + demo jump to drawer');
  {
    const { ctx, page, errors } = await open(browser, { width: 1024, height: 768 });
    await page.click('[data-jump="recovery"]'); await wait(700);
    check(await screenName(page) === 'result' && await page.isVisible('.sheet--drawer'), 'demo "recovery drawer" jump builds a draft and opens the drawer');
    await page.keyboard.press('Escape'); await wait(300);
    const cols = await page.$$eval('.screen.is-active .two-col > .col', (els) => els.map((e) => Math.round(e.getBoundingClientRect().left)));
    check(cols[1] > cols[0] + 200, 'two columns at 1024px');
    const noScroll = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && [...document.querySelectorAll('.screen')].every((s) => s.scrollWidth <= s.clientWidth));
    check(noScroll, 'no horizontal scroll at 1024px');
    await page.mouse.move(0, 0);
    await shot(page, '09-result-1024');
    await page.click('[data-jump="saved"]'); await settle();
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'saved fits at 1024px');
    await page.setViewportSize({ width: 880, height: 800 }); await wait(500);
    await page.click('[data-jump="result"]'); await settle();
    const one = await page.$$eval('.screen.is-active .two-col > .col', (els) => els.map((e) => Math.round(e.getBoundingClientRect().left)));
    check(one[0] === one[1], 'one column below 900px');
    await shot(page, '10-result-880');
    check(errors.length === 0, `no console errors ${errors.join(' | ')}`);
    await ctx.close();
  }

  await browser.close();
  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
})();
