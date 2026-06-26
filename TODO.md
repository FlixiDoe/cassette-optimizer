# Cassette Optimizer TODO

Prioritized roadmap for the next implementation steps.

## P0 – Release blockers

### 1. Fix broken J-Card printing

The current print output can spread the J-Card across several pages and repeat Side A / Side B content.

**Goal**

- Print one clean A4 page for normal playlists.
- Use a maximum of two pages only when the tracklist is very long.
- Do not duplicate Side A or Side B blocks.
- Hide the normal app UI during print.

**Implementation notes**

- Add a dedicated print-only J-Card container.
- Use `@media print` to hide everything except the print layout.
- Use `@page { size: A4; margin: 10mm; }`.
- Add `break-inside: avoid` / `page-break-inside: avoid` where needed.
- Add compact overflow handling for long tracklists.

**Suggested commit**

```text
fix: make j-card print layout single-page
```

---

### 2. Add real physical J-Card layout

The print layout should look like a cassette inlay instead of a full-page app print.

**Goal**

```text
┌────────────┬────────────────────────┬────────────┐
│ Spine      │ Cover                  │ Back       │
└────────────┴────────────────────────┴────────────┘
```

**Implementation notes**

- Add separate print panels for spine, front cover, and back cover.
- Add visible fold lines.
- Put playlist title and tape format on the spine.
- Put cover art and title on the front cover.
- Put Side A and Side B tracklists on the back cover.
- Make the layout readable in grayscale.

**Suggested commit**

```text
feat: add physical j-card print template
```

---

## P1 – Important usability features

### 3. Split `index.html` into static modules

The app should stay static and build-free, but the current single-file structure will become hard to maintain.

**Goal**

Keep the no-build-step workflow, but split the code into clear files:

```text
index.html
styles.css
app.js
spotify.js
tape.js
recording.js
jcard.js
export.js
```

**Implementation notes**

- Move CSS from `index.html` to `styles.css`.
- Move Spotify API/OAuth helpers to `spotify.js`.
- Move tape length and split logic to `tape.js`.
- Move recording state, countdown, cue, pause/resume, and abort logic to `recording.js`.
- Move J-Card rendering and print logic to `jcard.js`.
- Move future JSON import/export logic to `export.js`.
- Use plain ES modules with `<script type="module">`.
- No bundler, no framework, no build step.

**Acceptance criteria**

- App still runs through `python -m http.server 8787 --bind 127.0.0.1`.
- No build command is required.
- Spotify login still works from `http://127.0.0.1:8787/`.
- Regression test still passes.

**Suggested commit**

```text
refactor: split static app into modules
```

---

### 4. Add Deck Checklist before recording

Recording to cassette has physical steps that can easily be forgotten.

**Goal**

Add an optional checklist before `Start Side A` / `Start Side B`.

**Checklist items**

```text
☐ Tape inserted
☐ Rewound to start of side
☐ Correct side selected
☐ Record level checked
☐ Spotify device selected
☐ Notifications muted
☐ Deck is in record/pause
```

**Implementation notes**

- Show checklist inside the Record Mode panel.
- Let the user mark items as done.
- Store checklist preference in localStorage.
- Do not hard-block recording by default, but make unchecked items visually obvious.
- Add a compact "Skip checklist" option for advanced users.

**Acceptance criteria**

- User sees cassette-deck preparation steps before recording.
- The checklist helps prevent wrong-side or wrong-device recordings.
- UI remains usable on smaller screens.

**Suggested commit**

```text
feat: add pre-recording deck checklist
```

---

### 5. Add Dry Run / Safe Mode

Users should be able to test the recording workflow without starting Spotify playback.

**Goal**

Add a mode that runs cue, countdown, side timer, flip cue, and finish-time logic without sending playback commands to Spotify.

**Implementation notes**

- Add a toggle: `Dry Run / Test Mode`.
- In Dry Run, do not call `/me/player/play`, `/pause`, `/shuffle`, or `/repeat`.
- Still show `PRESS RECORD NOW` cue.
- Still run local side countdown.
- Clearly label the state as `Dry Run`.
- Allow testing Side A and Side B.

**Acceptance criteria**

- User can test the workflow without affecting Spotify.
- No Spotify playback starts in Dry Run.
- Countdown and flip cue behave like real recording mode.
- Normal recording mode still works unchanged.

**Suggested commit**

```text
feat: add dry run recording mode
```

---

### 6. Add recording delay calibration

Cassette decks and tapes have small physical delays before usable recording starts.

**Goal**

Add settings for:

- Lead-in delay
- Motor latency
- Optional end-of-side safety margin

**Implementation notes**

- Add numeric settings in seconds.
- Store settings in localStorage.
- Extend the record cue countdown using these settings.
- Show clear countdown text:
  - `PRESS RECORD NOW`
  - `Waiting for lead-in`
  - `Spotify starts in X seconds`
- Include settings in future JSON export/import.

**Acceptance criteria**

- User can configure delay in seconds.
- Spotify starts only after the configured delay.
- The countdown clearly explains what is happening.
- Settings persist after reload.

**Suggested commit**

```text
feat: add recording delay calibration
```

---

### 7. Explain split logic in the UI

Users should understand why the app chose the current Side A / Side B split.

**Goal**

Show a small explanation near the split recommendation.

**Suggested UI copy**

```text
Why this split?
Side A is filled until the next track would exceed the selected side length.
Original playlist order is preserved.
No tracks are cut.
```

**Implementation notes**

- Display the explanation under the tape recommendation or split point.
- Add dynamic values when possible:
  - selected side length
  - time left on Side A
  - next track that would not fit
- Keep the text short so it does not clutter the UI.

**Acceptance criteria**

- User can understand the split without reading the source code.
- The explanation updates when tape format changes.
- The explanation updates when playlist changes.

**Suggested commit**

```text
feat: explain tape split decision
```

---

### 8. Export and import tape configuration as JSON

After optimizing a mixtape, the user should be able to save and restore the exact tape layout.

**Goal**

Add `Export Config` and `Import Config` buttons.

**Export should include**

- App config version
- Playlist ID
- Playlist name
- Playlist cover URL
- Selected tape format
- Available tape formats
- Split index
- Side A tracks
- Side B tracks
- Track names, artists, durations, and URIs
- Timestamps
- J-Card text
- Recording calibration settings

**Import should**

- Load a saved JSON file.
- Restore the exact split.
- Restore Side A / Side B.
- Restore J-Card data.
- Work without fetching the Spotify playlist again.
- Warn if Spotify playback control needs reconnection.

**Suggested commit**

```text
feat: add tape config export and import
```

---

## P2 – UI polish

### 9. Reel animation

Make the cassette visual feel alive during Record Mode.

**Goal**

- Rotate both reels while recording.
- Stop animation while paused or idle.
- Simulate tape movement by changing reel fill/scale.
- Respect `prefers-reduced-motion`.

**Suggested commit**

```text
feat: animate cassette reels during recording
```

---

### 10. Better warning system

Add clearer warnings for cassette planning and Spotify playback.

**Warnings to add**

- Track too long for one side.
- Playlist longer than selected tape.
- Side has less than the configured safety margin remaining.
- Spotify device missing.
- Imported config has missing/unavailable track URIs.
- Print layout may need two pages because the tracklist is long.

**Suggested commit**

```text
feat: improve tape fit warnings
```

---

## P3 – Larger roadmap features

### 11. Multi-tape splitter

Long playlists should be split across multiple cassettes.

**Goal**

Example output:

```text
This playlist fits on 2x C90.

Tape 1:
- Side A
- Side B

Tape 2:
- Side A
- Side B
```

**Implementation notes**

- Preserve original track order.
- Do not cut tracks.
- Generate one layout per tape.
- Generate one J-Card per tape.
- Add automatic titles such as `Vol. 1`, `Vol. 2`, etc.

**Suggested commit**

```text
feat: add multi-tape playlist splitter
```

---

### 12. Tape inventory with quantity

The app should know how many physical tapes are available.

**Goal**

Example:

```text
C60: 2 available
C90: 1 available
C120: 0 available
```

Use this for:

- better recommendations
- multi-tape splitting
- warnings when a playlist needs more tapes than available

**Suggested commit**

```text
feat: add tape inventory quantities
```
