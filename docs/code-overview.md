# Code Overview

This document explains how the code is organized. It is about implementation, state, and function responsibility, not the user-facing feature list.

## Runtime shape

Cassette Optimizer is a static browser app. `index.html` loads `styles.css` and `app.js` directly:

```html
<link rel="stylesheet" href="styles.css">
<script type="module" src="app.js"></script>
```

There is no frontend build step. The local PowerShell launcher starts a Python static server on `127.0.0.1:8787`. The optional LAN launcher starts `server.js`, which serves the same static files and exposes a tiny status API.

## Main files

```text
index.html        DOM structure and element IDs used by app.js
styles.css        Layout, cassette visual, print layout, responsive behavior
app.js            Main controller, state, event wiring, Spotify calls, rendering
spotify.js        Small Spotify/auth helper functions and SpotifyApiError
recording.js      Recording timing helper for expected-track calculation
tape.js           Pure cassette split, duration, and formatting logic
jcard.js          Pure J-card markup rendering
export.js         Current config version constant
server.js         Optional LAN monitor static server and /api/status endpoint
```

## Code ownership boundaries

`app.js` is intentionally the orchestration layer. It owns browser state, DOM events, Spotify network calls, rendering, recording mode, import/export, and localStorage persistence.

The smaller modules are kept mostly pure:

- `tape.js` does not touch the DOM or Spotify.
- `recording.js` does not touch the DOM or Spotify.
- `jcard.js` returns HTML strings but does not decide which tape is active.
- `spotify.js` only contains helpers for OAuth/Spotify parsing and error metadata.
- `server.js` does not know Spotify tokens and only mirrors sanitized UI status.

When adding new logic, prefer putting pure calculations in a small module and leaving `app.js` as the coordinator.

## Main data flow

```text
Browser loads index.html
        ↓
app.js init()
        ↓
restore local settings and token
        ↓
bind DOM events
        ↓
user loads Spotify playlist
        ↓
fetch tracks from Spotify
        ↓
createMixtapeProject(...)
        ↓
build project.tapes[] from tape.js split logic
        ↓
renderSplit() updates all visible planning, recording, and J-card UI
        ↓
Record Mode starts one selected side through Spotify or Dry Run
```

## Central state

`app.js` keeps one central `state` object. Important groups inside it:

```text
Spotify session:
  token, refreshToken, expiresAt, selectedDeviceId, devices

Playlist/project:
  playlistId, playlistName, playlistCoverUrl, tracks, project

Tape planning:
  tapeMinutes, availableTapeFormats, tapeInventory,
  tapeLayouts, selectedTapeIndex, splitIndex

Recording:
  recordMode, activeRecordSide, sideAStartedAt,
  sideAElapsedBeforePause, spotifySideElapsedMs,
  timerId, cueTimerId, pollingId

Playback monitoring:
  playbackStatus, pollingDelayMs, lastPlaybackCorrectionAt

Manual setup:
  deckChecklistDone, dryRun, calibration

LAN monitor:
  statusApiAvailable, statusPollId, remoteStatusSeen
```

`state.project` is the most important long-lived data structure after a playlist is loaded or a JSON config is imported. UI state can still exist outside it, but cassette planning data should flow through the project model.

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
readiness/status chips
LAN status payload
```

Do not update many DOM nodes manually in new code if an existing render function already owns them. Mutate state first, then call the relevant render function.

## Spotify boundary

Spotify API calls are made from `app.js` through `spotifyFetch(...)`. That wrapper:

- requires a token,
- refreshes expired access tokens,
- retries once after a 401 when a refresh token exists,
- converts Spotify API errors into useful error messages,
- preserves `Retry-After` metadata through `SpotifyApiError`.

Playback starts through `playSpotify(...)`, and side playback payloads are built from the currently selected side only. This is why Record Mode can treat Side A and Side B as explicit queues.

## Local storage

The app stores small local preferences:

```text
spotify_client_id
spotify_client_secret only when explicitly enabled
spotify_token
tape_inventory
deck_checklist
recording_calibration
spotify_device_id
dry_run
```

Do not store Spotify client secrets by default. The app only saves a client secret when the local-only checkbox is enabled.

## LAN monitor boundary

`server.js` serves files and stores a sanitized status object in memory. The host browser posts `/api/status`; LAN clients fetch the same endpoint. LAN mode is monitor-only because Spotify OAuth redirect handling is restricted to localhost.

The server intentionally does not persist state, does not store tokens, and does not proxy Spotify requests.

## Where to add future code

```text
New tape split rule        -> tape.js if pure, app.js only for UI wiring
New recording timing rule  -> recording.js if pure, app.js for timers/DOM
New J-card layout content  -> jcard.js and styles.css print rules
New Spotify helper         -> spotify.js if generic, app.js if tied to app state
New status panel behavior  -> app.js renderSpotifyStatusPanel()
New LAN status field       -> app.js getSharedStatusPayload() and server.js sanitizeStatus()
New import/export field    -> app.js serialize/normalize functions and export.js version if format changes
```
