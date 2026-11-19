# First-post onboarding · clickable prototype

A web onboarding flow for a fictional AI marketing tool for small teams. It takes a new user from sign-up to a saved first post. Plain HTML, CSS and JS: no framework, no build step, no network calls. All the "AI" is pre-written copy behind timeouts.

## How to open it

- **Locally:** double-click `index.html`.
- **Hosted:** drop this folder on Netlify (drag and drop works) or serve it with GitHub Pages. No settings needed.
- **Desktop (900px and wider):** sign-up to generating run in a phone-sized frame. The frame widens into a desktop canvas for the result and saved screens, which use two columns. The demo panel sits on the right.
- **Narrower screens:** everything stays one column. On a real phone the app fills the screen and the demo panel hides behind the **i** button.

## 60-second demo script

**1. Happy path (about 25 s)**
1. Open `index.html?reset=1`.
2. Type any email, then click **Create account**.
3. Click **Fill sample data** in the demo panel, then **Show me post ideas**.
4. Tap **Announce a weekend special**. Watch the checklist tick off, about 3 s.
5. On the result screen, tap **Shorter**, then **Warmer**. The caption rewrites instantly.
6. Click **Save post**.
7. On the saved screen, answer **Yes, as is**. "Thanks, noted" appears and the choice locks.
8. Point at the demo panel: all four funnel steps are lit, there's a "Time to first draft" and "Time to save", and the three once-per-user events show *Fired once*.

**2. Recovery (about 20 s)**
1. Click **Create another post**, then pick an idea.
2. On the result screen, click **Not quite**. The drawer slides in and `voice_fix_opened` appears in the log.
3. Pick **Friendly**, **Warm** and **Playful**. Try a 4th word: it shakes and is ignored.
4. Optionally paste a caption of your own, then click **Rewrite my post**.
5. After 1.5 s the drawer closes. The caption is rewritten and a "Voice: Friendly, Warm, Playful" tag appears under it.
6. Click **Undo** to show the old caption coming back.

**3. Failure (about 15 s)**
1. Switch on **Simulate slow or failed draft** in the demo panel, or open `index.html?fail=1`.
2. Pick an idea. After 3 s you'll see "This is taking longer than usual."
3. Click **Try again**: it stalls again while the toggle is on.
4. Click **Use a ready template**: you land on the result with a template draft (`source: "template"`).
5. Switch the toggle off and **Try again** succeeds.

## URL flags

| Flag | What it does |
|---|---|
| `?fail=1` | Every draft stalls at 3 s and shows the failure box. Turning the demo toggle off cancels it for the session. |
| `?reset=1` | Starts from a clean state: wipes saved progress, events and voice words. |
| `?screen=<name>` | Opens straight on a screen: `signup`, `setup`, `ideas`, `generating`, `result`, `saved`. |

Flags combine, for example `index.html?reset=1&fail=1`.

## Demo panel

- **Jump to screen:** one button per screen, plus **recovery drawer**. Jumping to `result`, `saved` or the drawer builds a sample draft first if there isn't one.
- **Simulate slow or failed draft:** same as `?fail=1`, but you can switch it on and off.
- **Fill sample data:** Sweet Crumbs Bakery, "Home bakery selling custom cakes and cookies", maya@sweetcrumbs.co.
- **Reset demo:** clears everything and goes back to sign-up.
- **Funnel:** Signed up → Completed setup → Generated a post → Saved a post. Each step lights up when reached. Below it are "Time to first draft" and "Time to save", both measured from sign-up.
- **Key events:**
  - The three once-per-user events (`setup_completed`, `first_post_generated`, `first_post_saved`) get a badge once they've fired.
  - `voice_fix_opened` shows a count.
  - `post_usefulness_rated` shows a count and the last answer.
- **Event log:** every event with its props, newest first. Events also print to the console.

Progress is saved in `localStorage`, so a reload keeps you where you were, including the caption, the tone chip and the rating.

## Events

| Event | When | Props |
|---|---|---|
| `setup_completed` (once) | Leaving setup | `optional_fields_filled`, `seconds_since_signup` |
| `first_post_generated` (once) | The result screen first shows a draft | `source`, `latency_ms`, `channel` |
| `voice_fix_opened` | The recovery drawer opens | none |
| `first_post_saved` (once) | Save post | `tone_chip_used`, `voice_fix_opened`, `regenerations`, `seconds_since_signup` |
| `post_usefulness_rated` | An answer on the saved screen | `value`: `yes_as_is`, `yes_with_edits` or `no` |

## Testing

Both scripts drive headless Chromium against the `file://` page and refresh `screenshots/`.

```bash
node qa/smoke-test.cjs
```

```bash
node qa/desktop-test.cjs
```

- **`smoke-test.cjs`** covers phone sizes (390px and 360px).
- **`desktop-test.cjs`** runs at 1280×800:
  - the happy path
  - the recovery path with Undo
  - `?fail=1`
  - a refresh mid-flow
  - 1024px and 880px layouts

Both need Playwright. The prototype itself needs nothing.
