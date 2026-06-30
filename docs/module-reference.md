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

401 responses trigger at most one access-token refresh retry. A second 401 is surfaced as an expired-login condition instead of looping.

`spotifyFetch()` also owns Spotify Web API 429 handling. It reads `Retry-After` with a 5-second fallback, retries non-recording requests once, buffers active-recording playback commands for replay while the same side is still active, and never applies this logic to Spotify Accounts token requests because those use `fetchAccounts()`.

After a successful authorization-code exchange, `handleCallback()` clears `pkce_verifier` and `oauth_state` from `sessionStorage`; only the durable token bundle remains.

### Playlist functions

```text
loadPlaylist()
loadUserPlaylists()
fetchUserPlaylists()
selectUserPlaylist()
fetchAllTracks(playlistId)
fetchTracksFromPlaylistContainer(startUrl)
getPlaylistItemsContainer(page)
```

`fetchAllTracks()` prefers Spotify's `/playlists/{id}/items` paging endpoint with `limit=100`, then falls back to older playlist detail and `/tracks` shapes. The parser accepts both `items[].item` and `items[].track`, and `getPlaylistItemsContainer()` distinguishes direct paging objects from detail containers such as `tracks.items`.

When Spotify returns `403 Forbidden` for item reads but still allows playlist metadata, the caller receives an empty track list instead of a thrown error. The UI treats this as a loaded playlist with no readable tracks, not as no playlist loaded.

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
getTapeReadinessStatus(playlistReady)
getTapeInventoryShortages()
getTapePlanOverflow()
selectTapeLayout()
updatePerTapeFormat(event)
renderTapePlanSelector(totalMs)
renderPerTapeFormatControls()
countTapeFormats(exceptIndex)
```

Per-tape format changes should go through `updatePerTapeFormat()` so inventory limits and replanning stay consistent.

`getTapeReadinessStatus(...)` feeds the Recording Readiness Tape row. It blocks recording if inventory is empty, if a plan needs more cassettes than the user entered under `Tapes you have`, or if any planned side exceeds its cassette format.

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
getRecordingReadinessStatus()
assertRecordingReadinessReady(side)
renderRecordingLockState()
```

`renderSplit()` owns most planning UI. `renderRecordMode()` owns transport/recording UI.

`renderReadiness()` writes the seven Recording Readiness traffic-light rows: Spotify, Device, Playlist, Tape, Checklist, API, and Ready. The API row turns warning during Retry-After countdowns, red for non-retryable rate-limit errors, and green otherwise.

`getRecordingReadinessStatus()` is the shared readiness source for the panel and Start Side A/B gates. Recording starts are blocked unless all prerequisite rows are green.

The Tape readiness row also checks `Tapes you have`: recording is blocked when inventory is empty, when the plan needs more cassettes than entered, or when any planned side exceeds the selected cassette format.

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

Confirmation overlays resolve any pending older confirmation with `false` before showing a replacement, so rapid repeated actions do not leave unresolved promises. `Apply to Spotify` adds a large-playlist warning when the reorder must be written in more than one Spotify API batch.

`isChecklistComplete()` is the deck checklist gate for Start Side A/B and recording preflight. It returns true only when every deck checklist item is checked or the explicit skip checklist toggle is active.

`syncAutomaticDeckChecklistItems()` turns checklist items on when the app can verify them itself. Currently the Spotify device checklist row is checked automatically after a selected or active Spotify device is detected; physical deck setup rows remain manual.

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
assertRecordingReadinessReady(side)
runRecordingPreflight(side, tracks)
runRecordCue(side)
showRecordCue(side, remaining)
clearRecordCue()
buildSidePlaybackPayload(tracks, position, positionMs)
simulateDryRunAction(action)
handleRateLimit(path, options, response, data, context)
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

`handleRateLimit(...)` is the centralized Spotify 429 path. During active recording it keeps the tape timer running, shows a non-blocking warning, and stores playback commands for replay after Retry-After only if the same side is still recording.

Rate-limit countdown completion sets `state.rateLimit.active` back to false. Buffered playback replay keeps its stored call until the replay timer fires, and failures clear active state before showing the error.

`runRecordCue(...)` resolves `true` when cue completes and `false` when `clearRecordCue()` cancels it. `startSideA()` and `startSideB()` return without starting playback when a cue is cancelled by abort or replacement.

Timer ticks run through a guard so async side-completion work cannot overlap across 250 ms interval ticks.

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

Spotify progress is trusted only inside the shared 5-second drift tolerance used by the Recording Readiness status.

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

Future config versions emit a console warning before being normalized to the current schema. Track normalization drops zero-length imported tracks.

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

`cleanJCardTrackTitle(...)` removes common print-unfriendly suffixes such as remaster, parenthesized/bracketed live labels, deluxe edition, and bonus-track labels. Dash-separated live titles are preserved. Manual overrides take precedence in rendered markup.

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

`POST /api/status` accepts localhost writes without a token. Non-local writes require `STATUS_WRITE_TOKEN` on the server and a matching `x-status-write-token` request header; invalid or missing tokens return `403`. `GET /api/status` remains available to LAN monitor clients.

Invalid JSON sent to `POST /api/status` returns `400` with `Invalid JSON body`.

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

## Deck and Cassette Profile Functions

`src/app.js` now stores recording timing through two local profile layers.

Deck profile functions:

```text
loadDeckProfiles()
saveDeckProfiles(profiles)
getActiveDeck()
setActiveDeck(id)
addDeckProfile()
updateDeckProfile()
deleteActiveDeckProfile()
deleteAllDeckProfiles()
exportActiveDeckProfile()
importSingleProfile(file, "deck")
```

Deck profiles are stored in `localStorage.deckProfiles`; the selected deck id is stored separately in `localStorage.activeDeckId`. First-run deck profile storage is empty. New profiles start as blank user-owned records with timing values at zero, plus manufacturer, model, optional auto recording level, Dolby NR, Type II support, Type IV support, and notes fields. Deck profile JSON also carries `recordingDelayCalibration` with `leaderTapeDelay`, `motorLatency`, and `safetyMargin` so the delay calibration is visible in single-profile and folder exports.

Cassette profile functions:

```text
loadCassetteProfiles()
saveCassetteProfiles(profiles)
getActiveCassette()
setActiveCassette(id)
addCassetteProfile()
updateCassetteProfile()
deleteActiveCassetteProfile()
deleteAllCassetteProfiles()
exportActiveCassetteProfile()
importSingleProfile(file, "cassette")
```

Cassette profiles are stored in `localStorage.cassetteProfiles`; the selected cassette id is stored separately in `localStorage.activeCassetteId`. First-run cassette profile storage is empty. New profiles start as user-owned records with manufacturer, model, optional year, condition flags, type, length, leader offset, and slack override fields.

The Deck and Cassette profile editor controls expose explicit Save buttons (`saveDeckProfileBtn`, `saveCassetteProfileBtn`) that call the same update functions used by field change handlers. Delete and Delete all remain confirmation-gated cleanup actions. The selected deck or cassette profile can also be exported as an individual JSON file and imported independently from the all-profiles export.

Timing-sensitive `input` events for calibration, deck profile, cassette profile, and slack controls update the pending in-memory profile state immediately, then batch localStorage writes, split/render work, and log messages through `scheduleTimingDependentViews()`. `change` and button-driven saves still flush synchronously.

Deleting one or all cassette profiles also removes matching owned cassette copies from `tapeCollection` and clears exact-model selections from planned tapes.

Timing and profile import/export functions:

```text
getEffectiveTimingSettings()
exportProfiles()
importProfiles(file)
```

`getEffectiveTimingSettings()` returns `{ leaderTapeDelay, motorLatency, safetyMargin, slackMargin }`. It uses deck values as the base, adds `cassette.leaderLength` as an optional leader offset, uses cassette slack when measured, and otherwise falls back to the deck default slack margin. If no active deck exists, it reads the legacy HTML inputs directly.

`exportProfiles()` downloads `cassette-profiles-YYYY-MM-DD.json` with `version: 1`, all deck profiles, and all cassette profiles. Exported deck profiles include both the top-level timing fields and a `recordingDelayCalibration` object; imports normalize that object back into `leaderTapeDelay`, `motorLatency`, and `safetyMargin` before validation. `importProfiles(file)` validates the JSON structure, skips malformed individual profiles with `console.warn`, merges imported profiles by id, writes localStorage, and re-renders the selectors and timing-dependent planning UI.

Tape collection and folder profile functions:

```text
addTapeCollectionItem(cassetteProfileId)
getProfiledTapeInventory()
saveTapeCollection()
restoreTapeCollection()
exportProfileFolder()
importProfileFolder()
```

`tapeCollection` is stored in localStorage as owned physical cassette entries linked to cassette profile ids. `getTapeInventory()` groups those owned copies by cassette profile length so planning only sees explicitly added physical cassettes.

First-run inventory is empty. Creating a cassette profile defines a reusable cassette model only; the user adds or removes owned physical copies with plus/minus controls in `Tapes you have`. Per-tape planning can store `cassetteProfileId`, letting each planned physical cassette select an exact model from owned cassette profiles.

`exportProfileFolder()` writes a local folder tree through the File System Access API:

```text
profiles/
  deck-profiles/*.json
  cassette-profiles/*.json
  playlist-profiles/*.json
  tape-collection/owned-cassettes.json
  tape-collection/unprofiled-inventory.json
  manifest.json
```

`importProfileFolder()` reads the same tree, merges deck/cassette profile files by id, restores owned cassette collection and unprofiled inventory JSON, and imports the first playlist profile as the active project when present. Individual unreadable JSON files are skipped and logged so one corrupt file does not abort the full folder import.
