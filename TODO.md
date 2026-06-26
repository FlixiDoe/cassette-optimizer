# Cassette Optimizer TODO

Short-lived active task list for the next development passes.

Focus: protect real cassette recordings from bad playback states, accidental user actions, remaining import/export integration work, and safe hardware calibration tools.

## P0 – Recording Safety & Critical Stability

### 1. Wire pre-recording validation into Side A / Side B starts

The reusable validation core exists in `recording-preflight.js`; the remaining task is to connect it to the real recording buttons.

- **Implementation:** Call `validateRecordingSide(...)` before `Start Side A` and `Start Side B` starts cue/playback.
- **Real recording must check:** missing Spotify URI, local-only tracks, missing duration, empty side, missing token, selected/wakeable device, checklist state, and overlong tracks.
- **Dry Run:** Dry Run can continue with offline/imported data, but empty sides and invalid durations should still stop the run.
- **UI:** Show blocking issues in the main warnings/status area and log the exact side and track that caused the block.
- **Acceptance Criteria:** Real recording cannot start if the selected side contains unplayable Spotify data. Dry Run still works with imported/offline project data.
- **Suggested Commit:** `feat: wire recording preflight into side starts`

### 2. Add recording lock mode

Disable all dangerous planning and configuration controls while a cue, countdown, pause, flip, or recording state is active.

- **Controls to lock:** `Tape format`, per-tape format selectors, tape inventory inputs, manual split/nudge controls, `Import Config`, `Load playlist`, `Apply to Spotify`, and the playlist picker dropdown.
- **Implementation:** Set a global UI state attribute on the DOM, for example `document.body.setAttribute("data-recording-state", "active")`.
- **Important:** Add JavaScript guard checks inside dangerous action handlers, not only CSS opacity/pointer-events.
- **Keep available:** `Abort`, `Pause`, `Resume`, and `Start Side B` after flip.
- **Acceptance Criteria:** User cannot alter layout/metadata during playback, including through keyboard interaction or direct event triggers. Controls unlock automatically after abort or completion.
- **Suggested Commit:** `feat: add recording lock mode`

### 3. Add confirmation and backup prompt before applying playlist order

`Apply to Spotify` changes the remote playlist sequence. Add an explicit confirmation layer before any reorder request is sent.

- **Prompt Flow:** Show `Cancel`, `Export Backup`, and `Continue Anyway`.
- **Safe backup behavior:** `Export Backup` downloads the JSON and does not automatically continue with the Spotify playlist reorder.
- **Acceptance Criteria:** Clicking `Apply to Spotify` never modifies the remote playlist without explicit confirmation.
- **Suggested Commit:** `feat: confirm playlist reorder before apply`

### 4. Improve Spotify playback recovery states

Show readable, actionable onscreen guidance when the Spotify Web API reports playback/device errors.

- **Handled States:** no active device, target device mismatch, playback command sent but polling still shows idle, rate limiting, and expired OAuth tokens.
- **Implementation:** Update the Recording Readiness Panel with clear micro-copy, for example: `Device asleep. Open Spotify on your target device and play any song to wake it up, then retry.`
- **Acceptance Criteria:** User can recover from device/token/API errors without opening DevTools.
- **Suggested Commit:** `feat: improve spotify playback recovery states`

---

## P1 – Import / Export Architecture

### 5. Wire config migration into import/export flow

The reusable migration module and migration regression tests exist. The remaining task is to use the migration step inside the app import pipeline.

- **Implementation:** Import `migrateImportedConfig(...)` from `config-migration.js` and call it before the current import normalization logic.
- **Export:** Include new persisted project-level fields such as `slackMarginSeconds`, `jCardOverrides`, and future calibration fields when they are added.
- **Acceptance Criteria:** Older JSON configs import through the migration layer, mixed-format tape layouts survive import, and unknown future fields do not crash the app.
- **Suggested Commit:** `feat: wire cassette config migration into import flow`

### 6. Add dirty-state warning before replacing project

Warn before actions that discard the current project state, such as loading a new playlist or importing another config.

- **Prompt Flow:** Show `Cancel`, `Export Backup`, and `Replace Anyway`.
- **Implementation:** Track a lightweight dirty flag when tape format, manual split, J-Card data, inventory, calibration, or project metadata changes after load/import/export.
- **Acceptance Criteria:** The user cannot accidentally replace an edited cassette plan without a warning. `Export Backup` does not automatically continue unless the user explicitly confirms replacement.
- **Suggested Commit:** `feat: warn before replacing unsaved cassette project`

---

## P2 – Audiophile Calibration & Hardware Control

### 7. Improve leader-tape calibration UX

The app already has lead-in and motor latency calibration. Improve the wording and visible cue flow rather than adding a second delay system.

- **Implementation:** Rename or extend `Lead-in delay` copy to `Leader Tape Delay`. Keep `Motor latency` separate.
- **UI:** During cue, show text such as `Advancing past leader tape...` while the existing calibrated delay path runs.
- **Acceptance Criteria:** There is still one shared cue/delay pipeline. No duplicate delay timers or competing calibration fields are introduced.
- **Suggested Commit:** `feat: improve leader tape calibration ux`

### 8. Integrated audio level-check tone generator

Add a safe browser-based level-check source for deck input calibration.

- **Implementation:** Add a `Level Check` button in the setup panel using the Web Audio API.
- **Tone options:** 400 Hz, 1 kHz, or pink noise.
- **Level options:** `-12 dBFS`, `-6 dBFS`, and `0 dBFS`; default to `-12 dBFS` or `-6 dBFS`.
- **Safety:** Show a warning before starting the tone. Include a clear `Stop Tone` button. Do not auto-start audio without user interaction.
- **Suggested Commit:** `feat: add web audio test tone generator for level checks`

### 9. Add tape slack margin tolerance to cassette logic

Allow optional unofficial side-length headroom for real tapes, but make it explicit and safe.

- **Implementation:** Add `Tape Slack Margin (seconds)`.
- **Defaults and limits:** Default to `0s` or `30s`; cap the maximum, for example `120s`.
- **Warnings:** Whenever slack beyond official side length is used, show: `Uses unofficial extra tape length. Real cassette may still run out.`
- **Persistence:** Export/import the slack setting through the cassette project JSON and include it in migration defaults.
- **Suggested Commit:** `feat: add tape slack margin tolerance to cassette logic`

---

## P3 – J-Card Customization & UX Polish

### 10. Add smart track title cleanup and overrides for J-Cards

Spotify track names often contain long suffixes that overflow printed J-Cards.

- **Implementation:** Add automatic cleanup for common suffixes such as `Remastered`, `Live`, and `Deluxe Edition`.
- **Overrides:** Add print-only title overrides in the J-Card preview without changing the underlying Spotify track data.
- **Suggested Commit:** `feat: add smart title cleanups and manual overrides for j-card print`

### 11. Add dynamic color extraction for J-Card themes

Use playlist artwork to generate a matching accent color for the printed J-Card.

- **Implementation:** Downscale the playlist cover in an offscreen canvas and extract a dominant or vibrant color.
- **Output:** Inject the color into CSS custom properties used by the J-Card template.
- **Suggested Commit:** `feat: add dynamic color extraction for j-card background theme`

### 12. Add remaining blank tape duration display

Make it clear how much silent tape remains at the end of each side.

- **Implementation:** Next to the side fill bars, show `Remaining blank tape: MM:SS`.
- **Suggested Commit:** `ui: add explicit remaining blank tape duration to side summaries`

### 13. Improve mobile LAN monitor layout

Optimize the read-only phone view as a high-visibility studio monitor.

- **Layout Priorities:** Large status text, active side, massive countdown, prominent progress bar, last important log line, and a clear flip prompt.
- **Constraint:** Keep all interactive controls hidden on non-loopback LAN IPs.
- **Suggested Commit:** `feat: improve mobile lan monitor layout`

---

## Later Ideas

- Add custom notes/spine comment fields (`spineNote`) for tape formulations.
- Add printable outer cassette shell stickers.
- Add local project history and automated session recovery.
- Add a Smart Gap-Filler routine for significant trailing silence.
