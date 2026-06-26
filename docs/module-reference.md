# Module Reference

This file explains what each source file does and which functions are important when changing the code.

## index.html

`index.html` is the DOM contract for `app.js`.

Important pattern:

- Every interactive element has an `id`.
- `app.js` collects all ID elements into `el` with `document.querySelectorAll("[id]")`.
- Event handlers are attached in `bindEvents()`.

When adding a new UI control:

```text
1. Add the element and ID in index.html.
2. Add the event listener in bindEvents().
3. Store any persistent data in state/localStorage/project.
4. Re-render through the owner render function.
```

Do not rename IDs casually. `app.js` depends on them directly.

## app.js

`app.js` is the main application controller.

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
renderSpotifyStatusPanel()
renderRecordingLockState()
```

`renderSplit()` owns most planning UI. `renderRecordMode()` owns transport/recording UI.

### Safety and confirmation functions

```text
confirmPlaylistReorder()
confirmReplaceDirtyProject()
markProjectDirty()
isRecordingLockActive()
blockIfRecordingLocked(action)
renderRecordingLockState()
getRecordingLockedControls()
```

Use these shared helpers instead of adding ad hoc `confirm(...)` calls or disabling controls in only one place. `Export Backup` paths intentionally stop after downloading JSON.

### J-card functions in app.js

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

`app.js` decides which tape layout to print. `jcard.js` renders markup and cleans display titles for the given data. J-card title overrides are print-only and stored in `project.jCardOverrides`.

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
pausePlayback()
abortRecording()
startTimer()
stopTimer()
updateTimer()
completeSideA()
completeSideB()
```

`startSideA()` and `startSideB()` should stay symmetrical. If a recording safety check is added, add it to both sides or a shared helper.

`runRecordingPreflight(...)` bridges the pure `recording-preflight.js` validator to UI warnings/logging.

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

Import first calls `migrateImportedConfig(...)` from `config-migration.js`, then app-specific normalization. When adding a new project field, update serialization, app normalization, migration defaults, and consider whether `TAPE_CONFIG_VERSION` should be bumped.

### LAN status functions

```text
getSharedStatusPayload()
pushSharedStatus(force)
startSharedStatusPolling()
fetchSharedStatus()
renderRemoteStatus(status)
```

If you add a field to the LAN status payload, also add it to `server.js` `sanitizeStatus()`.

## tape.js

`tape.js` contains pure cassette planning and formatting helpers.

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

It uses `formats[tapeIndex]` when available, otherwise `fallbackMinutes`. This powers mixed-format projects like C90 + C60. Optional `slackMarginMs` extends the per-side planning limit; warnings in `app.js` are responsible for telling the user when unofficial extra tape length is being used.

### fillSide

Private helper used by the planner. Important behavior: if a single track is longer than the side length, the side still receives that track so the loop can progress and warnings can handle the overflow later.

## spotify.js

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

## recording.js

Small pure helper module for recording timeline logic.

Exports:

```text
RECORD_CUE_SECONDS
getExpectedTrackAtElapsed(tracks, elapsedMs)
```

`getExpectedTrackAtElapsed()` maps an elapsed side time to the expected track, index, track start time, and playback position. It is used by `app.js` to detect wrong Spotify playback during recording.

## recording-preflight.js

Pure recording start validator.

Exports:

```text
validateRecordingSide(options)
summarizePreflightIssues(result)
```

`validateRecordingSide(...)` checks side contents and recording prerequisites. Real recording blocks unplayable Spotify data, missing token, empty sides, invalid durations, and overlong tracks. Dry Run can tolerate missing URI/local imported data but still blocks empty sides and invalid durations.

## config-migration.js

Import compatibility module.

Exports:

```text
CURRENT_CONFIG_VERSION
migrateImportedConfig(payload)
```

It accepts legacy, current, and future JSON payloads and returns a normalized current-version payload before `app.js` performs app-specific import normalization. It supplies defaults for fields such as calibration, tape inventory, `slackMarginSeconds`, and `jCardOverrides`.

## jcard.js

Pure J-card markup renderer.

Exports:

```text
renderJCardMarkup(args)
getJCardDensityClass(trackCount)
cleanJCardTrackTitle(title)
```

Input is fully prepared by `app.js`. The renderer receives title, cover HTML, tape format, tracks, side arrays, runtimes, split index, `escapeHtml`, and optional `titleOverrides`.

The returned object is:

```js
{
  html,
  densityClass
}
```

`densityClass` helps CSS compact large tracklists.

`cleanJCardTrackTitle(...)` removes common print-unfriendly suffixes such as remaster, live, deluxe edition, and bonus-track labels. Manual overrides take precedence in rendered markup.

## export.js

Currently only contains:

```js
export const TAPE_CONFIG_VERSION = 1;
```

Bump this when the JSON project shape changes in a way import code should treat differently.

## server.js

Optional Node server for LAN monitoring.

Responsibilities:

```text
serve static app files
GET /api/status returns latest sanitized status
POST /api/status updates latest sanitized status
GET /api/health reports server status and LAN URLs
```

The server stores status in memory only. It does not store Spotify tokens and does not call Spotify.

Important function:

```text
sanitizeStatus(input)
```

It whitelists status fields before exposing them to LAN clients. Add new LAN monitor fields there deliberately.

## test/*.test.js

Automated Node test files run through `npm test` / `node --test`. Current coverage includes tape planning, config migration, recording preflight, and J-card title cleanup.

## scratch/test_playback.js

Playback regression script. It is intended to be runnable locally without Spotify login for logic and state-flow checks. New project/export regression tests should follow the same lightweight style unless a full test runner is introduced later.
