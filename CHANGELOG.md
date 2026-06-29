# Changelog

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
- Auto-check the Spotify device deck-checklist item when the app detects a selected or active Spotify device.
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
