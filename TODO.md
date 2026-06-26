# Cassette Optimizer TODO

Short-lived active task list for the next development passes.

Focus: Protect real cassette recordings from bad playback states, accidental user actions, eliminate edge cases in the multi-tape project model, and add audiophile hardware calibration tools.

## P0 – Recording Safety & Critical Stability

### 1. Add pre-recording track availability check
Validate that the selected side can actually be played entirely through the Spotify Web API before any physical tape transport starts.
- **Checks:** - Track has valid Spotify URI.
  - Track is not local-only (`is_local` check).
  - Track has valid duration metadata.
  - Imported project configurations have zero missing track URIs.
- **Implementation:** Run check before `Start Side A` and `Start Side B`. Show a blocking modal/warning if invalid tracks exist. Allow Dry Run to bypass this validation. Surface missing URI counts directly in the UI for imported JSON configs.
- **Acceptance Criteria:** Real recording cannot start if an invalid/local track is on the selected side. The UI explicitly states which track/side caused the block.
- **Suggested Commit:** `feat: add pre-recording track availability check`

### 2. Add recording lock mode
Disable all dangerous planning and configuration controls while a cue, countdown, or recording is actively running to prevent mid-tape user mistakes.
- **Controls to lock:** `Tape format`, per-tape format selectors, tape inventory inputs, manual split/nudge controls, `Import Config`, `Load playlist`, `Apply to Spotify`, and the playlist picker dropdown.
- **Implementation:** Set a global UI state attribute on the DOM (e.g., `document.body.setAttribute('data-recording-state', 'active')`). Use CSS to disable pointer events and reduce opacity (`opacity: 0.5; pointer-events: none;`) for all locked components. Keep `Abort`, `Pause`, and `Resume` fully interactive. Show a persistent status badge: `[Recording lock active]`.
- **Acceptance Criteria:** User cannot alter layout/metadata during playback. Controls unlock automatically after `Abort` or when Side B finishes.
- **Suggested Commit:** `feat: add recording lock mode`

### 3. Add confirmation and backup prompt before applying playlist order
`Apply to Spotify` destructively alters the remote playlist sequence. Add an explicit interception layer.
- **Prompt Flow:** Clicking the button triggers a modal:
  *"This will reorder your Spotify playlist to match the cassette plan. Export a backup JSON before continuing? [Cancel] [Export Backup] [Continue Anyway]"*
- **Implementation:** If `Export Backup` is clicked, trigger the existing JSON export payload download immediately, then proceed with the remote `PUT /v1/playlists/{id}/tracks` operations.
- **Suggested Commit:** `feat: confirm playlist reorder before apply`

### 4. Improve Spotify playback recovery states
Provide readable, actionable, onscreen guidance when the Spotify Web API throws errors, preventing the user from needing to open DevTools.
- **Handled States:** `404 NO_ACTIVE_DEVICE`, target device mismatch, command timeouts (playback sent but state polling shows idle), `429 Rate Limit` (respect `retry-after`), and expired OAuth tokens.
- **Implementation:** Update the *Recording Readiness Panel* with clear micro-copy text (e.g., *"Device asleep. Open Spotify on your target device and play any song to wake it up, then retry"*). Prevent infinite API retry loops.
- **Suggested Commit:** `feat: improve spotify playback recovery states`

---

## P1 – Architecture & Multi-Tape Testing

### 5. Add regression tests for project model and multi-tape export/import
Ensure features like mixed tape formats, manual splits, and tape inventories survive JSON serialization pipelines without degrading into defaults.
- **Test Cases:**
  - Verify a project containing mixed formats (e.g., Tape 1: C90, Tape 2: C60) exports and restores perfectly.
  - Verify changing the format of Tape 2 does not bleed into or reset Tape 1.
  - Verify manual split overrides (`manualSplitLocked`) survive round-trip export/import.
  - Verify the J-Card module pulls the format directly from the individual tape object, not the global default selector.
- **Implementation:** Create a standalone, build-free script `scratch/test_project_model.js` utilizing native Node.js assertions. Make it runnable locally without requiring active Spotify tokens.
- **Suggested Commit:** `test: add project model export regression tests`

---

## P2 – Audiophile Calibration & Hardware Control

### 6. Add Leader-Tape delay calibration
Physical cassettes contain transparent leader-tape at both ends that cannot store magnetic audio. Starting Spotify instantly causes the first 5–10 seconds of the mixtape to be lost.
- **Implementation:** Add a numeric setting input: `Leader Tape Delay (seconds)`. When clicking `Start Side`, the UI displays a dedicated countdown (e.g., *"Advancing past leader tape..."*) while the user starts the deck. The actual Spotify playback command is delayed until the countdown reaches 0.
- **Suggested Commit:** `feat: add leader tape calibration delay`

### 7. Integrated audio level-check tone generator
Proper gain staging is critical to balance tape saturation versus analog tape hiss. 
- **Implementation:** Add a `Level Check` button in the setup panel. Use the native browser **Web Audio API** to synthesize a continuous sine wave tone ($400\text{ Hz}$ or $1\text{ kHz}$ at $0\text{ dBFS}$) or Pink Noise directly through the active audio interface output. This allows the user to set their deck's physical record input levels accurately before rolling tape.
- **Suggested Commit:** `feat: add web audio test tone generator for level checks`

---

## P3 – J-Card Customization & UX Polish

### 8. Add smart track title cleanup and overrides for J-Cards
Spotify track names frequently contain messy, long suffixes (`- Remastered 2020`, `(Live / Deluxe Edition)`) which overflow and break the printed J-Card layout.
- **Implementation:** - Add an automatic regex filter to strip known studio metadata strings inside the J-Card data model.
  - Add inline `<span contenteditable="true">` elements or quick text inputs within the J-Card preview UI so users can manually shorten or override titles purely for printing purposes without altering the underlying Spotify track data.
- **Suggested Commit:** `feat: add smart title cleanups and manual overrides for j-card print`

### 9. Add remaining blank tape duration display
Make it completely clear how much silent tape remains at the end of a recorded side when a track cannot fit.
- **Implementation:** Next to the side fill percentage bars, calculate and display the literal time gap: `Remaining blank tape: MM:SS`. This gives clear visual motivation to use the manual split nudge buttons.
- **Suggested Commit:** `ui: add explicit remaining blank tape duration to side summaries`

### 10. Improve mobile LAN monitor layout
Optimize the read-only responsive view so a phone placed sitting on top of a physical cassette deck acts as a high-visibility studio monitor.
- **Layout Priorities:** Large status text (RECORDING / CUE / FLIP), high-contrast active side display, massive time countdown, prominent progress bar, and a flashing fullscreen element for the *FLIP CASSETTE* prompt. Keep all interactive controls explicitly hidden when accessed from non-loopback LAN IPs.
- **Suggested Commit:** `feat: improve mobile lan monitor layout`

---

## Later Ideas
- Add custom notes/spine comment fields (`spineNote`) to the project model for printing tape formulations (e.g., *"Recorded on Maxell XLII Type II"*).
- Add printable, template-aligned outer cassette shell stickers.
- Add local project history and automated session recovery using browser `IndexedDB`.
