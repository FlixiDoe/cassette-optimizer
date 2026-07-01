# Changelog

## Cassette Optimizer 1.3.1

Setup clarity release for first-time Spotify connection and shorter onboarding.

### Highlights

- Add an inline Spotify setup note with the required redirect URI and a direct Spotify Developer Dashboard link.
- Change the header connection button to `Add Client ID first` while the Spotify Client ID field is empty.
- Update the connection button immediately when a Client ID is entered so the setup order is visible before OAuth starts.
- Replace the long Basic Usage list with a shorter Quick Start and move the detailed recording guidance into a separate workflow section.

### Documentation

- Document the first-time Spotify setup order in the app-state flow notes.
- Keep cassette, deck, inventory, readiness, slack, level-check, and multi-tape details available without making the first-run path look daunting.

### Validation

- `npm test` passes: 27/27 tests.
- Browser check on a fresh `http://localhost:8787/` origin: empty Client ID shows `Add Client ID first`, entering a Client ID changes the button to `Connect Spotify`, the inline setup note is visible, and no console warnings or errors appear.

## Cassette Optimizer 1.3.0

Stability release for reload- and close-resistant recording sessions.

### Highlights

- Restore the active cassette project after reload or browser close, including playlist metadata, tape plan, selected tape, split layout, and J-card data.
- Persist in-progress recording state with the active side, record mode, elapsed time, Spotify progress anchor, tape minutes, and selected tape index.
- Resume running recording timers after reload by accounting for elapsed wall-clock time since the last saved recording snapshot.
- Restore the selected playlist into the playlist input and dropdown so the loaded project remains visible after refresh.
- Restore the selected Spotify device from a saved snapshot so playback controls and Device readiness stay usable before Spotify device refresh returns.

### Fixes

- Keep recording controls from losing the loaded playlist after a reload.
- Keep Device readiness green for the previously selected Spotify device when the recording session is restored.
- Clear persisted recording state on abort, new project load, and completed Side B so stale recording state cannot reappear later.

### Validation

- `npm test` passes: 27/27 tests.
- Browser check on `http://127.0.0.1:8788/`: simulated saved project, Spotify token, playlist, and selected device restore into the playlist input, playlist dropdown, device dropdown, and Recording Readiness without console errors.

## Cassette Optimizer 1.2.3

Bugfix release for clearer Spotify setup feedback.

### Fixes

- Show an inline Client ID error when `Connect Spotify` is clicked before a Spotify app Client ID is entered.
- Focus the Client ID field and mark it invalid so first-time setup failure is visible instead of only appearing in the log.

### Documentation

- Clarify that missing Client ID now appears as an inline setup error.

### Validation

- `npm test` passes: 27/27 tests.
- Browser check on `http://127.0.0.1:8787/`: clicking `Connect Spotify` with an empty Client ID shows the inline error, focuses the Client ID field, and keeps the page on the local app.

## Cassette Optimizer 1.2.2

Polish release for deck-profile calibration exports, explicit Spotify device readiness, and recording workflow accessibility.

### Highlights

- Add `recordingDelayCalibration` to exported deck-profile JSON while keeping the legacy top-level timing fields for compatibility.
- Move Recording Delay Calibration into the Deck profile editor so deck timing lives with deck metadata.
- Rework the Input column as collapsible Spotify, Playlist, Deck, Cassette, Tape planning, and Files workflow sections.
- Add keyboard focus polish, a skip link to recording controls, a collapsible deck checklist, and sticky phone-sized recording controls.
- Add README screenshots and a Windows x64 portable release ZIP with `Cassette Optimizer.exe` for users who do not want to install Node.js.

### Fixes

- Require an explicit current Spotify device selection before the Device readiness row or automatic checklist item turns green.
- Replace `Default active device` copy with `Select a device` so the UI no longer implies that Spotify's default active device is enough.

### Documentation

- Document the collapsible input workflow sections, keyboard skip link, sticky mobile recording controls, deck-checklist details behavior, explicit-device readiness rule, screenshots, and Windows portable build flow.

### Validation

- `npm test` passes: 27/27 tests.
- Browser check on `http://127.0.0.1:8787/`: the app loads with no console errors, Deck details opens correctly, and Recording Delay Calibration remains inside the Deck section.

## Cassette Optimizer 1.2.1

Bugfix release for Spotify playlist loading regressions after the 1.2.0 stability release.

### Fixes

- Restore the Load playlist button behavior by keeping it from submitting the input form.
- Prefer the pasted playlist URL or ID when loading, while still allowing the playlist dropdown as a fallback.
- Read playlist track totals from both Spotify response shapes so dropdown entries no longer show false `0 tracks` when totals are present under `items`.
- Load long owned or collaborative Spotify playlists through the current `/playlists/{id}/items` paging response, including `items[].item` track payloads.
- Keep paginating playlist items beyond the first 100 tracks by handling both detail containers and direct paging responses.
- Preserve loaded playlist metadata when Spotify allows playlist details but blocks track items, and show `No readable tracks` instead of incorrectly reverting lower panels to `No playlist loaded`.
- Avoid `NaNx Cundefined` tape recommendations when no cassette formats are currently available.

### Validation

- `npm test` passes: 27/27 tests.
- Browser check on `http://127.0.0.1:8787/`: a 113-track owned playlist loads all 113 tracks, while a Spotify-blocked public playlist stays visible as loaded metadata with no readable track items.

## Cassette Optimizer 1.2.0

Feature and stability release for profile-driven cassette planning, local monitoring, and recording reliability.

### Highlights

- Add deck profiles and cassette profiles with explicit save/delete controls, richer metadata, and timing settings that feed recording calibration.
- Track owned physical cassettes separately from cassette model profiles, including exact cassette-model selection for each planned tape.
- Export and import profile data as individual JSON files, profile bundles, or a folder tree with deck profiles, cassette profiles, playlist profiles, and tape collection data.
- Rework the left input panel into repeated Spotify, Playlist, Deck, Cassette, Tape planning, and Files sections with consistent control ordering.
- Harden local and LAN status monitoring by keeping `GET /api/status` readable while requiring localhost or `STATUS_WRITE_TOKEN` for writes.
- Improve recording reliability with guarded timer ticks, one-shot 401 retries, stable rate-limit countdown cleanup, cancellable cue promises, and PKCE callback cleanup.
- Improve import and print robustness by dropping zero-length tracks, skipping unreadable profile JSON files, preserving dash-separated live titles, and warning before batched Spotify playlist writes.
- Document Node.js `>=18`, profile workflows, status API write protection, and the updated stability behavior.

### Validation

- `npm test` passes: 27/27 tests.

## Cassette Optimizer 1.1.0

Feature release for the current recording-readiness and cassette-planning workflow.

### Highlights

- Load Spotify playlists through OAuth PKCE and plan tracks across one or more cassettes without cutting tracks.
- Use `Tapes you have` as a real recording gate: recording is blocked when inventory is empty, when the plan needs more cassettes than entered, or when a planned side is too long for the selected cassette format.
- Use the seven-row Recording Readiness panel for Spotify, Device, Playlist, Tape, Checklist, API, and Ready state.
- Start Side A/B only when Recording Readiness is fully green; click handlers also block direct starts.
- Auto-check the Spotify device deck-checklist item after an explicit current Spotify device selection.
- Use seven compact Level Check checkpoints plus browser-generated 400 Hz, 1 kHz, or pink-noise tones.
- Rehearse the full recording flow in Dry Run mode with real-speed timers, visible DRY RUN banner, and simulated Spotify command log.
- Handle Spotify HTTP 429 rate limits with a Retry-After countdown, single non-recording retry, and recording-safe buffered playback command replay.
- Use the First Tape Wizard for a guided playlist, cassette, checklist, level-check, dry-run, and recording-start flow.
- Print J-cards with playlist art, title cleanup, cover-derived theming, and manual print-only title overrides.
- Export and import cassette project JSON, including multi-tape state, inventory, calibration, slack margin, and J-card overrides.

### Maintenance

- Harden Spotify auth and playback timing by limiting 401 refresh retries, aligning progress drift tolerance, and guarding recording timer ticks.
- Clear one-time PKCE verifier/state after successful OAuth callbacks.
- Keep rate-limit countdown completion from leaving controls disabled while preserving buffered playback replay.
- Resolve cancelled record-cue promises cleanly when recording is aborted during cue.
- Debounce heavy timing/profile input updates while keeping state reads current.
- Improve import resilience by dropping zero-length imported tracks, warning on future config versions, and skipping unreadable profile-folder JSON files.
- Require localhost or `STATUS_WRITE_TOKEN` for status API writes while keeping LAN status reads available.
- Improve confirmation flows for overlapping dialogs and batched Spotify playlist writes.
- Keep J-card cleanup from stripping dash-separated live titles.
- Document Node.js `>=18` as the supported runtime.

### Validation

- `npm test` passes: 27/27 tests.
