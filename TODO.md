# Cassette Optimizer TODO

Short-lived active task list for the next development passes.

Focus: Protect real cassette recordings from bad playback states, accidental user actions, eliminate edge cases in the multi-tape project model, and add safe audiophile hardware calibration tools.

## P0 – Recording Safety & Critical Stability

### 1. Add pre-recording track availability check

Validate that the selected side can actually be played entirely through the Spotify Web API before any physical tape transport starts.

- **Checks:**
  - Track has valid Spotify URI.
  - Track is not local-only (`is_local` check).
  - Track has valid duration metadata.
  - Imported project configurations have zero missing track URIs.
  - Selected side has at least one track.
  - Spotify token exists unless Dry Run is enabled.
  - Selected/active Spotify device is available before real recording.
  - Audio checklist is confirmed or explicitly skipped.
  - Track longer than selected side length is blocked or explicitly acknowledged.
- **Implementation:** Run check before `Start Side A` and `Start Side B`. Show a blocking modal/warning if invalid tracks exist. Allow Dry Run to bypass Spotify URI/token/device validation. Surface missing URI counts directly in the UI for imported JSON configs.
- **Acceptance Criteria:** Real recording cannot start if an invalid/local track is on the selected side. The UI explicitly states which track/side caused the block and what the user should fix.
- **Suggested Commit:** `feat: add pre-recording track availability check`

### 2. Add recording lock mode

Disable all dangerous planning and configuration controls while a cue, countdown, or recording is actively running to prevent mid-tape user mistakes.

- **Controls to lock:** `Tape format`, per-tape format selectors, tape inventory inputs, manual split/nudge controls, `Import Config`, `Load playlist`, `Apply to Spotify`, and the playlist picker dropdown.
- **Implementation:** Set a global UI state attribute on the DOM, for example `document.body.setAttribute("data-recording-state", "active")`. Use CSS to disable pointer events and reduce opacity (`opacity: 0.5; pointer-events: none;`) for all locked components. Keep `Abort`, `Pause`, and `Resume` fully interactive. Show a persistent status badge: `[Recording lock active]`.
- **Important:** Do not rely only on CSS. Add JavaScript guard checks inside dangerous action handlers, for example `if (isRecordingLocked()) return log("Recording lock active.");`.
- **Acceptance Criteria:** User cannot alter layout/metadata during playback, including through keyboard interaction or direct event triggers. Controls unlock automatically after `Abort` or when Side B finishes.
- **Suggested Commit:** `feat: add recording lock mode`

### 3. Add confirmation and backup prompt before applying playlist order

`Apply to Spotify` destructively alters the remote playlist sequence. Add an explicit interception layer.

- **Prompt Flow:** Clicking the button triggers a modal:

  ```text
  This will reorder your Spotify playlist to match the cassette plan.
  Export a backup JSON before continuing?

  Cancel
  Export Backup
  Continue Anyway
  ```

- **Implementation:** If `Export Backup` is clicked, trigger the existing JSON export payload download and close or reset the modal. Do **not** automatically continue with the Spotify playlist reorder after export. The user must explicitly click `Continue Anyway` or start the apply flow again after saving the backup.
- **Acceptance Criteria:** Clicking `Apply to Spotify` never modifies the remote playlist without explicit confirmation. `Export Backup` is safe and non-destructive by itself.
- **Suggested Commit:** `feat: confirm playlist reorder before apply`

### 4. Improve Spotify playback recovery states

Provide readable, actionable, onscreen guidance when the Spotify Web API throws errors, preventing the user from needing to open DevTools.

- **Handled States:** `404 NO_ACTIVE_DEVICE`, target device mismatch, command timeouts (playback sent but state polling shows idle), `429 Rate Limit` (respect `Retry-After`), and expired OAuth tokens.
- **Implementation:** Update the *Recording Readiness Panel* with clear micro-copy text, for example: `Device asleep. Open Spotify on your target device and play any song to wake it up, then retry.` Prevent infinite API retry loops.
- **Suggested Commit:** `feat: improve spotify playback recovery states`

---

## P1 – Architecture & Multi-Tape Testing

### 5. Add regression tests for project model and multi-tape export/import

Ensure features like mixed tape formats, manual splits, and tape inventories survive JSON serialization pipelines without degrading into defaults.

- **Test Cases:**
  - Verify a project containing mixed formats, for example Tape 1: C90 and Tape 2: C60, exports and restores perfectly.
  - Verify changing the format of Tape 2 does not bleed into or reset Tape 1.
  - Verify manual split overrides survive round-trip export/import.
  - Verify the J-Card module pulls the format directly from the individual tape object, not the global default selector.
- **Implementation:** Create a standalone, build-free script `scratch/test_project_model.js` using native Node.js assertions. Make it runnable locally without requiring active Spotify tokens.
- **Suggested Commit:** `test: add project model export regression tests`

### 6. Add versioned config migration for imported cassette projects

JSON config import needs a migration layer before new fields like `slackMarginSeconds`, `jCardOverrides`, `spineNote`, or future calibration settings are added.

- **Goal:** Keep old exported cassette project files importable after the project model evolves.
- **Implementation:** Add a small `migrateImportedConfig(payload)` step before `normalizeImportedConfig(payload)`. Use `configVersion` to apply safe defaults and transform known older shapes.
- **Migration rules:**
  - Missing new fields receive safe defaults.
  - Unknown future fields do not crash import.
  - Old tape fields such as `tapeMinutes` remain accepted.
  - New project-level settings are copied into export/import serialization.
- **Acceptance Criteria:** Older JSON configs import without data loss, mixed-format tape layouts survive migration, and malformed future/unknown fields are ignored safely.
- **Suggested Commit:** `feat: add versioned cassette config migration`

### 7. Add dirty-state warning before replacing project

Warn before actions that discard the current project state, such as loading a new playlist or importing another config.

- **Prompt Flow:**

  ```text
  You have unsaved cassette changes.
  Export before replacing the current project?

  Cancel
  Export Backup
  Replace Anyway
  ```

- **Implementation:** Track a lightweight dirty flag when tape format, manual split, J-Card override, inventory, calibration, or project metadata changes after load/import/export. Reset the flag after `Export Config`.
- **Acceptance Criteria:** The user cannot accidentally replace an edited cassette plan without a warning. `Export Backup` does not automatically continue unless the user explicitly confirms replacement.
- **Suggested Commit:** `feat: warn before replacing unsaved cassette project`

---

## P2 – Audiophile Calibration & Hardware Control

### 8. Improve leader-tape calibration UX

The app already has lead-in and motor latency calibration. This task should improve and rename that UX rather than building a second delay system.

- **Goal:** Make the existing delay calibration understandable for physical cassette leader tape.
- **Implementation:** Rename or extend the existing `Lead-in delay` copy to `Leader Tape Delay`. Keep `Motor latency` separate. When clicking `Start Side`, the UI displays a dedicated countdown, for example `Advancing past leader tape...`, while the user starts the deck. The actual Spotify playback command is delayed by the existing calibrated delay path.
- **Acceptance Criteria:** There is still one shared cue/delay pipeline. No duplicate delay timers or competing calibration fields are introduced.
- **Suggested Commit:** `feat: improve leader tape calibration ux`

### 9. Integrated audio level-check tone generator

Proper gain staging is critical to balance tape saturation versus analog tape hiss. The generator should be useful but safe by default.

- **Implementation:** Add a `Level Check` button in the setup panel. Use the native browser **Web Audio API** to synthesize a continuous sine wave tone (400 Hz or 1 kHz) or pink noise directly through the active audio interface output.
- **Level options:** Provide selectable output levels such as `-12 dBFS`, `-6 dBFS`, and `0 dBFS`. Default to `-12 dBFS` or `-6 dBFS`, not `0 dBFS`.
- **Safety:** Show a warning before starting the tone. Include a clear `Stop Tone` button. Do not auto-start audio without user interaction.
- **Suggested Commit:** `feat: add web audio test tone generator for level checks`

### 10. Add tape slack margin tolerance to cassette logic

Physical cassettes often contain 1–2 minutes of extra tape length beyond the official specification, for example a C60 side is often about 31 minutes. The strict optimizer logic should account for this variance, but only with clear warnings.

- **Implementation:** Add a configuration field `Tape Slack Margin (seconds)`.
- **Defaults and limits:** Default to `0s` or `30s`; maximum should be capped, for example `120s`.
- **Warnings:** Whenever the split algorithm uses slack beyond the official side length, show a warning such as `Uses unofficial extra tape length. Real cassette may still run out.`
- **Persistence:** Export/import the slack setting through the cassette project JSON and include it in future config migration defaults.
- **Suggested Commit:** `feat: add tape slack margin tolerance to cassette logic`

---

## P3 – J-Card Customization & UX Polish

### 11. Add smart track title cleanup and overrides for J-Cards

Spotify track names frequently contain messy, long suffixes such as `- Remastered 2020` or `(Live / Deluxe Edition)`, which overflow and break the printed J-Card layout.

- **Implementation:**
  - Add an automatic regex filter to strip known studio metadata strings inside the J-Card data model.
  - Add inline `<span contenteditable="true">` elements or quick text inputs within the J-Card preview UI so users can manually shorten or override titles purely for printing purposes without altering the underlying Spotify track data.
- **Suggested Commit:** `feat: add smart title cleanups and manual overrides for j-card print`

### 12. Add dynamic color extraction for J-Card themes

Enhance the visual appeal of printed J-Cards by coordinating the inlay's background accent and spine blocks with the loaded playlist artwork.

- **Implementation:** Pass the playlist cover image into an offscreen HTML5 `<canvas>` element, downscaling it to extract the dominant or primary vibrant hex color. Inject this dynamic value into CSS custom properties driving the J-Card template.
- **Suggested Commit:** `feat: add dynamic color extraction for j-card background theme`

### 13. Add remaining blank tape duration display

Make it completely clear how much silent tape remains at the end of a recorded side when a track cannot fit.

- **Implementation:** Next to the side fill percentage bars, calculate and display the literal time gap: `Remaining blank tape: MM:SS`. This gives clear visual motivation to use the manual split nudge buttons.
- **Suggested Commit:** `ui: add explicit remaining blank tape duration to side summaries`

### 14. Improve mobile LAN monitor layout

Optimize the read-only responsive view so a phone placed sitting on top of a physical cassette deck acts as a high-visibility studio monitor.

- **Layout Priorities:** Large status text (`RECORDING`, `CUE`, `FLIP`), high-contrast active side display, massive time countdown, prominent progress bar, and a flashing fullscreen element for the `FLIP CASSETTE` prompt. Keep all interactive controls explicitly hidden when accessed from non-loopback LAN IPs.
- **Suggested Commit:** `feat: improve mobile lan monitor layout`

---

## Later Ideas

- Add custom notes/spine comment fields (`spineNote`) to the project model for printing tape formulations, for example `Recorded on Maxell XLII Type II`.
- Add printable, template-aligned outer cassette shell stickers (`Print Shell Labels`).
- Add local project history and automated session recovery using browser `IndexedDB` or `sessionStorage` cache pools.
- Add an automated `Smart Gap-Filler` routine to suggest ultra-short filler tracks from the user's library when significant trailing silence is calculated on a side.
