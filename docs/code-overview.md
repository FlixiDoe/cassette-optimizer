# Code Overview

This document explains how the code is organized. It is about implementation, state, and function responsibility, not the user-facing feature list.

## Runtime shape

Cassette Optimizer is a static browser app. `index.html` stays at the repository root and loads CSS/JS from folders:

```html
<link rel="stylesheet" href="styles/styles.css">
<script type="module" src="src/app.js"></script>
```

There is no frontend build step. The cross-platform `npm run start:local` command starts the Node static server on `127.0.0.1:8787`. `npm run start:lan` binds the same server to all interfaces and exposes a tiny status API. PowerShell and POSIX shell helper scripts exist only as convenience wrappers around the same Node entrypoint.

## Main files

```text
index.html               DOM structure and element IDs used by src/app.js
src/app.js               Main controller, state, event wiring, Spotify calls, rendering
src/config-migration.js  JSON import migration and normalization defaults
src/spotify.js           Small Spotify/auth helper functions and SpotifyApiError
src/recording-preflight.js  Pure recording start validation
src/recording.js         Recording timing helper for expected-track calculation
src/tape.js              Pure cassette split, slack margin, duration, and formatting logic
src/jcard.js             Pure J-card markup rendering and print title cleanup
src/export.js            Current config version constant
styles/                  Layout, cassette visual, print layout, responsive behavior
server/server.js         Optional LAN monitor static server and /api/status endpoint
scripts/start-local.ps1  Windows convenience wrapper for local serving
scripts/start-lan.ps1    Windows convenience wrapper for LAN serving
scripts/start-local.sh   Linux/macOS convenience wrapper for local serving
scripts/start-lan.sh     Linux/macOS convenience wrapper for LAN serving
```

## Code ownership boundaries

`src/app.js` is intentionally the orchestration layer. It owns browser state, DOM events, Spotify network calls, rendering, recording mode, import/export, and localStorage persistence.

The smaller modules are kept mostly pure:

- `src/tape.js` does not touch the DOM or Spotify.
- `src/recording-preflight.js` validates recording readiness without touching the DOM.
- `src/config-migration.js` converts imported JSON into the current config shape before app normalization.
- `src/recording.js` does not touch the DOM or Spotify.
- `src/jcard.js` returns HTML strings and print-safe titles but does not decide which tape is active.
- `src/spotify.js` only contains helpers for OAuth/Spotify parsing and error metadata.
- `server/server.js` does not know Spotify tokens and only mirrors sanitized UI status.

When adding new logic, prefer putting pure calculations in a small module and leaving `src/app.js` as the coordinator.

## Main data flow

```text
Browser loads index.html
        ↓
src/app.js init()
        ↓
restore local settings, token, saved project, and recording snapshot
        ↓
bind DOM events
        ↓
user loads Spotify playlist
        ↓
fetch tracks from Spotify
        ↓
createMixtapeProject(...)
        ↓
build project.tapes[] from src/tape.js split logic
        ↓
renderSplit() updates all visible planning, recording, and J-card UI
        ↓
Record Mode starts one selected side through Spotify or Dry Run
```

## Central state

`src/app.js` keeps one central `state` object. Important groups inside it:

```text
Spotify session:
  token, refreshToken, expiresAt, selectedDeviceId,
  selectedDeviceSnapshot, devices

Playlist/project:
  playlistId, playlistName, playlistCoverUrl, tracks, project,
  projectDirty

Tape planning:
  tapeMinutes, availableTapeFormats, tapeInventory,
  tapeLayouts, selectedTapeIndex, splitIndex, slackMarginSeconds

Recording:
  recordMode, activeRecordSide, sideAStartedAt,
  sideAElapsedBeforePause, spotifySideElapsedMs,
  lastSideProgressMs, lastRecordingStateSaveAt,
  timerId, cueTimerId, pollingId

Rate limit:
  rateLimit.active, secondsRemaining, retryAfterSeconds,
  timerId, bufferedCall, error

Playback monitoring:
  playbackStatus, pollingDelayMs, lastPlaybackCorrectionAt,
  playbackRecoveryMessage

Manual setup:
  deckChecklistDone, dryRun, calibration,
  audioContext, levelToneNode, levelToneGain

LAN monitor:
  statusApiAvailable, statusPollId, remoteStatusSeen

J-card:
  jCardThemeCoverUrl
```

`state.project` is the most important long-lived data structure after a playlist is loaded or a JSON config is imported. UI state can still exist outside it, but cassette planning data should flow through the project model.

Startup restores the saved project before the first planning render and restores recording state after that render. This ordering keeps project-derived UI available before recording countdown/progress values are applied.

## Mixtape project model

`createMixtapeProject(...)` builds the project object from Spotify playlist metadata and normalized tracks.

Simplified shape:

```js
{
  configVersion,
  projectTitle,
  sourcePlaylistId,
  sourcePlaylistName,
  coverUrl,
  sourceTracks,
  selectedTapeIndex,
  tapes,
  splitMode,
  slackMarginSeconds,
  jCardOverrides,
  calibration,
  createdAt,
  updatedAt
}
```

Each item in `project.tapes` represents one physical cassette:

```js
{
  number,
  tapeNumber,
  tapeTitle,
  tapeMinutes,
  tapeFormat,
  sideLengthMs,
  sideAStartIndex,
  sideAEndIndex,
  sideBStartIndex,
  sideBEndIndex,
  sideA,
  sideB,
  jCard,
  splitMode,
  manualSplitIndex
}
```

The selected visible tape is always derived from `state.selectedTapeIndex` / `project.selectedTapeIndex`. The side lists, J-card preview, recording controls, status payload, and per-tape format UI should read from the selected tape object instead of recomputing their own separate layout.

## Render pattern

Most user actions end by calling `renderSplit()` or `renderRecordMode()`.

`renderSplit()` refreshes the planning surface:

```text
playlist title
total runtime
selected tape label
side A/B fill and track lists
physical tape selector
per-tape format controls
manual split controls
J-card preview
warnings
empty states
LAN status payload
```

`renderRecordMode()` refreshes the playback/recording surface:

```text
record mode label
active side
monitor text
button disabled states
cassette recording CSS class
seven-row Recording Readiness traffic-light panel
LAN status payload
```

It also applies the recording lock and Start Side A/B readiness gate. Start buttons are disabled unless the current side can be started, no rate-limit countdown is active, and all Recording Readiness prerequisite rows are green. While cueing, recording, paused, or waiting at the flip prompt, dangerous planning controls are disabled and `body[data-recording-state="active"]` is set. Action handlers still call guard helpers, so direct events cannot bypass the lock.

`getRecordingReadinessStatus()` is the shared source for the panel and Start Side A/B gates. The Tape row checks the loaded plan, `Tapes you have`, cassette count by format, and side overflow. The Checklist row uses the deck checklist or skip toggle. The API row reflects active and non-retryable Spotify rate-limit state.

## UI structure and responsive controls

The main input column uses `<details class="input-section">` blocks for Spotify, Playlist, Deck, Cassette, Tape planning, and Files. Spotify, Playlist, and Tape planning are open by default; lower-frequency sections can stay collapsed without removing their DOM nodes. Event handlers still bind by id, so converting a section wrapper to `<details>` should not change handler ownership as long as ids remain stable.

The page has a `.skip-link` targeting `#recordingControls`. The recording timer, progress, current track, Start/Pause/Abort buttons, cue banner, flip banner, and Start Side B button live inside `.record-controls`. On narrow viewports `.record-controls` becomes sticky at the bottom of the screen, so new recording controls should be added inside that container only when they belong in the always-reachable recording surface.

The deck checklist is also a `<details>` element. Its `change` events still bubble to the same `deckChecklist` listener, while the summary row owns the visible checklist count. Keep checklist state updates in `renderDeckChecklist()` / `updateDeckChecklistState()` rather than writing summary text directly from unrelated code.

Do not update many DOM nodes manually in new code if an existing render function already owns them. Mutate state first, then call the relevant render function.

## Spotify boundary

Spotify API calls are made from `src/app.js` through `spotifyFetch(...)`. That wrapper:

- requires a token,
- refreshes expired access tokens,
- retries once after a 401 when a refresh token exists,
- intercepts Spotify Web API 429 responses and reads `Retry-After`,
- retries non-recording 429s once after the wait,
- buffers active-recording playback commands and replays them only if the side is still active,
- converts Spotify API errors into useful error messages,
- preserves `Retry-After` metadata through `SpotifyApiError`.

Playlist track loading is intentionally centralized in `fetchAllTracks(...)`. It reads the current Spotify `/playlists/{id}/items` paging response first, follows `next` links for long playlists, accepts both `items[].item` and `items[].track`, and keeps older `tracks.items` response shapes as fallbacks. Do not add separate playlist item parsers in rendering or recording code; keep Spotify payload normalization at this boundary.

Playback starts through `playSpotify(...)`, and side playback payloads are built from the currently selected side only. This is why Record Mode can treat Side A and Side B as explicit queues.

The Recording Readiness panel uses `playbackRecoveryMessage` for actionable device/token/API guidance such as sleeping devices, target-device mismatch, idle playback after a command, rate limiting, and expired OAuth tokens.

Dry Run intentionally avoids Spotify playback API calls in recording flow. Simulated actions are written to the visible Dry Run log while cue timers, side countdowns, flip state, and completion state continue at real speed. Dry Run also exercises the same rate-limit banner/readiness path with a simulated 429.

## Local storage

The app stores small local preferences:

```text
activeCassetteId
activeDeckId
cassetteOptimizerCurrentProject
cassetteOptimizerRecordingState
cassetteProfiles
deckProfiles
spotify_client_id
spotify_client_secret only when explicitly enabled
spotify_token
spotify_selected_device
tape_inventory
tapeCollection
deck_checklist
recording_calibration
spotify_device_id
dry_run_mode
```

Do not store Spotify client secrets by default. The app only saves a client secret when the local-only checkbox is enabled.

`cassetteOptimizerCurrentProject` stores the active project using the same compact playlist-profile shape used for profile-folder exports. `cassetteOptimizerRecordingState` stores only the active recording timeline and validation anchors, not audio. `spotify_selected_device` is a sanitized UI snapshot of the selected Spotify Connect device so the Device readiness row and dropdown can recover before Spotify returns a fresh device list.

The LAN monitor server does not persist these keys. They are browser-local and origin-scoped.

## LAN monitor boundary

`server/server.js` serves the repository root and stores a sanitized status object in memory. The host browser posts `/api/status`; LAN clients fetch the same endpoint. LAN mode is monitor-only because Spotify OAuth redirect handling is restricted to localhost.

The server intentionally does not persist state, does not store tokens, and does not proxy Spotify requests.

Plain non-localhost LAN/IP clients get `body[data-host-mode="lan-monitor"]`, which hides interactive controls and enlarges monitor-critical UI: record mode, active side, countdown, progress, current track, flip prompt, and log.

HTTPS Tailscale Serve hosts ending in `.ts.net` get `body[data-host-mode="tailscale-control"]` instead. They may show Spotify PKCE login and playback controls, but the local-only Client Secret panel stays hidden. The exact `https://...ts.net/callback` URL must be registered in the Spotify app.

## Where to add future code

```text
New tape split rule        -> src/tape.js if pure, src/app.js only for UI wiring
New recording timing rule  -> src/recording.js if pure, src/app.js for timers/DOM
New J-card layout content  -> src/jcard.js and styles/ print rules
New J-card project field    -> src/app.js export/import + src/config-migration.js defaults
New Spotify helper         -> src/spotify.js if generic, src/app.js if tied to app state
New status panel behavior  -> src/app.js renderReadiness()
New LAN status field       -> src/app.js getSharedStatusPayload() and server/server.js sanitizeStatus()
New import/export field    -> src/app.js serialize/normalize functions, src/config-migration.js, and src/export.js version if format changes
```

Documentation updates are part of the change, not a follow-up. When behavior, setup, architecture, state flow, safety, or maintenance expectations change, update the relevant docs before committing and pushing.

## Deck and Cassette Profiles

Recording timing is now modeled as two local-first profile layers.

The deck profile is the primary timing source. It stores the deck name, manufacturer, model, recording delay calibration (`leaderTapeDelay`, `motorLatency`, `safetyMargin`), default slack margin, optional automatic recording level, Dolby NR support, Type II support, Type IV support, and notes. Deck data lives in `localStorage.deckProfiles`, while `localStorage.activeDeckId` stores the selected id.

The cassette profile is the secondary timing source. It stores the cassette name, manufacturer, model, type (`I` or `II`), length in minutes, optional year, condition flags (`new`, `used`, `testTape`), optional tape-specific slack, and optional leader-length offset. Cassette data lives in `localStorage.cassetteProfiles`, while `localStorage.activeCassetteId` stores the selected id.

The profile editor UI groups each selector, New button, Delete controls, and explicit Save button in the same toolbar area. Field change handlers still persist immediately, and the Save buttons call the same update functions so users have a clear manual save affordance without creating a separate write path.

`getEffectiveTimingSettings()` combines the layers:

```text
leaderTapeDelay = deck.leaderTapeDelay + (cassette.leaderLength ?? 0)
motorLatency    = deck.motorLatency
safetyMargin    = deck.safetyMargin
slackMargin     = cassette.slackMargin ?? deck.defaultSlackMargin
```

The existing Leader Tape Delay, Motor Latency, Safety Margin, and Tape Slack Margin inputs remain in the UI and now act as live editors for the active profile values. Planning, cue timing, and warning calculations use `getEffectiveTimingSettings()` rather than reading those inputs directly, with an HTML-input fallback when profile storage is empty.

Profiles can be exported and imported independently of project config. The profile export format is a versioned JSON object with `deckProfiles` and `cassetteProfiles` arrays. Deck profile JSON includes the recording delay calibration both as the legacy top-level fields and as `recordingDelayCalibration` for readable single-profile and folder exports. Imports merge by `id`: matching ids are overwritten, new ids are added, and local profiles absent from the import remain untouched.

The playlist input UI is grouped separately from profile editing. `playlistInput`, `loadBtn`, `playlistSelect`, and `loadPlaylistsBtn` live in one playlist panel so loading by pasted URL/ID and loading from the user's Spotify playlist list use the same visual area.

## Tape Collection and Profile Folder Storage

The app now separates cassette models from owned physical cassette copies.

```text
cassetteProfiles  -> reusable user-defined cassette model records
tapeCollection    -> owned physical copies linked to cassetteProfileId
tape_inventory    -> legacy/exported unprofiled C-length counts
```

First-run inventory and cassette profile storage are empty. Cassette profiles are only model definitions; owned physical copies are added and removed with the plus/minus controls in `Tapes you have`. `getTapeInventory()` now reports the owned collection grouped by cassette profile length, so planning only sees cassette copies the user explicitly added.

Each planned tape layout can store `cassetteProfileId`. The per-tape planning controls show exact owned cassette models that match the selected length and avoid offering more copies than exist in `tapeCollection`.

Profile folder export/import uses the browser File System Access API when available. Folder export writes all local config surfaces into JSON files under a `profiles/` root:

```text
profiles/deck-profiles/
profiles/cassette-profiles/
profiles/playlist-profiles/
profiles/tape-collection/
```

Deck and cassette profile files are one JSON document per profile. `playlist-profiles` stores the active project as playlist-oriented JSON. `tape-collection` stores owned physical cassette copies and legacy unprofiled inventory separately so model definitions and ownership counts can evolve independently.
