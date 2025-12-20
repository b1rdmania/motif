# Home UX audit + improvements (arcade-first)

This doc is a saved copy of the current home UX audit plan (no code changes).

## Current UX issues (what’s making it feel uninspiring/confusing)
- **Unclear hierarchy**: “Search”, “Preview”, and “Synthesis Engine” compete; users don’t instantly see the main thing to do.
- **Weak step-by-step guidance**: The app is a 3-step flow (Search → Select → Run engine), but the UI doesn’t feel like a guided sequence.
- **Controls feel detached from state**: Buttons don’t always read as “locked until selection”; the reason for disabled state isn’t visible.
- **Results table is dense** on mobile: long titles wrap unpredictably, selection highlight is subtle.
- **Copy and concept drift**: “emulator/engine” and “MIDI scrape/analyse” copy varies; the story should be consistent and confident.
- **iOS audio state**: The “Enable Audio” banner is reactive but not integrated into the flow (and can appear “random”).

## Target outcome
Arcade cabinet vibe with a clear, dramatic main CTA:
- **Primary action**: “Run the engine” (Generate & Play)
- Secondary: preview the MIDI
- Stronger “insert coin” style guidance: show step chips and a big engine panel.

## Proposed UX changes (high impact, low risk)

### 1) Make the flow explicit
Update `index.html`:
- Add a compact “Steps” row near the top:
  - Step 1: Search
  - Step 2: Pick a MIDI
  - Step 3: Run the engine
- Tie each step’s visual state to app state:
  - Step 2/3 show “locked” styling until available.

### 2) Promote “Synthesis Engine” as the hero module
- Move the engine card visually above Preview (or keep order but make engine card visually dominant).
- Make engine CTA bigger and more arcade:
  - Primary button: **Run the engine**
  - Secondary: Stop
  - Volume + progress remain but visually subordinate.
- Add a small one-line “what this does” under the button, not as a paragraph.

### 3) Preview becomes clearly “optional”
- Rename to “Listen to the source MIDI (optional)”
- Collapse preview by default on mobile (or add a “Show preview” toggle) to reduce overwhelm.

### 4) Results list readability + selection confidence
- Increase row tap targets and selection contrast.
- Add a right-side “Selected” chip on the selected row.
- On mobile:
  - clamp long titles to 2 lines
  - reduce columns (hide Source or Duration) based on width.

### 5) iOS audio UX integrated into the engine (subtle)
- Only on iOS-like browsers and only when audio is locked.
- Show a small under-section link: “Having trouble on iOS? Enable audio”
- Clicking expands a compact CTA row (Enable Audio button + tiny state line).
- Avoid a big persistent banner that could confuse non-iOS users.

### 6) Copy pass
Deferred for now: keep copy changes out of this pass.

## Implementation plan (concrete)

### Files
- Primary: `index.html`
- Minor TS adjustments (state-driven CSS classes): `src/main.ts`

### Approach
- Add a small set of **state CSS classes** on `body` (or on `.container`):
  - `state-has-results`
  - `state-has-selection`
  - `state-audio-locked`
- In `src/main.ts`, toggle these classes when:
  - results are loaded
  - a selection is made
  - audio unlock state changes
- Use CSS to:
  - style locked sections
  - highlight the engine CTA
  - improve mobile responsiveness

## Test plan
- Desktop Chrome/Safari:
  - search → select → engine run
  - preview optional still works
- iOS Safari:
  - first run shows “arm audio” only when needed
  - no random banner when audio is already running
- Visual:
  - mobile widths (320–430px)
  - long titles wrapping

## Non-goals
- No changes to the core synthesis engine behavior or backend.
- No copywriting/wording changes in this pass.

