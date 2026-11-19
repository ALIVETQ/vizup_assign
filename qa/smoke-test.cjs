// Headless smoke test, phone sizes (390 / 360px): W1–W4, failure path, then result + saved at phone width.
// Part 2 desktop checks live in qa/desktop-test.cjs.
// Run: node qa/smoke-test.cjs   (needs Playwright + Chromium available globally)
// Saves screenshots to ../screenshots and exits non-zero on any failed check.
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

async function newPage(browser, { width = 390, height = 844, query = '?reset=1', scale = 2 } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: scale });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(URL + query);
  await page.waitForSelector('.screen.is-active');
  return { page, ctx, errors };
}
const screenName = (page) => page.$eval('.screen.is-active', (el) => el.dataset.screen);
const settle = () => wait(320); // > 200ms transition
const noHScroll = (page) => page.evaluate(() => {
  const s = document.querySelector('.screen.is-active');
  return document.documentElement.scrollWidth <= window.innerWidth && s.scrollWidth <= s.clientWidth;
});

(async () => {
  const browser = await chromium.launch();

  console.log('\nHappy path (390px, bakery)');
  {
    const { page, ctx, errors } = await newPage(browser);
    check(await screenName(page) === 'signup', 'starts on signup');
    check(await page.$eval('.field__error', (e) => e.textContent === ''), 'no error on first render');
    const create = page.getByRole('button', { name: 'Create account' });
    check(await create.isDisabled(), 'Create account disabled with empty email');
    await page.screenshot({ path: path.join(SHOTS, '01-signup.png') });

    await page.getByRole('button', { name: 'Already have an account? Log in' }).click();
    check(await page.textContent('#toast-layer') === 'Not part of this prototype', 'Log in shows out-of-scope toast');

    await page.fill('#email', 'maya@');
    await page.locator('#email').blur();
    check((await page.textContent('#email-error')).length > 0, 'invalid email shows error after blur');
    check(await create.isDisabled(), 'still disabled with invalid email');
    await page.fill('#email', 'maya@sweetcrumbs.co');
    check(!(await create.isDisabled()), 'enabled with valid email');
    await create.click(); await settle();
    check(await screenName(page) === 'setup', 'goes to setup');
    check(await page.evaluate(() => typeof App.getState().signupAt === 'number'), 'signupAt set');

    // setup
    check(await page.$$eval('.field__error', (els) => els.every((e) => e.textContent === '')), 'setup: no errors on first render');
    const cta = page.getByRole('button', { name: 'Show me post ideas' });
    check(await cta.isDisabled(), 'Show me post ideas disabled at start');
    await page.getByRole('button', { name: 'Fitness coach' }).click();
    check(await page.inputValue('#oneLiner') === 'Fitness coach', 'example chip fills the field');
    await page.fill('#businessName', 'S');
    await page.locator('#businessName').blur();
    check((await page.textContent('#businessName-error')).length > 0, 'short business name shows error after blur');
    await page.fill('#businessName', 'Sweet Crumbs Bakery');
    await page.fill('#oneLiner', 'Home bakery selling custom cakes and cookies');
    check(!(await cta.isDisabled()), 'CTA enabled when both required fields valid');
    await page.getByRole('button', { name: 'Skip optional fields' }).click();
    check(await page.textContent('#toast-layer') === 'Optional fields skipped', 'skip shows toast');
    check(!(await cta.isDisabled()), 'skip keeps button state');
    await wait(300); // let the toast finish fading in
    await page.screenshot({ path: path.join(SHOTS, '02-setup.png') });
    await cta.click(); await settle();
    check(await screenName(page) === 'ideas', 'goes to ideas');
    const ev = await page.evaluate(() => App.getState().events);
    check(ev.length === 1 && ev[0].name === 'setup_completed' && ev[0].props.optional_fields_filled === 0
      && typeof ev[0].props.seconds_since_signup === 'number', 'setup_completed fired with props');

    // ideas
    const titles = await page.$$eval('.idea-card__title', (els) => els.map((e) => e.textContent));
    check(titles.join('|') === 'Announce a weekend special|Show how your custom cakes are made|Share a happy customer review', 'bakery idea wording');
    check((await page.textContent('.subtitle')) === "Ideas for Sweet Crumbs Bakery. Tap one and we'll write it.", 'ideas subtitle uses business name');
    check(await page.getByRole('button', { name: 'Instagram' }).getAttribute('aria-pressed') === 'true', 'Instagram selected by default');
    check(await noHScroll(page), 'ideas: no horizontal scroll');
    await page.screenshot({ path: path.join(SHOTS, '03-ideas.png') });
    await page.getByRole('button', { name: 'Write my own idea' }).click();
    check(await page.isVisible('#own-idea-input'), 'own idea expands');
    await page.screenshot({ path: path.join(SHOTS, '03b-ideas-own-idea.png') });
    await page.getByRole('button', { name: 'Write my own idea' }).click();

    // generating
    await page.click('[data-idea="special"]'); await settle();
    check(await screenName(page) === 'generating', 'tap idea goes straight to generating');
    await wait(1100);
    check(await page.$$eval('.check-item.is-done', (e) => e.length) === 1, 'checklist completes one line at a time');
    await page.screenshot({ path: path.join(SHOTS, '04-generating.png') });
    await wait(2300);
    check(await screenName(page) === 'result', 'arrives on result after ~3s');
    const draft = await page.evaluate(() => App.getState().draft);
    check(draft.caption.startsWith('This weekend only: our Belgian chocolate truffle cake'), 'default bakery caption');
    check(draft.hashtags.join(' ') === '#SweetCrumbs #CakeLovers #WeekendTreat', 'hashtags from business name');
    check(draft.source === 'suggested' && draft.channel === 'instagram' && draft.latencyMs >= 2900, 'draft source/channel/latency');
    check(await page.evaluate(() => App.getState().events.filter((e) => e.name === 'first_post_generated').length) === 1, 'first_post_generated fires when result renders (not in generating)');
    await page.screenshot({ path: path.join(SHOTS, '05-result.png') });

    await page.evaluate(() => App.navigate('saved')); await settle();
    await page.screenshot({ path: path.join(SHOTS, '06-saved.png') });
    await page.getByRole('button', { name: 'Back' }).last().click(); await settle();
    check(await screenName(page) === 'result', 'saved Back -> result');

    // once-per-user
    await page.evaluate(() => App.navigate('setup')); await settle();
    await page.getByRole('button', { name: 'Show me post ideas' }).click(); await settle();
    check(await page.evaluate(() => App.getState().events.filter((e) => e.name === 'setup_completed').length) === 1, 'setup_completed only fires once per user');

    // persistence
    await page.goto(URL); await page.waitForSelector('.screen.is-active'); // no ?reset this time
    check(await screenName(page) === 'ideas' && await page.evaluate(() => App.getState().businessName) === 'Sweet Crumbs Bakery', 'state + screen survive reload');

    // sheet layer
    await page.evaluate(() => { App.sheets.test = () => App.components.h('p', null, 'sheet'); App.openSheet('test'); });
    await wait(260);
    check(await page.isVisible('.sheet'), 'sheet opens');
    await page.keyboard.press('Escape'); await wait(260);
    check(await page.$eval('#sheet-layer', (e) => e.hidden), 'Esc closes sheet');

    check(errors.length === 0, `no console errors (${errors.join('; ')})`);
    await ctx.close();
  }

  console.log('\nFailure path (?fail=1, generic business)');
  {
    const { page, ctx, errors } = await newPage(browser, { query: '?reset=1&fail=1' });
    await page.evaluate(() => { App.setState({ businessName: 'Peak Form', oneLiner: 'Fitness coach for busy parents', channel: 'linkedin' }); App.navigate('ideas'); });
    await settle();
    const titles = await page.$$eval('.idea-card__title', (els) => els.map((e) => e.textContent));
    check(titles.join('|') === 'Announce a special offer|Show how you do what you do|Share a happy customer review', 'generic idea wording');
    check(await page.isChecked('#demo-fail'), 'demo toggle reflects ?fail=1');
    await page.click('[data-idea="behind_the_scenes"]'); await settle();
    await wait(3300);
    check(await page.isVisible('.fail-box'), 'failure box after ~3s');
    check((await page.textContent('.fail-box__title')) === 'This is taking longer than usual.', 'failure copy');
    check(await screenName(page) === 'generating', 'stays on generating');
    await page.screenshot({ path: path.join(SHOTS, '04b-generating-failed.png') });

    await page.getByRole('button', { name: 'Try again' }).click();
    check(!(await page.isVisible('.fail-box')), 'Try again restarts');
    await wait(3300);
    check(await page.isVisible('.fail-box'), 'fails again while flag is on');

    await page.evaluate(() => App.setFailMode(false));
    await page.getByRole('button', { name: 'Try again' }).click();
    await wait(3400);
    check(await screenName(page) === 'result', 'Try again succeeds once flag is off');
    const d1 = await page.evaluate(() => App.getState().draft);
    check(d1.source === 'suggested' && d1.channel === 'linkedin' && d1.caption.includes('Peak Form') && d1.hashtags[0] === '#PeakForm', 'generic draft uses business name + channel');

    await page.evaluate(() => { App.setFailMode(true); App.navigate('generating'); });
    await wait(3400);
    await page.getByRole('button', { name: 'Use a ready template' }).click(); await settle();
    const d2 = await page.evaluate(() => App.getState().draft);
    check(await screenName(page) === 'result' && d2.source === 'template', 'template draft source = template');

    // own idea
    await page.evaluate(() => { App.setFailMode(false); App.navigate('ideas'); }); await settle();
    await page.getByRole('button', { name: 'Write my own idea' }).click();
    const createPost = page.getByRole('button', { name: 'Create post' });
    check(await createPost.isDisabled(), 'Create post disabled when empty');
    await page.fill('#own-idea-input', 'A 10-minute workout for school mornings');
    await createPost.click(); await wait(3500);
    const d3 = await page.evaluate(() => App.getState());
    check(d3.draft.source === 'own_idea' && d3.selectedIdea.source === 'own_idea' && d3.ownIdea.length > 0, 'own idea draft source = own_idea');

    check(errors.length === 0, `no console errors (${errors.join('; ')})`);
    await ctx.close();
  }

  console.log('\n360px layout');
  {
    const { page, ctx, errors } = await newPage(browser, { width: 360, height: 740, scale: 1 });
    await page.evaluate(() => App.setState({ businessName: 'Sweet Crumbs Bakery', oneLiner: 'Home bakery selling custom cakes and cookies' }));
    for (const s of ['signup', 'setup', 'ideas', 'generating', 'result', 'saved']) {
      await page.evaluate((n) => App.navigate(n, { animate: false }), s);
      check(await noHScroll(page), `${s}: no horizontal scroll at 360px`);
    }
    await page.click('#demo-fab'); await wait(260);
    check(await page.isVisible('.demo__body'), 'mobile "i" opens demo panel');
    await page.keyboard.press('Escape'); await wait(260);
    check(errors.length === 0, 'no console errors');
    await ctx.close();
  }

  console.log('\nDesktop frame + keyboard');
  {
    const { page, ctx, errors } = await newPage(browser, { width: 1280, height: 860 });
    const box = await page.$eval('#phone', (e) => { const r = e.getBoundingClientRect(); return [r.width, r.height]; });
    check(box[0] === 390 && box[1] === 780, `phone frame 390x780 (got ${box})`);
    check(await page.isVisible('.demo__body'), 'demo panel visible on desktop');
    check(!(await page.isVisible('#demo-fab')), 'no "i" button on desktop');
    await page.click('text=Fill sample data');
    check(await page.inputValue('#email') === 'maya@sweetcrumbs.co', 'Fill sample data fills the email');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await wait(260); // ring fades in over 200ms
    // Buttons get an outline, inputs get a border + box-shadow ring.
    const ring = await page.evaluate(() => { const cs = getComputedStyle(document.activeElement); return `${document.activeElement.tagName} outline:${cs.outlineStyle} shadow:${cs.boxShadow}`; });
    check(/solid|rgba\(79, 70, 229/.test(ring), `visible focus ring (${ring})`);
    await page.keyboard.press('Tab');
    const ring2 = await page.evaluate(() => `${document.activeElement.textContent} ${getComputedStyle(document.activeElement).outlineStyle}`);
    check(/solid/.test(ring2), `button focus ring (${ring2})`);
    await page.mouse.move(0, 0);
    await page.screenshot({ path: path.join(SHOTS, '00-desktop.png') });
    await page.click('[data-jump="setup"]'); await settle();
    await page.click('#businessName'); await page.keyboard.press('Tab');
    await page.screenshot({ path: path.join(SHOTS, '00b-desktop-setup.png') });
    await page.click('.demo__collapse');
    check(!(await page.isVisible('.demo__body')), 'demo panel collapses');
    check(errors.length === 0, 'no console errors');
    await ctx.close();
  }

  await browser.close();
  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
})();
