/* =========================================================
   First-post onboarding prototype · app.js
   Plain classic script on purpose: ES modules don't load from file://,
   and this has to work by double-clicking index.html.

   Sections
    1. Config
    2. State store (persisted to localStorage)
    3. URL flags
    4. Tracker
    5. DOM helpers + icons
    6. Components: Button, Tag, Field, Chip, ChipGroup, ProgressBar, ScreenHeader, Toast
    7. Router: screens map + navigate()
    8. Sheet layer (bottom sheets, used later for recovery)
    9. Mock content: ideas + draft builder (no real AI)
    9b. Post writing: versions, tone chips, brand voice
   10. Screens: signup, setup, ideas, generating, result, saved + recovery drawer
   11. Demo panel
   12. Boot

   Extending: add a <script> after this one (or edit section 10) and assign
   screens.<name> = renderX or sheets.<name> = renderY. Boot runs on
   DOMContentLoaded, so later scripts register before the first render.
   ========================================================= */

/* ---------- 1. Config ---------- */
const STORAGE_KEY = 'firstpost-onboarding-v1';
const TRANSITION_MS = 200;               // screen slide/fade
const GENERATION_MS = 3000;              // "about 3 seconds" to a draft (or to the failure box)
const STEP_DONE_AT = [800, 1700, 2700];  // when each checklist line ticks off
const TOAST_MS = 2400;
const OUT_OF_SCOPE = 'Not part of this prototype';

const CHANNELS = [
  { id: 'instagram', label: 'Instagram' },
  { id: 'facebook', label: 'Facebook' },
  { id: 'linkedin', label: 'LinkedIn' },
];
const ONE_LINER_EXAMPLES = ['Boutique clothing store', 'Fitness coach', 'Digital agency'];
const GEN_STEPS = ['Read your business details', 'Chose a friendly tone to start', 'Writing caption and hashtags'];
const SAMPLE_DATA = {
  email: 'maya@sweetcrumbs.co',
  businessName: 'Sweet Crumbs Bakery',
  oneLiner: 'Home bakery selling custom cakes and cookies',
};

// Part 2: result, recovery drawer, saved
const WIDE_SCREENS = new Set(['result', 'saved']); // two-column screens: the desktop frame widens for these
const REWRITE_MS = 1500;                            // recovery drawer "Rewrite my post" loading time
const MAX_VOICE_WORDS = 3;
const VOICE_WORDS = ['Friendly', 'Warm', 'Playful', 'Professional', 'Bold', 'Minimal', 'Luxury', 'Casual'];
const TONES = [
  { id: 'shorter', label: 'Shorter' },
  { id: 'warmer', label: 'Warmer' },
  { id: 'playful', label: 'More playful' },
  { id: 'formal', label: 'More formal' },
];
const USEFULNESS = [
  { value: 'yes_as_is', label: 'Yes, as is' },
  { value: 'yes_with_edits', label: 'Yes, with edits' },
  { value: 'no', label: 'No' },
];
const PROFILE_ITEMS = ['Add your logo and colours', 'Link your website', 'Describe your audience'];
const PROFILE_PROGRESS = 40; // % shown on the saved screen's profile card

/* ---------- 2. State store ---------- */
// One object, one source of truth. Every write goes through setState() so it
// is saved and the demo panel re-renders. Field names are the contract the
// next step builds on, so don't rename them casually.
function defaultState() {
  return {
    email: '',
    businessName: '',
    oneLiner: '',
    link: '',
    channel: 'instagram',
    selectedIdea: null,        // { id, title, tag, source: 'suggested' | 'own_idea' }
    ownIdea: '',
    signupAt: null,            // ms timestamp, set the first time the user leaves signup
    generationStartedAt: null, // ms timestamp of the latest generation attempt
    events: [],                // [{ name, props, t, secondsSinceSignup }]
    firedOnce: {},             // { eventName: t } for once-per-user events
    voiceWords: [],            // brand voice from the recovery drawer, reused for every new draft
    voiceSample: '',           // caption pasted in the recovery drawer (its style is borrowed)
    draft: null,               // see buildDraft() for the full shape
    flags: { simulateFail: false },
    screen: 'signup',          // last screen, so a reload lands where you were
  };
}

let state = loadState();
const stateListeners = new Set();

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const saved = JSON.parse(raw);
    const base = defaultState();
    return { ...base, ...saved, flags: { ...base.flags, ...(saved.flags || {}) } };
  } catch (err) {
    return defaultState(); // corrupt or blocked storage: start clean rather than crash
  }
}
function saveState() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (err) { /* private mode etc. */ }
}
function getState() { return state; }
function setState(patch) {
  const next = typeof patch === 'function' ? patch(state) : patch;
  state = { ...state, ...next };
  saveState();
  stateListeners.forEach((fn) => fn(state));
}
function subscribe(fn) { stateListeners.add(fn); return () => stateListeners.delete(fn); }

function resetDemo() {
  try { localStorage.removeItem(STORAGE_KEY); } catch (err) { /* ignore */ }
  failFromUrl = urlFlags.fail; // URL flags still apply after a reset
  closeSheet();
  setState(defaultState());
  navigate('signup', { direction: 'back' });
  toast('Demo reset');
}

/* ---------- 3. URL flags ---------- */
// ?fail=1        every generation stalls and shows the failure box
// ?reset=1       start from a clean state
// ?screen=name   open straight on a screen (any key of the screens map)
const params = new URLSearchParams(location.search);
const urlFlags = {
  fail: params.get('fail') === '1',
  reset: params.get('reset') === '1',
  screen: params.get('screen'),
};
// The URL flag is kept separate from state.flags so it isn't saved to storage
// (otherwise removing ?fail=1 wouldn't turn it off). The demo toggle clears both.
let failFromUrl = urlFlags.fail;
function isFailMode() { return failFromUrl || !!state.flags.simulateFail; }
function setFailMode(on) {
  if (!on) failFromUrl = false;
  setState({ flags: { ...state.flags, simulateFail: !!on } });
}

/* ---------- 4. Tracker ---------- */
function secondsSinceSignup() {
  return state.signupAt ? Math.round((Date.now() - state.signupAt) / 1000) : null;
}

// track(name, props, { once }) – once-per-user events are remembered in
// state.firedOnce so a second call is a no-op (returns null).
function track(name, props = {}, options = {}) {
  if (options.once && state.firedOnce[name]) {
    console.info(`[track] "${name}" already fired for this user, skipped`);
    return null;
  }
  const event = { name, props, t: Date.now(), secondsSinceSignup: secondsSinceSignup() };
  setState({
    events: [...state.events, event],
    firedOnce: options.once ? { ...state.firedOnce, [name]: event.t } : state.firedOnce,
  });
  console.log(`[track] ${name}`);
  console.table({ ...props, secondsSinceSignup: event.secondsSinceSignup });
  return event;
}
function trackOnce(name, props) { return track(name, props, { once: true }); }

/* ---------- 5. DOM helpers + icons ---------- */
const $ = (sel, root = document) => root.querySelector(sel);

// h('div', { class, onClick, ... }, ...children) – tiny element builder.
// Text children become text nodes, so user input is never parsed as HTML.
function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [key, val] of Object.entries(attrs)) {
      if (val == null || val === false) continue;
      if (key === 'class') el.className = val;
      else if (key === 'html') el.innerHTML = val; // trusted static strings only (icons)
      else if (key.startsWith('on') && typeof val === 'function') el.addEventListener(key.slice(2).toLowerCase(), val);
      else if (val === true) el.setAttribute(key, '');
      else el.setAttribute(key, String(val));
    }
  }
  appendChildren(el, children);
  return el;
}
function appendChildren(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

const ICON_PATHS = {
  back: '<path d="M15 18l-6-6 6-6"/>',
  chev: '<path d="M9 6l6 6-6 6"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  sparkle: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
  megaphone: '<path d="M3 10v4a1 1 0 0 0 1 1h2l6 4V5L6 9H4a1 1 0 0 0-1 1z"/><path d="M16 8.5a4 4 0 0 1 0 7"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  star: '<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8L3.5 9.7l5.9-.9z"/>',
  pencil: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  collapse: '<path d="M14 6l6 6-6 6M4 6l6 6-6 6"/>',
  heart: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>',
  comment: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>',
  send: '<path d="M21 3L10 14"/><path d="M21 3l-7 18-4-7-7-4z"/>',
  bookmark: '<path d="M6 3h12v18l-6-4-6 4z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.3-4.9L4 8"/><path d="M4 3v5h5"/><path d="M4 13a8 8 0 0 0 14.3 4.9L20 16"/><path d="M20 21v-5h-5"/>',
};
function icon(name, extraClass = '') {
  if (name === 'google') {
    // Multicolour mark, so it is drawn with fills instead of the stroke style below.
    return h('span', { class: `icon ${extraClass}`, 'aria-hidden': 'true', html:
      '<svg viewBox="0 0 24 24"><path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.2-2.1 3.5-5.1 3.5-8.7z"/><path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.3v3.1A12 12 0 0 0 12 24z"/><path fill="#FBBC05" d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6H1.3a12 12 0 0 0 0 10.8z"/><path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.3 6.6l4 3.1c.9-2.8 3.6-4.9 6.7-4.9z"/></svg>' });
  }
  return h('span', { class: `icon icon--${name} ${extraClass}`, 'aria-hidden': 'true', html:
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICON_PATHS[name] || ''}</svg>` });
}

/* ---------- 6. Components ---------- */
// Each component returns a DOM element (or, for Field, an element plus a small API).

function Button({ label, variant = 'primary', onClick, disabled = false, type = 'button', icon: iconLeft, iconRight, full = true, ariaLabel, className = '' }) {
  const isIconOnly = variant === 'icon';
  return h('button', {
    type,
    class: `btn btn--${variant}${full && !isIconOnly && variant !== 'link' ? ' btn--full' : ''} ${className}`.trim(),
    disabled,
    'aria-label': ariaLabel,
    onClick,
  }, iconLeft && icon(iconLeft), !isIconOnly && h('span', { class: 'btn__label' }, label), iconRight && icon(iconRight));
}

// Every button that leads outside this prototype goes through here.
function outOfScope() { toast(OUT_OF_SCOPE); }

// Tag('required') / Tag('optional'), or Tag(kind, 'Custom text') e.g. Tag('pick', 'Pick 1 to 3').
function Tag(kind, text) {
  // Text is sentence case for screen readers; CSS uppercases it visually.
  return h('span', { class: `tag tag--${kind}` }, text || (kind === 'required' ? 'Required' : 'Optional'));
}

// Field: label + REQUIRED/OPTIONAL tag + input/textarea + inline error.
// Errors stay hidden until the field is "touched" (blurred once, or filled by a chip),
// so nobody gets shouted at on first render. isValid() works regardless.
function Field({ id, label, required = false, type = 'text', placeholder, value = '', multiline = false, rows = 3, validate, onInput, autocomplete, inputmode, after }) {
  const errorId = `${id}-error`;
  const control = h(multiline ? 'textarea' : 'input', {
    id, name: id, class: 'field__control',
    type: multiline ? null : type,
    rows: multiline ? rows : null,
    placeholder, autocomplete, inputmode,
    'aria-required': required ? 'true' : null,
    'aria-describedby': errorId,
  });
  control.value = value || '';
  const error = h('p', { id: errorId, class: 'field__error' });
  const el = h('div', { class: 'field' },
    h('div', { class: 'field__label-row' }, h('label', { for: id, class: 'field__label' }, label), Tag(required ? 'required' : 'optional')),
    control, error, after);

  let touched = false;
  const message = () => (validate ? validate(control.value) || '' : '');
  function refresh() {
    const msg = touched ? message() : '';
    error.textContent = msg;
    el.classList.toggle('field--invalid', !!msg);
    control.setAttribute('aria-invalid', msg ? 'true' : 'false');
  }
  control.addEventListener('input', () => { refresh(); if (onInput) onInput(control.value); });
  control.addEventListener('blur', () => { touched = true; refresh(); });

  return {
    el, control,
    isValid: () => !message(),
    value: () => control.value,
    setValue(v) { control.value = v; touched = true; refresh(); if (onInput) onInput(v); },
    touch() { touched = true; refresh(); },
  };
}

function Chip({ label, selected = false, onClick, keepFocus = false }) {
  return h('button', {
    type: 'button',
    class: `chip${selected ? ' is-selected' : ''}`,
    'aria-pressed': String(!!selected),
    // keepFocus: tapping an example chip shouldn't blur the input it fills,
    // otherwise its error would flash for a frame before the value lands.
    onMousedown: keepFocus ? (e) => e.preventDefault() : null,
    onClick,
  }, selected && icon('check'), label);
}

// Single-select chip group (re-renders itself in place on change).
function ChipGroup({ options, value, onChange, labelledBy }) {
  const row = h('div', { class: 'chip-row', role: 'group', 'aria-labelledby': labelledBy });
  let current = value;
  function paint() {
    const hadFocus = row.contains(document.activeElement) ? document.activeElement.textContent : null;
    row.replaceChildren(...options.map((opt) => Chip({
      label: opt.label,
      selected: opt.id === current,
      onClick: () => { current = opt.id; paint(); onChange(opt.id); },
    })));
    if (hadFocus) [...row.children].find((c) => c.textContent === hadFocus)?.focus();
  }
  paint();
  return row;
}

// Flip a Chip's selected state in place (keeps focus, unlike re-rendering it).
function setChipSelected(chip, on) {
  chip.classList.toggle('is-selected', on);
  chip.setAttribute('aria-pressed', String(on));
  const mark = chip.querySelector('.icon--check');
  if (on && !mark) chip.prepend(icon('check'));
  if (!on && mark) mark.remove();
}

// Restart a one-shot CSS animation (e.g. the shake on a 4th voice word).
function replayAnimation(el, cls) {
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
  el.addEventListener('animationend', () => el.classList.remove(cls), { once: true });
}

// Clipboard API first; the textarea fallback covers older browsers and plain http.
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (err) {
    const back = document.activeElement;
    const ta = h('textarea', { style: 'position:fixed;top:0;left:0;opacity:0', 'aria-hidden': 'true' });
    ta.value = text;
    document.body.append(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    ta.remove();
    if (back) back.focus();
    return ok;
  }
}

function ProgressBar({ step, total }) {
  const pct = Math.round((step / total) * 100);
  const fill = h('div', { class: 'progress__fill', style: `width:${Math.round(((step - 1) / total) * 100)}%` });
  // Start from the previous step's width and grow, so the bar visibly fills on arrival.
  requestAnimationFrame(() => requestAnimationFrame(() => { fill.style.width = `${pct}%`; }));
  return h('div', { class: 'progress' },
    h('span', { class: 'progress__label' }, `Step ${step} of ${total}`),
    h('div', { class: 'progress__track', role: 'progressbar', 'aria-label': `Step ${step} of ${total}`, 'aria-valuemin': '0', 'aria-valuemax': String(total), 'aria-valuenow': String(step) }, fill));
}

function ScreenHeader({ back, progress } = {}) {
  return h('header', { class: 'screen__header' },
    back ? Button({ variant: 'icon', icon: 'back', ariaLabel: 'Back', onClick: () => navigate(back, { direction: 'back' }) })
      : h('span', { class: 'screen__header-spacer' }),
    progress ? ProgressBar(progress) : h('span', { style: 'flex:1' }),
    h('span', { class: 'screen__header-spacer' })); // keeps the bar centred and leaves room for the mobile "i"
}

// Toast: one at a time, replaces the previous one.
let toastTimer = null;
function Toast(message) { return h('div', { class: 'toast' }, message); }
function hideToast() { clearTimeout(toastTimer); const l = $('#toast-layer'); if (l) l.replaceChildren(); }
function toast(message, ms = TOAST_MS) {
  const layer = $('#toast-layer');
  const el = Toast(message);
  layer.replaceChildren(el);
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('is-visible')));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.classList.remove('is-visible');
    setTimeout(() => el.remove(), TRANSITION_MS);
  }, ms);
}

/* ---------- 7. Router ---------- */
// screens: name -> render function returning a <section>. navigate() swaps
// them with a 200ms slide/fade. Timers made with later() belong to the
// current screen and are cleared on every navigation, so a half-finished
// generation can't fire into the wrong screen.
const screens = {
  signup: renderSignup,
  setup: renderSetup,
  ideas: renderIdeas,
  generating: renderGenerating,
  result: renderResult,
  saved: renderSaved,
};

let currentScreen = null;
let screenTimers = [];
function later(fn, ms) { const id = setTimeout(fn, ms); screenTimers.push(id); return id; }
function clearScreenTimers() { screenTimers.forEach(clearTimeout); screenTimers = []; }
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function navigate(name, { direction = 'forward', animate = true } = {}) {
  if (!screens[name]) { console.warn(`[navigate] unknown screen "${name}"`); return; }
  clearScreenTimers();
  closeSheet({ restoreFocus: false });
  // result + saved need two columns, so the desktop frame widens for them (CSS animates it).
  $('#phone').classList.toggle('is-wide', WIDE_SCREENS.has(name));
  const root = $('#screen-root');
  // Drop anything still mid-exit from a previous fast navigation.
  root.querySelectorAll('.screen:not(.is-active)').forEach((el) => el.remove());
  const prev = root.querySelector('.screen.is-active');

  // A toast belongs to the screen it was raised on; drop it when the screen changes.
  if (currentScreen && currentScreen !== name) hideToast();
  const next = screens[name]();
  next.classList.add('screen');
  next.dataset.screen = name;
  currentScreen = name;
  if (state.screen !== name) setState({ screen: name });

  const instant = !prev || !animate || reducedMotion();
  if (instant) {
    if (prev) prev.remove();
    next.classList.add('is-active');
    root.append(next);
  } else {
    const back = direction === 'back';
    next.classList.add(back ? 'enter-from-left' : 'enter-from-right');
    root.append(next);
    void next.offsetWidth; // commit the start position so the transition runs
    next.classList.remove('enter-from-left', 'enter-from-right');
    next.classList.add('is-active');
    prev.classList.remove('is-active');
    prev.classList.add(back ? 'exit-to-right' : 'exit-to-left');
    prev.setAttribute('inert', '');
    prev.setAttribute('aria-hidden', 'true');
    setTimeout(() => prev.remove(), TRANSITION_MS + 40);
  }
  // Move focus to the new heading so keyboard and screen-reader users land at the top.
  const heading = next.querySelector('h1');
  if (heading && prev) heading.focus({ preventScroll: true });
  updateDemoPanel();
}

// Re-draw the current screen in place (e.g. after "Fill sample data").
function rerender() { if (currentScreen) navigate(currentScreen, { animate: false }); }

// Shared shell so every screen has the same structure.
// footer = sticky action bar; after = plain content pinned below the body (e.g. legal line).
function Screen({ name, header, body, footer, after }) {
  return h('section', { class: `screen screen--${name}`, 'aria-label': name },
    header, h('div', { class: 'screen__body' }, body), footer && h('div', { class: 'screen__footer' }, footer), after);
}
const Title = (text) => h('h1', { class: 'title', tabindex: '-1' }, text);
const Subtitle = (text) => h('p', { class: 'subtitle' }, text);

/* ---------- 8. Sheet layer ---------- */
// sheets: name -> render(props) returning content. openSheet() shows it over
// the current screen, either as a bottom sheet (default) or a right-side
// drawer ({ variant: 'drawer' }). Focus is trapped inside; Esc, a backdrop
// click or props.close() closes it. render() also gets onCleanup(fn) so a
// sheet can cancel its own timers when it is closed early.
const sheets = {};
let sheetReturnFocus = null;
let sheetCleanup = null;
let sheetHideTimer = null;

function openSheet(name, props = {}) {
  const render = sheets[name];
  if (!render) { console.warn(`[sheet] unknown sheet "${name}"`); return; }
  const layer = $('#sheet-layer');
  if (layer.dataset.sheet) closeSheet({ restoreFocus: false });
  clearTimeout(sheetHideTimer);
  sheetReturnFocus = props.returnFocus || document.activeElement;
  const drawer = props.variant === 'drawer';
  const content = render({ ...props, close: () => closeSheet(), onCleanup: (fn) => { sheetCleanup = fn; } });
  const panel = h('div', {
    class: `sheet${drawer ? ' sheet--drawer' : ''}`, role: 'dialog', 'aria-modal': 'true',
    'aria-labelledby': props.labelledBy || null,
    'aria-label': props.labelledBy ? null : (props.label || name),
    tabindex: '-1',
  }, !drawer && h('div', { class: 'sheet__handle', 'aria-hidden': 'true' }), content);
  layer.classList.remove('is-open');
  layer.classList.toggle('sheet-layer--drawer', drawer);
  layer.replaceChildren(h('div', { class: 'sheet-backdrop', onClick: () => closeSheet() }), panel);
  layer.hidden = false;
  layer.dataset.sheet = name;
  $('#screen-root').setAttribute('inert', '');
  requestAnimationFrame(() => requestAnimationFrame(() => layer.classList.add('is-open')));
  panel.focus({ preventScroll: true });
  updateDemoPanel();
}

function closeSheet({ restoreFocus = true } = {}) {
  const layer = $('#sheet-layer');
  if (!layer || !layer.dataset.sheet) return;
  if (sheetCleanup) { sheetCleanup(); sheetCleanup = null; }
  delete layer.dataset.sheet;
  layer.classList.remove('is-open');
  layer.querySelector('.sheet')?.setAttribute('inert', '');
  $('#screen-root').removeAttribute('inert');
  clearTimeout(sheetHideTimer);
  sheetHideTimer = setTimeout(() => { layer.hidden = true; layer.replaceChildren(); }, reducedMotion() ? 0 : TRANSITION_MS);
  if (restoreFocus && sheetReturnFocus && document.contains(sheetReturnFocus)) sheetReturnFocus.focus({ preventScroll: true });
  updateDemoPanel();
}
const isSheetOpen = (name) => $('#sheet-layer')?.dataset.sheet === name;

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { closeSheet(); return; }
  // Focus trap: Tab and Shift+Tab cycle inside the open sheet.
  if (e.key !== 'Tab') return;
  const layer = $('#sheet-layer');
  if (!layer || !layer.dataset.sheet) return;
  const panel = layer.querySelector('.sheet');
  const focusables = [...panel.querySelectorAll('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])')]
    .filter((el) => el.offsetParent !== null);
  if (!focusables.length) { e.preventDefault(); panel.focus(); return; }
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  const active = document.activeElement;
  if (!panel.contains(active)) { e.preventDefault(); first.focus(); }
  else if (e.shiftKey && (active === first || active === panel)) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
});

/* ---------- 9. Mock content (no real AI) ---------- */
const isValidEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v).trim());
// Bakery wording only when the one-liner clearly says so; everyone else gets generic ideas.
const BAKERY_RE = /cake|bakery|cookie|baking/i;
const isBakery = () => BAKERY_RE.test(state.oneLiner || '');
const displayName = () => (state.businessName || '').trim() || 'your business';

function getIdeas() {
  const bakery = isBakery();
  return [
    { id: 'special', icon: 'megaphone', tag: 'Good for driving orders',
      title: bakery ? 'Announce a weekend special' : 'Announce a special offer' },
    { id: 'behind_the_scenes', icon: 'eye', tag: 'Behind the scenes',
      title: bakery ? 'Show how your custom cakes are made' : 'Show how you do what you do' },
    { id: 'review', icon: 'star', tag: 'Builds trust', title: 'Share a happy customer review' },
  ];
}

// "#SweetCrumbs" from "Sweet Crumbs Bakery": trailing category words are dropped
// so the brand tag reads like something a real owner would use.
const TRAILING_GENERIC = ['bakery', 'cafe', 'café', 'shop', 'store', 'studio', 'agency', 'co', 'company', 'inc', 'llc', 'ltd', 'gmbh'];
function brandHashtag(name) {
  const words = String(name || '').replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
  const core = [...words];
  while (core.length > 1 && TRAILING_GENERIC.includes(core[core.length - 1].toLowerCase())) core.pop();
  if (!core.length) return '#SmallBusiness';
  return '#' + core.map((w) => w[0].toUpperCase() + w.slice(1)).join('');
}

// Pre-written captions per idea. Bakery copy for bakeries, generic copy otherwise.
const CAPTIONS = {
  bakery: {
    special: () => ({
      caption: 'This weekend only: our Belgian chocolate truffle cake is back. Soft, rich and baked fresh in small batches. Order by Friday 6 PM to reserve yours.',
      tags: ['#CakeLovers', '#WeekendTreat'] }),
    behind_the_scenes: (name) => ({
      caption: `Ever wondered how a custom cake comes together at ${name}? It starts with a sketch, then fresh sponge, hand-whipped buttercream and a lot of patience. Here's every step.`,
      tags: ['#CakeLovers', '#BehindTheScenes'] }),
    review: (name) => ({
      caption: `"The cake was the star of the party." Messages like this make our week. Thank you for trusting ${name} with your celebrations.`,
      tags: ['#CakeLovers', '#HappyCustomers'] }),
  },
  generic: {
    special: (name) => ({
      caption: `Good news from ${name}: we're running a special offer this week. It's our way of saying thanks for the support. Send us a message to claim yours before it ends.`,
      tags: ['#SpecialOffer', '#SmallBusiness'] }),
    behind_the_scenes: (name) => ({
      caption: `A quick look behind the scenes at ${name}. Most of the work happens in the small details nobody sees, and that's where the quality comes from. Questions? Ask away below.`,
      tags: ['#BehindTheScenes', '#SmallBusiness'] }),
    review: (name) => ({
      caption: `"Friendly, fast and exactly what I needed." Reviews like this keep the ${name} team going. Thank you to everyone who takes a moment to share their experience.`,
      tags: ['#HappyCustomers', '#SmallBusiness'] }),
  },
};

function buildDraft({ source }) {
  const name = displayName();
  const idea = state.selectedIdea || { id: 'special', title: getIdeas()[0].title, source: 'suggested' };
  let copy;
  if (source === 'template') {
    const line = (state.oneLiner || '').trim().replace(/[.!?]+$/, '');
    copy = {
      caption: `Say hello to ${name}.${line ? ` ${line}.` : ''} We'll be sharing news, offers and a look behind the scenes here, so follow along.`,
      tags: ['#SmallBusiness', '#ShopLocal'] };
  } else if (idea.source === 'own_idea') {
    const text = (state.ownIdea || idea.title || '').trim().replace(/[.!?]+$/, '');
    copy = {
      caption: `Something new from ${name}: ${text}. We'd love to hear what you think, so tell us in the comments.`,
      tags: [isBakery() ? '#CakeLovers' : '#SmallBusiness', '#ShopLocal'] };
  } else {
    const set = isBakery() ? CAPTIONS.bakery : CAPTIONS.generic;
    copy = (set[idea.id] || set.special)(name);
  }
  // Voice words picked earlier are applied to every new first draft.
  const rawCaption = copy.caption;
  const voice = state.voiceWords.length ? [...state.voiceWords] : [];
  const caption = voice.length ? applyVoice(rawCaption, voice, state.voiceSample) : rawCaption;
  return {
    caption,                    // what the user sees right now
    hashtags: [brandHashtag(state.businessName), ...copy.tags],
    source: source === 'template' ? 'template' : idea.source,
    channel: state.channel,
    latencyMs: state.generationStartedAt ? Date.now() - state.generationStartedAt : null,
    ideaId: idea.id,
    ideaTitle: idea.title,
    createdAt: Date.now(),
    // Result-screen bookkeeping
    rawCaption,                 // version 0 as written, before any voice
    baseCaption: caption,       // current text before a tone chip is applied
    version: 0,                 // index into versionsFor(draft)
    tone: null,                 // active tone chip id
    toneVariant: 0,
    voice,                      // voice words applied to this caption
    undo: voice.length ? { caption: rawCaption, baseCaption: rawCaption, tone: null, toneVariant: 0, voice: [] } : null,
    toneChipUsed: 0,            // tone chip taps
    regenerations: 0,           // "Try another version" taps
    voiceFixOpened: false,      // recovery drawer opened for this draft
    savedAt: null,
    usefulness: null,           // 'yes_as_is' | 'yes_with_edits' | 'no'
  };
}
/* ---------- 9b. Post writing: versions, tone chips, brand voice ---------- */
// Everything "smart" on the result screen is plain string work on
// pre-written copy. Nothing here calls a model.

function updateDraft(patch) { if (state.draft) setState({ draft: { ...state.draft, ...patch } }); }
const trimEnd = (s) => String(s || '').trim().replace(/[.!?]+$/, '');

// "Try another version" cycles through [first draft, alt 1, alt 2].
const ALT_VERSIONS = {
  bakery: {
    special: [
      () => 'Our Belgian chocolate truffle cake returns this weekend, every bit as rich as you remember. Small batches only, so order by Friday 6 PM.',
      () => 'Weekend plans: cake. Our Belgian chocolate truffle cake is back for two days only. Reserve yours by Friday 6 PM before the batch sells out.',
    ],
    behind_the_scenes: [
      (n) => `From sketch to sponge to the final swirl of buttercream, this is how every custom cake at ${n} gets made. No shortcuts, just patience.`,
      (n) => `Most people only see the finished cake. Today we're showing you the sketching, baking and decorating behind every custom order at ${n}.`,
    ],
    review: [
      (n) => `Nothing beats a message like this after a big celebration. Thank you for choosing ${n} and for letting our cake be part of your day.`,
      (n) => `"Everyone asked where the cake was from." We love hearing that. Thank you to every customer who trusts ${n} with their special moments.`,
    ],
  },
  generic: {
    special: [
      (n) => `This week only at ${n}: a special offer for our community. Message us to find out more before it ends.`,
      (n) => `Thank you for supporting ${n}. To say it properly, we're running a special offer this week. Get in touch to claim it.`,
    ],
    behind_the_scenes: [
      (n) => `Ever wondered what a normal day at ${n} looks like? Here's a peek at the work that goes on behind the scenes.`,
      (n) => `The best part of ${n} is the part you don't usually see. Today we're showing you how we really work.`,
    ],
    review: [
      (n) => `Kind words from a happy customer made our week. Thank you for trusting ${n}, it means a lot to the whole team.`,
      (n) => `We never take reviews for granted. Thank you to everyone who has shared their experience with ${n}.`,
    ],
  },
  own_idea: [
    (n, idea) => `Big news from ${n}: ${idea}. Let us know what you think below.`,
    (n, idea) => `Here's what's new at ${n}: ${idea}. Questions? Drop them in the comments.`,
  ],
  template: [
    (n, line) => `Welcome to ${n}.${line ? ` ${line}.` : ''} Follow along for updates, offers and stories from behind the scenes.`,
    (n, line) => `New here? We're ${n}.${line ? ` ${line}.` : ''} Stick around for news and offers.`,
  ],
};

function versionsFor(draft) {
  let alts;
  if (draft.source === 'template') alts = ALT_VERSIONS.template;
  else if (draft.ideaId === 'own_idea') alts = ALT_VERSIONS.own_idea;
  else {
    const set = isBakery() ? ALT_VERSIONS.bakery : ALT_VERSIONS.generic;
    alts = set[draft.ideaId] || set.special;
  }
  const extra = draft.source === 'template' ? trimEnd(state.oneLiner) : trimEnd(draft.ideaTitle);
  return [draft.rawCaption, ...alts.map((fn) => fn(displayName(), extra))];
}

// Sentence split that keeps a closing quote with its sentence.
function splitSentences(text) {
  return (String(text).match(/[^.!?]+[.!?]+["”]?|[^.!?]+$/g) || []).map((s) => s.trim()).filter(Boolean);
}

// Regex swaps that keep a capital letter at the start of a sentence.
function swapWords(text, pairs) {
  return pairs.reduce((out, [re, rep]) => out.replace(re, (m, ...groups) => {
    const r = rep.replace(/\$(\d)/g, (_, i) => groups[i - 1]);
    return /^[A-Z]/.test(m) ? r[0].toUpperCase() + r.slice(1) : r;
  }), text);
}
// Order matters: can't/won't before the generic n't rule.
const EXPAND = [
  [/\bcan't\b/gi, 'cannot'], [/\bwon't\b/gi, 'will not'], [/\b(\w+)n't\b/gi, '$1 not'],
  [/\b(we|you|they)'re\b/gi, '$1 are'], [/\b(it|that|there|here|what)'s\b/gi, '$1 is'],
  [/\b(I|we|you|they)'ll\b/gi, '$1 will'], [/\b(I|we|you|they)'ve\b/gi, '$1 have'],
  [/\b(I|we|you|they)'d\b/gi, '$1 would'], [/\bI'm\b/g, 'I am'], [/\blet's\b/gi, 'let us'],
];
const CONTRACT = [
  [/\bwe are\b/gi, "we're"], [/\bit is\b/gi, "it's"], [/\bdo not\b/gi, "don't"], [/\bwe will\b/gi, "we'll"],
  [/\byou are\b/gi, "you're"], [/\bthat is\b/gi, "that's"], [/\bwe have\b/gi, "we've"],
];
const formalize = (t) => swapWords(t, EXPAND).replace(/!/g, '.');
const casualize = (t) => swapWords(t, CONTRACT);

// Tone chips. The default bakery caption has two hand-written variants per
// chip (tapping the same chip again flips between them). Any other caption
// gets a simple, predictable transform of the untoned text.
const DEFAULT_BAKERY_CAPTION = 'This weekend only: our Belgian chocolate truffle cake is back. Soft, rich and baked fresh in small batches. Order by Friday 6 PM to reserve yours.';
const BAKERY_TONE_VARIANTS = {
  shorter: [
    'This weekend only: our Belgian chocolate truffle cake is back. Order by Friday 6 PM.',
    'Belgian chocolate truffle cake, this weekend only. Reserve yours by Friday 6 PM.',
  ],
  warmer: [
    "Good news, friends: our Belgian chocolate truffle cake is back this weekend. It's soft, rich and baked fresh in small batches, just the way you love it. Order by Friday 6 PM so we can save one for you.",
    "We've missed this one as much as you have. Our Belgian chocolate truffle cake is back this weekend, baked fresh in small batches. Order by Friday 6 PM and we'll have yours ready. Thank you for always supporting us.",
  ],
  playful: [
    'Cancel your weekend plans (well, maybe not all of them). Our Belgian chocolate truffle cake is back! Soft, rich and baked in tiny batches, so order by Friday 6 PM before it vanishes.',
    'Plot twist: the Belgian chocolate truffle cake is back this weekend! Soft, rich and gone fast. Order by Friday 6 PM and claim your slice of the action.',
  ],
  formal: [
    'We are pleased to announce that our Belgian chocolate truffle cake returns this weekend. Each cake is baked fresh in small batches. Orders close on Friday at 6 PM.',
    'Our Belgian chocolate truffle cake is available this weekend only. Baked fresh in limited batches, it may be reserved until Friday at 6 PM.',
  ],
};
const WARM_OPENER = 'Hi friends!';
const WARM_THANKS = 'Thank you for always supporting us.';
const PLAYFUL_LINE = 'You heard it here first!';

function applyTone(base, tone, variant = 0) {
  if (!tone) return base;
  if (base === DEFAULT_BAKERY_CAPTION) return BAKERY_TONE_VARIANTS[tone][variant % 2];
  const s = splitSentences(base);
  if (!s.length) return base;
  if (tone === 'shorter') return s.slice(0, 2).join(' ');
  if (tone === 'warmer') return [base.startsWith(WARM_OPENER) ? null : WARM_OPENER, ...s, WARM_THANKS].filter(Boolean).join(' ');
  if (tone === 'playful') { s[0] = s[0].replace(/[.?]$/, '!'); return [...s, PLAYFUL_LINE].join(' '); }
  if (tone === 'formal') return formalize(base);
  return base;
}

// Brand voice: each word maps to a small style. Several words combine: the
// first word with an opener/closer wins, "short" and "formal" are flags.
const VOICE_STYLES = {
  Friendly: { opener: 'Hi friends!', closer: "We'd love to see you soon." },
  Warm: { closer: 'Thank you for being part of our story.' },
  Playful: { exclaim: true, closer: 'You heard it here first!' },
  Professional: { formal: true, closer: 'Get in touch through the link in our bio.' },
  Bold: { short: true, opener: 'Big news.', closer: "Don't miss it." },
  Minimal: { short: true, bare: true },
  Luxury: { formal: true, opener: 'Crafted with care.', closer: 'Available in limited numbers.' },
  Casual: { casual: true, opener: 'Quick heads up:', closer: 'See you around.' },
};

// What we borrow from a pasted caption: sentence length and punctuation habits.
function readSample(sample) {
  const t = String(sample || '').trim();
  if (!t) return null;
  const count = Math.max(splitSentences(t).length, 1);
  return {
    avgWords: t.split(/\s+/).length / count,
    exclaims: t.includes('!'),
    ellipsis: /\.\.\.|…/.test(t),
    lowercase: /[a-z]/.test(t) && t === t.toLowerCase(),
  };
}

function applyVoice(text, words, sample) {
  const styles = words.map((w) => VOICE_STYLES[w]).filter(Boolean);
  const has = (k) => styles.some((st) => st[k]);
  const style = readSample(sample);
  let s = splitSentences(text);
  if (!s.length) return text;
  // Short voices, or someone who writes in short sentences, get the first two sentences.
  if (has('short') || (style && style.avgWords <= 9)) s = s.slice(0, 2);
  if (has('exclaim')) s[0] = s[0].replace(/\.$/, '!');
  if (!has('bare')) {
    const opener = styles.find((st) => st.opener)?.opener;
    const closer = styles.find((st) => st.closer)?.closer;
    if (opener && opener.endsWith(':')) s[0] = `${opener} ${s[0][0].toLowerCase()}${s[0].slice(1)}`;
    else if (opener) s.unshift(opener);
    if (closer) s.push(closer);
  }
  let out = s.join(' ');
  if (has('formal')) out = formalize(out);
  else if (has('casual')) out = casualize(out);
  // The pasted caption is the best evidence of how they really write, so it goes last.
  if (style) {
    if (!style.exclaims) out = out.replace(/!/g, '.');
    else if (!out.includes('!')) out = out.replace(/\.$/, '!');
    if (style.ellipsis) out = out.replace(/[.!]$/, '...');
    if (style.lowercase) out = out.toLowerCase();
  }
  return out;
}

// Snapshot used by Undo: everything needed to put the caption back.
const captionSnapshot = (d) => ({ caption: d.caption, baseCaption: d.baseCaption, tone: d.tone, toneVariant: d.toneVariant, voice: d.voice });

function applyVoiceRewrite(words, sampleText) {
  const d = state.draft;
  if (!d) return;
  // Rewrite from the pre-voice caption so two rewrites don't stack openers.
  const before = d.voice.length && d.undo ? d.undo : captionSnapshot(d);
  const rewritten = applyVoice(before.caption, words, sampleText);
  setState({
    voiceWords: words,
    voiceSample: sampleText,
    draft: { ...d, caption: rewritten, baseCaption: rewritten, tone: null, toneVariant: 0, voice: words, undo: before },
  });
}


/* ---------- 10. Screens ---------- */

/* signup (W1) */
function renderSignup() {
  // signupAt is set once: going back and leaving again shouldn't reset the clock.
  const leave = () => {
    if (!state.signupAt) setState({ signupAt: Date.now() });
    navigate('setup');
  };
  const create = Button({ label: 'Create account', type: 'submit', disabled: !isValidEmail(state.email) });
  const email = Field({
    id: 'email', label: 'Work email', required: true, type: 'email',
    placeholder: 'you@yourbusiness.com', value: state.email, autocomplete: 'email', inputmode: 'email',
    validate: (v) => (isValidEmail(v) ? '' : v.trim() ? 'Check your email. It should look like name@business.com' : 'Enter your work email to continue'),
    onInput: (v) => { setState({ email: v.trim() }); create.disabled = !isValidEmail(v); },
  });
  const form = h('form', { class: 'stack', novalidate: true, onSubmit: (e) => {
    e.preventDefault();
    if (!email.isValid()) { email.touch(); return; }
    leave();
  } }, email.el, create);

  return Screen({
    name: 'signup',
    body: [
      h('div', { class: 'brand' }, h('span', { class: 'brand__mark' }, icon('sparkle'))),
      Title('Your first post in under 2 minutes'),
      Subtitle('Free to start. No card needed.'),
      h('div', { class: 'stack', style: 'margin-top:28px' },
        Button({ label: 'Continue with Google', variant: 'secondary', icon: 'google', onClick: leave }),
        h('div', { class: 'divider', role: 'separator' }, 'or'),
        form,
        Button({ label: 'Already have an account? Log in', variant: 'link', className: 'signup__login', onClick: outOfScope })),
    ],
    after: h('p', { class: 'legal' },
      'By continuing you accept the ', h('button', { type: 'button', class: 'text-btn', onClick: outOfScope }, 'Terms'),
      ' and ', h('button', { type: 'button', class: 'text-btn', onClick: outOfScope }, 'Privacy Policy'), '.'),
  });
}

/* setup (W2) */
function renderSetup() {
  const cta = Button({ label: 'Show me post ideas', onClick: onContinue });
  const sync = () => { cta.disabled = !(name.isValid() && oneLiner.isValid()); };

  const name = Field({
    id: 'businessName', label: 'Business name', required: true, value: state.businessName, autocomplete: 'organization',
    validate: (v) => (v.trim().length >= 2 ? '' : 'Business name needs at least 2 characters'),
    onInput: (v) => { setState({ businessName: v }); sync(); },
  });
  const examples = h('div', { class: 'chip-row', role: 'group', 'aria-label': 'Examples' },
    ONE_LINER_EXAMPLES.map((ex) => Chip({ label: ex, keepFocus: true, onClick: () => oneLiner.setValue(ex) })));
  const oneLiner = Field({
    id: 'oneLiner', label: 'What do you do, in one line?', required: true, value: state.oneLiner,
    validate: (v) => (v.trim().length >= 10 ? '' : 'Add a little more, at least 10 characters'),
    onInput: (v) => { setState({ oneLiner: v }); sync(); },
    after: examples,
  });
  const link = Field({
    id: 'link', label: 'Website or Instagram link', type: 'url', inputmode: 'url', autocomplete: 'url',
    placeholder: "Paste a link and we'll learn your style", value: state.link,
    onInput: (v) => setState({ link: v }),
  });
  sync();

  function onContinue() {
    if (!(name.isValid() && oneLiner.isValid())) { name.touch(); oneLiner.touch(); return; }
    setState({ businessName: name.value().trim(), oneLiner: oneLiner.value().trim(), link: link.value().trim() });
    trackOnce('setup_completed', {
      optional_fields_filled: state.link ? 1 : 0, // only one optional field on this screen
      seconds_since_signup: secondsSinceSignup(),
    });
    navigate('ideas');
  }

  return Screen({
    name: 'setup',
    header: ScreenHeader({ back: 'signup', progress: { step: 1, total: 2 } }),
    body: [
      Title('Tell us about your business'),
      Subtitle('Two quick answers. Add the rest later.'),
      h('div', { class: 'setup__fields' }, name.el, oneLiner.el, link.el),
    ],
    footer: [cta, Button({ label: 'Skip optional fields', variant: 'link', className: 'footer-link', onClick: () => toast('Optional fields skipped') })],
  });
}

/* ideas (W3) */
function renderIdeas() {
  const pick = (idea) => {
    setState({ selectedIdea: { id: idea.id, title: idea.title, tag: idea.tag, source: 'suggested' }, draft: null });
    navigate('generating');
  };

  // Channel sits above the cards: tapping a card starts writing immediately,
  // so the channel has to be chosen before that tap, not after.
  const channel = h('div', { class: 'ideas__channel' },
    h('div', { class: 'section-label', id: 'post-for-label' }, 'Post for', Tag('optional')),
    ChipGroup({ options: CHANNELS, value: state.channel, labelledBy: 'post-for-label', onChange: (id) => setState({ channel: id }) }));

  const cards = h('div', { class: 'ideas__list' }, getIdeas().map((idea) =>
    h('button', { type: 'button', class: 'idea-card', 'data-idea': idea.id, onClick: () => pick(idea) },
      h('span', { class: 'idea-card__icon' }, icon(idea.icon)),
      h('span', { class: 'idea-card__text' },
        h('span', { class: 'idea-card__title' }, idea.title),
        h('span', { class: 'idea-card__tag' }, idea.tag)),
      icon('chev', 'idea-card__chev'))));

  // "Write my own idea" disclosure
  const ownInput = h('textarea', { id: 'own-idea-input', class: 'field__control', rows: 3, 'aria-labelledby': 'own-idea-toggle' });
  ownInput.value = state.ownIdea;
  const createBtn = Button({ label: 'Create post', disabled: !state.ownIdea.trim(), onClick: () => {
    const text = ownInput.value.trim();
    if (!text) return;
    setState({ ownIdea: text, selectedIdea: { id: 'own_idea', title: text, tag: null, source: 'own_idea' }, draft: null });
    navigate('generating');
  } });
  ownInput.addEventListener('input', () => { setState({ ownIdea: ownInput.value }); createBtn.disabled = !ownInput.value.trim(); });
  const panel = h('div', { class: 'own-idea__panel', id: 'own-idea-panel', hidden: !state.ownIdea.trim() }, ownInput, createBtn);
  const toggle = h('button', {
    type: 'button', class: 'btn btn--link own-idea__toggle', id: 'own-idea-toggle',
    'aria-expanded': String(!panel.hidden), 'aria-controls': 'own-idea-panel',
    onClick: () => {
      panel.hidden = !panel.hidden;
      toggle.setAttribute('aria-expanded', String(!panel.hidden));
      if (!panel.hidden) ownInput.focus();
    },
  }, icon('pencil'), h('span', null, 'Write my own idea'), Tag('optional'), icon('chev', 'icon--chev'));

  return Screen({
    name: 'ideas',
    header: ScreenHeader({ back: 'setup', progress: { step: 2, total: 2 } }),
    body: [
      Title('Pick a first post to create'),
      Subtitle(`Ideas for ${displayName()}. Tap one and we'll write it.`),
      channel,
      cards,
      h('p', { class: 'helper ideas__helper' }, 'Tapping an idea starts writing right away.'),
      h('div', { class: 'own-idea' }, toggle, panel),
    ],
  });
}

/* generating (W4 + failure state 4b) */
function renderGenerating() {
  const items = GEN_STEPS.map((label) => h('li', { class: 'check-item' },
    h('span', { class: 'check-item__mark' }, icon('check')), h('span', null, label)));
  const checklist = h('ol', { class: 'card gen__checklist', 'aria-label': 'Progress' }, items);
  const status = h('p', { class: 'visually-hidden', 'aria-live': 'polite' });
  const failBox = h('div', { class: 'fail-box', role: 'alert', hidden: true });
  const skeleton = h('div', { class: 'card skeleton', 'aria-hidden': 'true' },
    h('div', { class: 'skeleton__head' }, h('div', { class: 'sk sk--avatar' }),
      h('div', { class: 'skeleton__lines' }, h('div', { class: 'sk sk--line', style: 'width:45%' }), h('div', { class: 'sk sk--line', style: 'width:28%' }))),
    h('div', { class: 'sk sk--media' }),
    h('div', { class: 'sk sk--line', style: 'width:92%' }), h('div', { class: 'sk sk--line', style: 'width:78%' }), h('div', { class: 'sk sk--line', style: 'width:54%' }));
  const title = Title('Writing your post…');

  const setStep = (i, cls) => { items[i].classList.remove('is-active', 'is-done'); if (cls) items[i].classList.add(cls); };

  function run() {
    clearScreenTimers();
    failBox.hidden = true;
    failBox.replaceChildren();
    skeleton.classList.remove('is-stalled');
    items.forEach((_, i) => setStep(i, i === 0 ? 'is-active' : null));
    setState({ generationStartedAt: Date.now() });
    // Read once per attempt, so flipping the toggle mid-run applies to the next try.
    const willFail = isFailMode();

    STEP_DONE_AT.forEach((ms, i) => {
      const isLast = i === GEN_STEPS.length - 1;
      if (isLast && willFail) return; // the last line hangs: that's the "slow" signal
      later(() => {
        setStep(i, 'is-done');
        status.textContent = `${GEN_STEPS[i]}, done`;
        if (!isLast) setStep(i + 1, 'is-active');
      }, ms);
    });
    later(willFail ? showFailure : finish, GENERATION_MS);
  }

  function finish() {
    setState({ draft: buildDraft({ source: 'suggested' }) });
    navigate('result');
  }

  function showFailure() {
    skeleton.classList.add('is-stalled');
    failBox.replaceChildren(
      h('p', { class: 'fail-box__title' }, icon('clock'), 'This is taking longer than usual.'),
      h('div', { class: 'fail-box__actions' },
        Button({ label: 'Try again', onClick: () => { title.focus(); run(); } }),
        Button({ label: 'Use a ready template', variant: 'secondary', onClick: () => {
          setState({ draft: buildDraft({ source: 'template' }) });
          navigate('result');
        } })));
    failBox.hidden = false;
  }

  const el = Screen({
    name: 'generating',
    header: ScreenHeader(),
    body: [title, Subtitle('Usually under 10 seconds.'), checklist, status, failBox, skeleton],
  });
  // Start after the element exists; timers are owned by this screen via later().
  setTimeout(run, 0);
  return el;
}

/* Shared bits for result + saved */
const imageLabel = () => (isBakery() ? 'Image: chocolate cake (placeholder)' : 'Image: your photo (placeholder)');
const channelLabel = (id) => (CHANNELS.find((c) => c.id === id) || CHANNELS[0]).label;
const initialsOf = (name) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');

// Looks like a social post: who + channel, striped image placeholder,
// fake like/comment icons, caption, hashtags in indigo.
function PostPreview({ draft, captionEl, tagsEl, compact = false }) {
  const channel = channelLabel(draft.channel);
  return h('article', { class: `card post${compact ? ' post--compact' : ''}`, 'aria-label': `${channel} post preview` },
    h('header', { class: 'post__head' },
      h('span', { class: 'post__avatar', 'aria-hidden': 'true' }, initialsOf(displayName())),
      h('span', { class: 'post__who' }, h('strong', null, displayName()), h('span', { class: 'post__channel' }, channel))),
    h('div', { class: 'post__media', role: 'img', 'aria-label': imageLabel() },
      h('span', { class: 'post__media-label', 'aria-hidden': 'true' }, imageLabel())),
    !compact && h('div', { class: 'post__icons', 'aria-hidden': 'true' },
      icon('heart'), icon('comment'), icon('send'), h('span', { class: 'post__spacer' }), icon('bookmark')),
    h('div', { class: 'post__body' }, captionEl, tagsEl));
}

// Only reachable via ?screen= or a reset mid-flow; the demo panel builds a draft first.
function NoDraftScreen(name) {
  return Screen({
    name,
    header: ScreenHeader({ back: 'ideas' }),
    body: [Title('No post yet'), Subtitle('Pick an idea first and we will write it.'),
      h('div', { style: 'margin-top:24px;max-width:320px' }, Button({ label: 'Pick an idea', onClick: () => navigate('ideas') }))],
  });
}

/* result (W5) */
let resultView = null; // lets the recovery drawer repaint the post without re-rendering the screen

function renderResult() {
  const draft = state.draft;
  if (!draft) return NoDraftScreen('result');
  // "Generated" means the user actually sees the draft, so it fires here, not in generating.
  trackOnce('first_post_generated', { source: draft.source, latency_ms: draft.latencyMs, channel: draft.channel });

  const captionEl = h('p', { class: 'post__caption', id: 'post-caption', tabindex: '-1', 'aria-live': 'polite' });
  const tagsEl = h('p', { class: 'post__tags' });
  const voiceRow = h('div', { class: 'voice-row' });
  const toneChips = TONES.map((t) => {
    const chip = Chip({ label: t.label, onClick: () => onTone(t.id) });
    chip.dataset.tone = t.id;
    return chip;
  });

  function paint({ flash = false, focusUndo = false } = {}) {
    const d = state.draft;
    if (!d) return;
    captionEl.textContent = d.caption;
    tagsEl.textContent = d.hashtags.join(' ');
    toneChips.forEach((c) => setChipSelected(c, c.dataset.tone === d.tone));
    voiceRow.replaceChildren();
    if (d.voice.length) {
      voiceRow.append(h('span', { class: 'tag tag--voice' }, `Voice: ${d.voice.join(', ')}`));
      if (d.undo) voiceRow.append(Button({ label: 'Undo', variant: 'link', className: 'voice-row__undo', onClick: onUndo }));
    }
    if (flash) replayAnimation(captionEl, 'is-updated');
    if (focusUndo) voiceRow.querySelector('button')?.focus();
  }

  function onTone(id) {
    const d = state.draft;
    let tone = id;
    let variant = 0;
    if (d.tone === id) {
      // Same chip again: the bakery default flips to its second variant, anything else switches off.
      if (d.baseCaption === DEFAULT_BAKERY_CAPTION) variant = (d.toneVariant + 1) % 2;
      else tone = null;
    }
    updateDraft({ tone, toneVariant: variant, caption: applyTone(d.baseCaption, tone, variant), toneChipUsed: d.toneChipUsed + 1 });
    paint({ flash: true });
  }

  function onRegenerate() {
    const d = state.draft;
    const versions = versionsFor(d);
    const version = (d.version + 1) % versions.length;
    const raw = versions[version];
    // Keep the chosen brand voice on every new version.
    const base = d.voice.length ? applyVoice(raw, d.voice, state.voiceSample) : raw;
    updateDraft({
      version, caption: base, baseCaption: base, tone: null, toneVariant: 0,
      undo: d.voice.length ? { caption: raw, baseCaption: raw, tone: null, toneVariant: 0, voice: [] } : null,
      regenerations: d.regenerations + 1,
    });
    paint({ flash: true });
  }

  function onUndo() {
    const { undo } = state.draft;
    if (!undo) return;
    updateDraft({ ...undo, undo: null });
    paint({ flash: true });
    captionEl.focus();
  }

  async function onCopy() {
    const d = state.draft;
    const ok = await copyText(`${d.caption}\n\n${d.hashtags.join(' ')}`);
    toast(ok ? 'Copied' : "Couldn't copy. Select the caption and copy it by hand.");
  }

  function onSave() {
    const d = state.draft;
    updateDraft({ savedAt: d.savedAt || Date.now() });
    trackOnce('first_post_saved', {
      tone_chip_used: d.toneChipUsed,
      voice_fix_opened: d.voiceFixOpened,
      regenerations: d.regenerations,
      seconds_since_signup: secondsSinceSignup(),
    });
    navigate('saved');
  }

  const panel = h('div', { class: 'card panel' },
    h('section', { class: 'panel__section' },
      h('h2', { class: 'panel__q', id: 'brand-q' }, 'Does this sound like your brand?'),
      h('div', { class: 'btn-row' },
        Button({ label: 'Yes, looks good', variant: 'secondary', onClick: () => toast('Great. Hit Save post to keep it.') }),
        Button({ label: 'Not quite', variant: 'secondary', onClick: (e) => openRecovery(e.currentTarget) }))),
    h('section', { class: 'panel__section' },
      h('div', { class: 'section-label', id: 'tone-label' }, 'Tone', Tag('optional')),
      h('div', { class: 'chip-row', role: 'group', 'aria-labelledby': 'tone-label' }, toneChips)),
    h('div', { class: 'panel__actions' },
      Button({ label: 'Save post', onClick: onSave }),
      h('div', { class: 'link-row' },
        Button({ label: 'Copy caption', variant: 'link', icon: 'copy', onClick: onCopy }),
        Button({ label: 'Try another version', variant: 'link', icon: 'refresh', onClick: onRegenerate }))));

  const el = Screen({
    name: 'result',
    header: ScreenHeader({ back: 'ideas' }),
    body: [
      Title("Here's your first post"),
      h('div', { class: 'two-col' },
        h('div', { class: 'col' }, PostPreview({ draft, captionEl, tagsEl }), voiceRow),
        h('div', { class: 'col' }, panel)),
    ],
  });
  resultView = { paint };
  paint();
  return el;
}

function openRecovery(opener) {
  if (!state.draft) return;
  updateDraft({ voiceFixOpened: true });
  track('voice_fix_opened', {});
  openSheet('recovery', { variant: 'drawer', labelledBy: 'recovery-title', returnFocus: opener });
}

/* Recovery drawer (WR) */
sheets.recovery = function renderRecovery({ close, onCleanup }) {
  let picked = state.voiceWords.filter((w) => VOICE_WORDS.includes(w)).slice(0, MAX_VOICE_WORDS);
  let timer = null;
  const pickTag = Tag('pick', 'Pick 1 to 3');
  const hint = h('p', { class: 'visually-hidden', 'aria-live': 'polite' });
  const chips = VOICE_WORDS.map((word) => {
    const chip = Chip({ label: word, selected: picked.includes(word), onClick: () => toggle(word, chip) });
    return chip;
  });
  const sample = Field({
    id: 'voice-sample', label: "Paste a caption you've written before", multiline: true, rows: 4,
    placeholder: 'e.g. one of your best Instagram captions', value: state.voiceSample,
  });
  const rewrite = Button({ label: 'Rewrite my post', disabled: !picked.length, onClick: onRewrite });
  const cancel = Button({ label: 'Cancel', variant: 'link', className: 'drawer__cancel', onClick: close });

  function toggle(word, chip) {
    if (timer) return; // locked while rewriting
    if (picked.includes(word)) {
      picked = picked.filter((w) => w !== word);
    } else if (picked.length >= MAX_VOICE_WORDS) {
      // A 4th pick is ignored; the shake and the tag pulse say why.
      replayAnimation(chip, 'shake');
      replayAnimation(pickTag, 'pulse');
      hint.textContent = 'You can pick up to 3 words.';
      return;
    } else {
      picked = [...picked, word];
    }
    hint.textContent = '';
    setChipSelected(chip, picked.includes(word));
    rewrite.disabled = !picked.length;
  }

  function onRewrite() {
    if (!picked.length || timer) return;
    const words = [...picked];
    const sampleText = sample.value().trim();
    rewrite.disabled = true;
    rewrite.querySelector('.btn__label').textContent = 'Rewriting…';
    rewrite.prepend(h('span', { class: 'spinner', 'aria-hidden': 'true' }));
    body.setAttribute('aria-busy', 'true');
    chips.forEach((c) => c.setAttribute('aria-disabled', 'true'));
    sample.control.readOnly = true;
    timer = setTimeout(() => {
      timer = null;
      applyVoiceRewrite(words, sampleText);
      close();
      if (currentScreen === 'result' && resultView) resultView.paint({ flash: true, focusUndo: true });
    }, REWRITE_MS);
  }
  // Closing mid-rewrite (Esc, backdrop, Cancel) cancels it.
  onCleanup(() => clearTimeout(timer));

  const body = h('div', { class: 'drawer' },
    h('h2', { class: 'drawer__title', id: 'recovery-title' }, "Let's make it sound like you"),
    Subtitle('Pick up to 3 words that describe your brand.'),
    h('div', { class: 'drawer__group' },
      h('div', { class: 'section-label', id: 'voice-label' }, 'Brand voice', pickTag),
      h('div', { class: 'chip-row', role: 'group', 'aria-labelledby': 'voice-label' }, chips),
      hint),
    sample.el,
    h('div', { class: 'drawer__actions' }, rewrite, cancel));
  return body;
};

/* saved (W6) */
function renderSaved() {
  const d = state.draft;
  if (!d) return NoDraftScreen('saved');

  const thanks = h('p', { class: 'rating__thanks', role: 'status' });
  const rateBtns = USEFULNESS.map((o) => h('button', {
    type: 'button', class: 'btn btn--secondary rate-btn', 'data-value': o.value, onClick: () => rate(o.value),
  }, o.label));
  function paintRating() {
    const chosen = state.draft.usefulness;
    rateBtns.forEach((b) => {
      const on = b.dataset.value === chosen;
      b.classList.toggle('is-chosen', on);
      b.setAttribute('aria-pressed', String(on));
      // aria-disabled rather than disabled, so keyboard focus isn't thrown away on click.
      if (chosen) b.setAttribute('aria-disabled', 'true');
    });
    thanks.textContent = chosen ? 'Thanks, noted' : '';
  }
  function rate(value) {
    if (state.draft.usefulness) return; // one answer per post
    updateDraft({ usefulness: value });
    track('post_usefulness_rated', { value });
    paintRating();
  }
  paintRating();

  const fill = h('div', { class: 'progress__fill', style: 'width:0%' });
  requestAnimationFrame(() => requestAnimationFrame(() => { fill.style.width = `${PROFILE_PROGRESS}%`; }));

  const left = h('div', { class: 'col' },
    h('div', { class: 'saved__head' }, h('span', { class: 'saved__badge', 'aria-hidden': 'true' }, icon('check')), Title('Post saved to your library')),
    PostPreview({ draft: d, compact: true, captionEl: h('p', { class: 'post__caption' }, d.caption), tagsEl: h('p', { class: 'post__tags' }, d.hashtags.join(' ')) }),
    h('section', { class: 'card panel rating' },
      h('h2', { class: 'panel__q', id: 'rating-q' }, 'Quick check: would you post this?'),
      h('div', { class: 'rating__row', role: 'group', 'aria-labelledby': 'rating-q' }, rateBtns),
      thanks));

  const right = h('div', { class: 'col' },
    h('section', { class: 'card panel profile', 'aria-labelledby': 'profile-title' },
      h('div', { class: 'profile__head' }, h('h2', { class: 'panel__q', id: 'profile-title' }, 'Make every post sound like you'), Tag('optional', 'All optional')),
      h('div', { class: 'meter' },
        h('div', { class: 'progress__track', role: 'progressbar', 'aria-label': 'Brand profile', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(PROFILE_PROGRESS) }, fill),
        h('span', { class: 'meter__pct' }, `${PROFILE_PROGRESS}%`)),
      h('ul', { class: 'profile__list' }, PROFILE_ITEMS.map((label) => h('li', null,
        h('button', { type: 'button', class: 'profile__item', onClick: outOfScope }, icon('plus'), h('span', null, label), icon('chev', 'profile__chev')))))),
    h('div', { class: 'saved__actions' },
      Button({ label: 'Create another post', onClick: createAnother }),
      Button({ label: 'Do this later', variant: 'link', className: 'footer-link', onClick: outOfScope })));

  return Screen({ name: 'saved', header: ScreenHeader({ back: 'result' }), body: h('div', { class: 'two-col two-col--saved' }, left, right) });
}

// Keeps the business profile and voice words; only the post itself starts over.
function createAnother() {
  setState({ selectedIdea: null, ownIdea: '', draft: null });
  navigate('ideas');
}

/* ---------- 11. Demo panel ---------- */
// Desktop: sits right of the phone, collapsible. Phone: slides up from the
// bottom, opened by the floating "i" button.
let demoRefs = null;

function renderDemoPanel() {
  const panel = $('#demo-panel');
  const fab = $('#demo-fab');

  const failToggle = h('input', { type: 'checkbox', role: 'switch', id: 'demo-fail' });
  failToggle.addEventListener('change', () => setFailMode(failToggle.checked));
  const jumps = h('div', { class: 'demo__jumps' });
  const log = h('ol', { class: 'log', 'aria-live': 'polite' });
  const count = h('span', null);
  const funnel = h('ol', { class: 'funnel' });
  const timings = h('div', { class: 'timings' });
  const keyEvents = h('ul', { class: 'key-events' });

  const collapseBtn = Button({ variant: 'icon', icon: 'collapse', ariaLabel: 'Collapse demo panel', className: 'demo__collapse', onClick: () => {
    const collapsed = panel.classList.toggle('is-collapsed');
    collapseBtn.setAttribute('aria-label', collapsed ? 'Expand demo panel' : 'Collapse demo panel');
    collapseBtn.setAttribute('aria-expanded', String(!collapsed));
  } });
  collapseBtn.setAttribute('aria-expanded', 'true');
  const closeMobile = () => { panel.classList.remove('is-open'); fab.setAttribute('aria-expanded', 'false'); fab.focus(); };
  const closeBtn = Button({ variant: 'icon', icon: 'close', ariaLabel: 'Close demo panel', className: 'demo__close', onClick: closeMobile });

  panel.replaceChildren(
    h('div', { class: 'demo__header' }, h('h2', { class: 'demo__title' }, h('span', { class: 'demo__dot' }), 'Demo panel'), collapseBtn, closeBtn),
    h('div', { class: 'demo__body' },
      h('section', { class: 'demo__section' }, h('h3', { class: 'demo__h' }, 'Jump to screen'), jumps),
      h('section', { class: 'demo__section' },
        h('h3', { class: 'demo__h' }, 'Controls'),
        h('label', { class: 'switch', for: 'demo-fail' }, h('span', null, 'Simulate slow or failed draft'), failToggle),
        h('div', { class: 'demo__buttons' },
          Button({ label: 'Fill sample data', variant: 'secondary', onClick: fillSampleData }),
          Button({ label: 'Reset demo', variant: 'secondary', onClick: resetDemo }))),
      h('section', { class: 'demo__section' }, h('h3', { class: 'demo__h' }, 'Funnel'), funnel, timings),
      h('section', { class: 'demo__section' }, h('h3', { class: 'demo__h' }, 'Key events'), keyEvents),
      h('section', { class: 'demo__section' }, h('h3', { class: 'demo__h' }, h('span', null, 'Event log'), count), log)));

  fab.addEventListener('click', () => {
    const open = panel.classList.toggle('is-open');
    fab.setAttribute('aria-expanded', String(open));
    if (open) closeBtn.focus();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && panel.classList.contains('is-open')) closeMobile(); });

  demoRefs = { failToggle, jumps, log, count, funnel, timings, keyEvents };
  subscribe(updateDemoPanel);
  updateDemoPanel();
}

function updateDemoPanel() {
  if (!demoRefs) return;
  const { failToggle, jumps, log, count, funnel, timings, keyEvents } = demoRefs;
  failToggle.checked = isFailMode();

  // Jump links come from the screens map (new screens show up automatically), plus the drawer.
  const names = Object.keys(screens);
  if (jumps.children.length !== names.length + 1) {
    jumps.replaceChildren(
      ...names.map((n) => h('button', { type: 'button', class: 'demo__jump', 'data-jump': n, onClick: () => demoJump(n) }, n)),
      h('button', { type: 'button', class: 'demo__jump demo__jump--drawer', 'data-jump': 'recovery', onClick: () => demoJump('recovery') }, 'recovery drawer'));
  }
  const here = isSheetOpen('recovery') ? 'recovery' : currentScreen;
  [...jumps.children].forEach((b) => b.setAttribute('aria-current', String(b.dataset.jump === here)));

  // Funnel: each step lights up once this user has reached it.
  funnel.replaceChildren(...FUNNEL.map((step) => {
    const on = step.reached(state);
    return h('li', { class: `funnel__step${on ? ' is-reached' : ''}` },
      h('span', { class: 'funnel__dot', 'aria-hidden': 'true' }), step.label, h('span', { class: 'visually-hidden' }, on ? ' (reached)' : ' (not yet)'));
  }));
  const secsTo = (t) => (state.signupAt && t ? `${Math.round((t - state.signupAt) / 1000)} s` : '–');
  timings.replaceChildren(
    h('p', null, `Time to first draft: ${secsTo(state.firedOnce.first_post_generated)}`),
    h('p', null, `Time to save: ${secsTo(state.firedOnce.first_post_saved)}`));

  // Key events: once-per-user events get a "fired" badge; the others show a count.
  keyEvents.replaceChildren(...KEY_EVENTS.map(({ name, once }) => {
    const fired = state.events.filter((e) => e.name === name);
    const last = fired[fired.length - 1];
    const badge = once
      ? h('span', { class: `badge${fired.length ? ' badge--on' : ''}` }, fired.length ? 'Fired once' : 'Not yet')
      : h('span', { class: `badge${fired.length ? ' badge--on' : ''}` }, fired.length ? `${fired.length}×` : 'Not yet');
    return h('li', { class: 'key-events__row' },
      h('span', { class: 'key-events__name' }, name, once && h('span', { class: 'key-events__once' }, 'once per user')),
      h('span', { class: 'key-events__right' },
        name === 'post_usefulness_rated' && last && h('span', { class: 'key-events__val' }, last.props.value),
        badge));
  }));

  count.textContent = String(state.events.length);
  if (log.children.length !== state.events.length || !state.events.length) {
    log.replaceChildren(...(state.events.length
      ? [...state.events].reverse().map((ev) => h('li', { class: 'log__item' },
        h('div', { class: 'log__meta' }, h('span', { class: 'log__name' }, ev.name),
          h('time', { class: 'log__time', datetime: new Date(ev.t).toISOString() }, new Date(ev.t).toLocaleTimeString([], { hour12: false }))),
        h('div', { class: 'log__props' }, JSON.stringify(ev.props))))
      : [h('li', { class: 'log__empty' }, 'No events yet.')]));
  }
}

const FUNNEL = [
  { label: 'Signed up', reached: (s) => !!s.signupAt },
  { label: 'Completed setup', reached: (s) => !!s.firedOnce.setup_completed },
  { label: 'Generated a post', reached: (s) => !!s.firedOnce.first_post_generated },
  { label: 'Saved a post', reached: (s) => !!s.firedOnce.first_post_saved },
];
const KEY_EVENTS = [
  { name: 'setup_completed', once: true },
  { name: 'first_post_generated', once: true },
  { name: 'first_post_saved', once: true },
  { name: 'voice_fix_opened' },
  { name: 'post_usefulness_rated' },
];

// Jumping to result/saved/drawer needs a draft; build one from sample data if there isn't one.
function ensureDemoDraft() {
  if (state.draft) return;
  if (!state.businessName.trim()) setState({ ...SAMPLE_DATA });
  if (!state.selectedIdea) {
    const idea = getIdeas()[0];
    setState({ selectedIdea: { id: idea.id, title: idea.title, tag: idea.tag, source: 'suggested' } });
  }
  setState({ generationStartedAt: null }); // no real generation happened, so no latency
  setState({ draft: buildDraft({ source: 'suggested' }) });
}

function demoJump(target) {
  if (['result', 'saved', 'recovery'].includes(target)) ensureDemoDraft();
  if (target !== 'recovery') { navigate(target); return; }
  const wasOnResult = currentScreen === 'result';
  if (!wasOnResult) navigate('result');
  // Let the screen settle before the drawer slides over it.
  setTimeout(() => openRecovery(), wasOnResult ? 0 : TRANSITION_MS + 60);
}

function fillSampleData() {
  setState({ ...SAMPLE_DATA });
  rerender();
  toast('Sample data filled');
}

/* ---------- 12. Boot ---------- */
document.addEventListener('DOMContentLoaded', () => {
  if (urlFlags.reset) { try { localStorage.removeItem(STORAGE_KEY); } catch (err) { /* ignore */ } state = defaultState(); }
  renderDemoPanel();
  let start = (urlFlags.screen && screens[urlFlags.screen]) ? urlFlags.screen : state.screen;
  if (!screens[start]) start = 'signup';
  navigate(start, { animate: false });
});

// Handy for the console and for the next step's scripts.
window.App = {
  screens, sheets, navigate, rerender, openSheet, closeSheet, openRecovery,
  getState, setState, updateDraft, subscribe, resetDemo, track, trackOnce, toast, outOfScope,
  isFailMode, setFailMode, buildDraft, getIdeas, applyTone, applyVoice, versionsFor,
  components: { Button, Tag, Field, Chip, ChipGroup, setChipSelected, ProgressBar, ScreenHeader, Screen, Title, Subtitle, Toast, PostPreview, icon, h },
};
