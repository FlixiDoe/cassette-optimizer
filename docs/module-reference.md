# Module Reference

This file explains what each source file does and which functions are important when changing the code.

## index.html

`index.html` is the DOM contract for `src/app.js`.

Important pattern:

- Every interactive element has an `id`.
- `src/app.js` collects all ID elements into `el` with `document.querySelectorAll("[id]")`.
- Event handlers are attached in `bindEvents()`.

When adding a new UI control:

```text
1. Add the element and ID in index.html.
2. Add the event listener in bindEvents().
3. Store any persistent data in state/localStorage/project.
4. Re-render through the owner render function.
```

Do not rename IDs casually. `src/app.js` depends on them directly.

## src/app.js

`src/app.js` is the main application controller.

It owns:

```text
startup/auth flow
central state object
localStorage persistence
playlist fetch and normalization
project model creation
split recomputation
manual split and per-tape format UI
import/export JSON
Spotify API wrapper and playback control
recording timer/cue/polling
DOM rendering
LAN status push/polling
```

### Important imports

```js
import { TAPE_CONFIG_VERSION } from "./export.js";
import { migrateImportedConfig } from "./config-migration.js";
import { cleanJCardTrackTitle, renderJCardMarkup } from "./jcard.js";
import { validateRecordingSide, summarizePreflightIssues } from "./recording-preflight.js";
import { RECORD_CUE_SECONDS, getExpectedTrackAtElapsed } from "./recording.js";
import { SpotifyApiError, base64Url, parsePlaylistId, pickPlaylistCover, randomBytes, sha256Base64Url } from "./spotify.js";
import { TAPE_FORMATS, analyzeTapeFitForTracks, duration, formatLongTime, formatTime, splitTracksForSide, splitTracksIntoTapes, splitTracksIntoTapesByFormats } from "./tape.js";
```

### Startup functions

```text
init()
applyHostMode()
bindEvents()
restoreToken()
persistToken()
```

`applyHostMode()` has three modes:

```text
localhost              -> full local control, optional local-only Client Secret
https://*.ts.net       -> Tailscale control mode, PKCE controls visible, Client Secret hidden
plain LAN/IP host      -> monitor-only mode, login/control hidden
```

For Tailscale control mode, the current `https://...ts.net/callback` URL must be registered in the Spotify app redirect URIs.

### Spotify auth/API functions

```text
login()
handleCallback()
refreshAccessToken()
spotifyFetch(path, options)
fetchAccounts(body)
getClientSecret()
```

`spotifyFetch()` is the only function new Spotify Web API calls should normally use. It refreshes tokens, converts common player/device failures into clearer errors, and sets recovery copy for the Recording Readiness panel.

### Playlist functions

```text
loadPlaylist()
loadUserPlaylists()
fetchUserPlaylists()
selectUserPlaylist()
fetchAllTracks(playlistId)
```

`fetchAllTracks()` reduces Spotify track payloads to the compact local track shape:

```js
{
  id,
  uri,
  name,
  artists,
  duration_ms
  is_local
}
```

Local files and tracks without URIs are skipped on live Spotify playlist loads.

### Project model functions

```text
createMixtapeProject(...)
buildProjectTapes(project, fallbackTapeMinutes, tapeFormats)
setProject(project)
syncStateFromProject()
clampTapeIndex(index, tapeCount)
```

`buildProjectTapes()` is where pure tape split output becomes full project tape objects. It applies `state.slackMarginSeconds` when calling `splitTracksIntoTapesByFormats(...)`. If a tape needs a new persistent field, add it there and in import/export normalization.

### Tape planning functions

```text
computeSplit()
setTapeLength(minutes)
renderSlackMargin()
updateSlackMargin()
updateAvailableTapeFormats()
restoreTapeInventory()
renderTapeInventory()
getTapeInventory()
getAvailableTapeFormats()
selectTapeLayout()
updatePerTapeFormat(event)
renderTapePlanSelector(totalMs)
renderPerTapeFormatControls()
countTapeFormats(exceptIndex)
```

Per-tape format changes should go through `updatePerTapeFormat()` so inventory limits and replanning stay consistent.

Slack margin changes should go through `updateSlackMargin()` so the value is clamped to 0-120 seconds, persisted in the project, marked dirty, and included in replanning.

### Manual split functions

```text
moveManualSplit(delta)
lockManualSplitFromSelect()
setManualSplit(splitIndex)
resetAutomaticSplit()
canMoveSplitLater(layout)
applyManualSplitToLayout(layout, splitIndex)
```

Manual split is stored on a tape layout. It is not a global one-tape-only setting.

### Rendering functions

```text
renderAuth()
renderSplit()
renderTapeRecommendation(totalMs)
renderSplitExplanation(sideATracks, sideLengthMs)
renderManualSplitControls(a, b, sideLengthMs)
renderTracks(container, tracks, offset)
renderWarnings(totalMs, tapeMs, halfMs)
renderEmptyStates()
renderRecordMode(monitorText)
renderReadiness()
renderRecordingLockState()
startWizard()
advanceWizard()
retreatWizard()
exitWizard()
```

`renderSplit()` owns most planning UI. `renderRecordMode()` owns transport/recording UI.

`renderReadiness()` writes the seven Recording Readiness traffic-light rows: Spotify, Device, Playlist, Tape, Checklist, API, and Ready. The API row is a green placeholder until the Spotify 429 handling path supplies live rate-limit state.

The First Tape Wizard is a session-only controller in `src/app.js`. It does not duplicate playlist, tape, checklist, level-check, dry-run, or recording logic; each step scrolls to existing UI and the final Start recording action calls `startSideA()`.

### Safety and confirmation functions

```text
confirmPlaylistReorder()
confirmReplaceDirtyProject()
markProjectDirty()
isChecklistComplete()
isRecordingLockActive()
blockIfRecordingLocked(action)
renderRecordingLockState()
getRecordingLockedControls()
```

Use these shared helpers instead of adding ad hoc `confirm(...)` calls or disabling controls in only one place. `Export Backup` paths intentionally stop after downloading JSON.

`isChecklistComplete()` is the deck checklist gate for Start Side A/B and recording preflight. It returns true only when every deck checklist item is checked or the explicit skip checklist toggle is active.

### J-card functions in src/app.js

```text
renderJCard(a, b, aMs, bMs, totalMs, renderOverrides)
renderJCardOverrides(tracks)
updateJCardOverride(event)
printJCards(mode)
renderJCardPrint(mode)
renderJCardForLayout(layout)
getVolumeTitle(layout)
getTrackKey(track)
```

`src/app.js` decides which tape layout to print. `src/jcard.js` renders markup and cleans display titles for the given data. J-card title overrides are print-only and stored in `project.jCardOverrides`.

### Level-check functions

```text
startLevelTone()
stopLevelTone()
createToneOscillator(context, frequency)
createPinkNoiseSource(context)
dbToGain(db)
getLevelToneLabel()
```

The level-check source uses the Web Audio API. It must only start from explicit user interaction and after the warning confirmation.

### Recording functions

```text
startSideA()
startSideB()
runRecordingPreflight(side, tracks)
runRecordCue(side)
showRecordCue(side, remaining)
clearRecordCue()
buildSidePlaybackPayload(tracks, position, positionMs)
simulateDryRunAction(action)
pausePlayback()
abortRecording()
startTimer()
stopTimer()
updateTimer()
completeSideA()
completeSideB()
```

`startSideA()` and `startSideB()` should stay symmetrical. If a recording safety check is added, add it to both sides or a shared helper.

`runRecordingPreflight(...)` bridges the pure `src/recording-preflight.js` validator to UI warnings/logging.

`simulateDryRunAction(...)` is the recording-flow Dry Run boundary. It logs would-be playback commands to the console and visible Dry Run log without calling Spotify, while the cue countdown, timers, flip prompt, and completion transitions continue at real speed.

### Spotify monitoring functions

```text
startPollingPlayback()
stopPollingPlayback()
schedulePlaybackPoll(delayMs)
pollPlayback()
syncRecordProgressFromSpotify(playback)
correctUnexpectedPlaybackTrack(tracks, playback)
setPlaybackRecovery(message)
getSpotifySideElapsed(tracks, uri, progressMs)
getLocalRecordElapsed()
getProjectedRecordElapsed()
```

The local timer is the primary timeline. Spotify playback is used to correct drift and wrong-track jumps, not as the only clock.

`setPlaybackRecovery(...)` updates the Recording Readiness panel with actionable recovery text.

### Export/import functions

```text
exportTapeConfig()
importTapeConfig(event)
normalizeImportedConfig(payload)
normalizeImportedTape(tape, index, sourceTracks)
normalizeTracks(tracks)
serializeTape(tape)
serializeTrack(track)
normalizeTapeFormats(values, fallback)
normalizeTapeInventory(value, fallbackFormats)
downloadJson(payload, filename)
```

Import first calls `migrateImportedConfig(...)` from `src/config-migration.js`, then app-specific normalization. When adding a new project field, update serialization, app normalization, migration defaults, and consider whether `TAPE_CONFIG_VERSION` should be bumped.

### LAN status functions

```text
getSharedStatusPayload()
pushSharedStatus(force)
startSharedStatusPolling()
fetchSharedStatus()
renderRemoteStatus(status)
```

If you add a field to the LAN status payload, also add it to `server/server.js` `sanitizeStatus()`.

## src/tape.js

`src/tape.js` contains pure cassette planning and formatting helpers.

Exports:

```text
TAPE_FORMATS
splitTracksForSide(tracks, sideLengthMs)
splitTracksIntoTapes(tracks, minutes)
splitTracksIntoTapesByFormats(tracks, formats, fallbackMinutes, slackMarginMs)
analyzeTapeFitForTracks(tracks, minutes)
applyManualSplitToTapeLayout(layout, tracks, splitIndex)
duration(tracks)
formatTime(ms)
formatLongTime(ms)
```

### splitTracksForSide

Greedy side split helper. It walks tracks in order until adding the next track would exceed `sideLengthMs`.

Returns:

```js
{ split, sideAMs }
```

### splitTracksIntoTapesByFormats

Main multi-tape planner. It walks the original track list with a cursor and creates tape layouts:

```text
Tape 1 Side A
Tape 1 Side B
Tape 2 Side A
Tape 2 Side B
...
```

It uses `formats[tapeIndex]` when available, otherwise `fallbackMinutes`. This powers mixed-format projects like C90 + C60. Optional `slackMarginMs` extends the per-side planning limit; warnings in `src/app.js` are responsible for telling the user when unofficial extra tape length is being used.

### fillSide

Private helper used by the planner. Important behavior: if a single track is longer than the side length, the side still receives that track so the loop can progress and warnings can handle the overflow later.

## src/spotify.js

Small helper module for Spotify-related utilities.

Exports:

```text
SpotifyApiError
parsePlaylistId(value)
pickPlaylistCover(images)
randomBytes(length)
sha256Base64Url(value)
base64Url(bytes)
```

`SpotifyApiError` stores HTTP status, `Retry-After`, and Spotify error payload data. This is used by playback polling to respect rate limits.

`parsePlaylistId()` accepts Spotify playlist URLs and raw playlist IDs.

`sha256Base64Url()` and `base64Url()` support the PKCE login flow.

## src/recording.js

Small pure helper module for recording timeline logic.

Exports:

```text
RECORD_CUE_SECONDS
getExpectedTrackAtElapsed(tracks, elapsedMs)
```

`getExpectedTrackAtElapsed()` maps an elapsed side time to the expected track, index, track start time, and playback position. It is used by `src/app.js` to detect wrong Spotify playback during recording.

## src/recording-preflight.js

Pure recording start validator.

Exports:

```text
validateRecordingSide(options)
summarizePreflightIssues(result)
```

`validateRecordingSide(...)` checks side contents and recording prerequisites. Real recording blocks unplayable Spotify data, missing token, empty sides, invalid durations, and overlong tracks. Dry Run can tolerate missing URI/local imported data but still blocks empty sides and invalid durations.

## src/config-migration.js

Import compatibility module.

Exports:

```text
CURRENT_CONFIG_VERSION
migrateImportedConfig(payload)
```

It accepts legacy, current, and future JSON payloads and returns a normalized current-version payload before `src/app.js` performs app-specific import normalization. It supplies defaults for fields such as calibration, tape inventory, `slackMarginSeconds`, and `jCardOverrides`.

## src/jcard.js

Pure J-card markup renderer.

Exports:

```text
renderJCardMarkup(args)
getJCardDensityClass(trackCount)
cleanJCardTrackTitle(title)
```

Input is fully prepared by `src/app.js`. The renderer receives title, cover HTML, tape format, tracks, side arrays, runtimes, split index, `escapeHtml`, and optional `titleOverrides`.

The returned object is:

```js
{
  html,
  densityClass
}
```

`densityClass` helps CSS compact large tracklists.

`cleanJCardTrackTitle(...)` removes common print-unfriendly suffixes such as remaster, live, deluxe edition, and bonus-track labels. Manual overrides take precedence in rendered markup.

## src/export.js

Currently only contains:

```js
export const TAPE_CONFIG_VERSION = 1;
```

Bump this when the JSON project shape changes in a way import code should treat differently.

## server/server.js

Optional Node server for LAN monitoring.

Responsibilities:

```text
serve static app files
GET /api/status returns latest sanitized status
POST /api/status updates latest sanitized status
GET /api/health reports server status and LAN URLs
```

The server stores status in memory only. It does not store Spotify tokens and does not call Spotify.

The server is ES module code and accepts cross-platform CLI options:

```text
node server/server.js --host 127.0.0.1 --port 8787
node server/server.js --host 0.0.0.0 --port 8787
```

`HOST` and `PORT` environment variables are still supported, but `npm run start:local` and `npm run start:lan` are the preferred OS-neutral entrypoints. Convenience wrappers live in `scripts/`.

Important function:

```text
sanitizeStatus(input)
```

It whitelists status fields before exposing them to LAN clients. Add new LAN monitor fields there deliberately.

## test/*.test.js

Automated Node test files run through `npm test` / `node --test`. Current coverage includes tape planning, config migration, recording preflight, and J-card title cleanup.

## scratch/*.cjs

Scratch regression scripts are CommonJS `.cjs` files so they can run in this ESM project without transpilation. They are intended to be runnable locally without Spotify login for logic and state-flow checks. New project/export regression tests should follow the same lightweight style unless they belong in the automated `test/` suite.
