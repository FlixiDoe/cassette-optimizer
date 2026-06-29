# Changelog

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
