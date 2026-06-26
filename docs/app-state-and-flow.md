# App State and Flow

This document explains how `app.js` moves data through the app. It is meant for code maintenance and agent work.

## Startup flow

`init()` is called once after the module is loaded.

```text
init()
  restoreClientSecretPreference()
  applyHostMode()
  restoreToken()
  handleCallback()
  bindEvents()
  renderAuth()
  renderSplit()
  renderRecordMode()
  warnIfFileProtocol()
```

Important detail: `handleCallback()` runs during startup so the same app can process the Spotify OAuth redirect at `/callback`.

## Event binding

`bindEvents()` connects DOM IDs from `index.html` to handler functions in `app.js`.

Examples:

```text
connectBtn          -> login()
loadBtn             -> loadPlaylist()
exportConfigBtn     -> exportTapeConfig()
importConfigBtn     -> import file picker
moveSplitEarlier    -> moveManualSplit(-1)
lockSplitBtn        -> lockManualSplitFromSelect()
applyBtn            -> applyToSpotify()
startA              -> startSideA()
startB              -> startSideB()
tapeSelect          -> setTapeLength(...)
tapePlanSelect      -> selectTapeLayout()
tapeFormatList      -> updatePerTapeFormat(...)
tapeInventory       -> updateAvailableTapeFormats()
dryRunToggle        -> updateDryRun()
```

New UI controls should follow the same pattern: keep the DOM element in `index.html`, add a handler in `bindEvents()`, mutate `state`, then call the render function that owns the affected UI.

## Playlist loading flow

`loadPlaylist()` is the real start of a cassette project.

```text
parse playlist URL/ID
fetch playlist metadata
fetch all usable Spotify tracks
createMixtapeProject(...)
setProject(project)
renderSplit()
```

`fetchAllTracks()` skips local-only tracks and tracks without a usable Spotify URI. Track objects are normalized into a small shape:

```js
{
  id,
  uri,
  name,
  artists,
  duration_ms
}
```

The app should not keep full Spotify API track payloads in project state. Keep the compact track model stable so export/import stays readable.

## Project creation flow

`createMixtapeProject(...)` creates the project object and immediately builds physical tapes.

```text
createMixtapeProject(...)
  project = metadata + sourceTracks + calibration
  project.tapes = buildProjectTapes(project, tapeMinutes, [tapeMinutes])
  project.selectedTapeIndex = clampTapeIndex(...)
```

`buildProjectTapes(...)` delegates the actual split to `splitTracksIntoTapesByFormats(...)` from `tape.js`, then enriches each layout with cassette-project fields such as `tapeTitle`, `tapeFormat`, `sideLengthMs`, and `jCard`.

## State synchronization

`setProject(project)` stores the project and calls `syncStateFromProject()`.

`syncStateFromProject()` copies the selected project values into legacy UI state fields that the existing render and recording code still reads:

```text
state.playlistId
state.playlistName
state.playlistCoverUrl
state.tracks
state.selectedTapeIndex
state.tapeLayouts
state.splitIndex
state.project.calibration
```

This keeps older code paths working while the project model remains the source of truth.

When changing project data directly, call `syncStateFromProject()` before rendering.

## Tape recomputation flow

`computeSplit()` rebuilds tape layouts from `state.project.sourceTracks`.

For project mode it:

```text
read existing per-tape formats
remember manual split + J-card + title data per tape
rebuild project.tapes from source tracks and formats
restore J-card/title/manual split data where possible
update project.splitMode
syncStateFromProject()
reset recording progress
```

This is why per-tape format choices can survive replanning by tape index.

## Selected tape flow

The physical cassette selector changes `state.selectedTapeIndex` through `selectTapeLayout()`.

```text
selectTapeLayout()
  read selected index from tapePlanSelect
  clamp selected index
  write project.selectedTapeIndex
  set global tapeMinutes to selected tape's format
  reset recording progress
  renderSplit()
```

After that, all selected-tape helpers should use the selected layout instead of directly reading Tape 1.

## Manual split flow

Manual split is stored on the selected tape layout.

```text
move split earlier/later
  -> setManualSplit(splitIndex)
      -> applyManualSplitToLayout(layout, splitIndex)
      -> state.project.splitMode = "manual"
      -> replace selected tape layout
      -> syncStateFromProject()
      -> renderSplit()
```

The app only accepts manual splits where Side A still fits. Side B overflow is surfaced as a warning because a musical side ending can intentionally move pressure to Side B.

## Per-tape format flow

`updatePerTapeFormat(event)` handles changes inside the per-tape format list.

```text
read data-tape-format-index
read selected C-length
write project.tapes[index].tapeFormat
if selected tape changed, update state.tapeMinutes
computeSplit()
renderSplit()
```

Replanning continues from source playlist order. This is important: tapes are not split from their previous Side A/B arrays. They are rebuilt from `project.sourceTracks`.

## Export flow

`exportTapeConfig()` serializes the current project into a JSON file.

Important functions:

```text
syncStateFromProject()
serializeTrack(track)
serializeTape(tape)
normalizeTapeInventory(...)
downloadJson(payload, filename)
```

The export payload stores both the source tracks and per-tape layout. Source tracks are needed for future replanning; per-tape layout is needed to restore the exact current state.

## Import flow

`importTapeConfig(event)` reads a JSON file and normalizes it into the current project model.

```text
read file
JSON.parse
normalizeImportedConfig(payload)
normalize tape inventory
normalize calibration
setProject(project)
render options/inventory/calibration/split
```

`normalizeImportedConfig(...)` supports current project exports and some older field names. `normalizeImportedTape(...)` creates safe tape objects with side indexes, side arrays, format, J-card data, and manual split data.

If imported tracks are missing Spotify URIs, the app records a missing URI count. Future recording safety checks should block real Spotify recording for those tracks but still allow Dry Run.

## Recording flow

Side starts share the same pattern:

```text
startSideA/startSideB
  validate side has tracks
  detect resume vs fresh start
  set cue recordMode
  runRecordCue(side)
  set recording recordMode
  if not dryRun:
    preparePlaybackOrder()
    playSpotify(buildSidePlaybackPayload(sideTracks, 0, 0))
  startTimer()
  startPollingPlayback()
  renderRecordMode()
```

`runRecordCue()` shows the red cue first. Spotify playback starts only after the cue and configured delay have elapsed.

## Timer flow

The local timer is the authority for the visible countdown.

```text
startTimer()
  setInterval(updateTimer, 250)

updateTimer()
  currentSide = active side A or B
  elapsed = getProjectedRecordElapsed()
  remaining = side duration - elapsed
  update countdown/progress/reel visual
  auto-complete side when remaining <= 0
```

Spotify polling may improve the projected elapsed time, but stale Spotify values should not move the countdown backwards.

## Spotify monitoring flow

While recording, the app polls `/me/player` through `pollPlayback()` and then calls `syncRecordProgressFromSpotify(playback)`.

The monitor logic:

```text
check active device and current track
correct unexpected track if needed
calculate side elapsed from Spotify track position
compare with local elapsed
update playbackStatus
complete side if needed
schedule next poll with adaptive delay
```

Rate limits are handled through `SpotifyApiError.retryAfter`. Avoid adding new polling loops; reuse the existing scheduler.

## Render ownership

Use this map when deciding where a visual change belongs:

```text
Planning panel       -> renderSplit()
Tape selector        -> renderTapePlanSelector()
Per-tape formats     -> renderPerTapeFormatControls()
Manual split UI      -> renderManualSplitControls()
Warnings             -> renderWarnings()
Track lists          -> renderTracks()
J-card preview       -> renderJCard()
Recording panel      -> renderRecordMode()
Readiness chips      -> renderSpotifyStatusPanel()
LAN status payload   -> getSharedStatusPayload()
```

A common bug source is updating one visible element manually while another render function later overwrites it. Prefer changing state and using the owner render function.

## Safe change checklist

Before committing changes to `app.js`, check:

```text
Does this mutate state.project or only legacy state?
Does it need syncStateFromProject()?
Does it need resetRecordingProgress()?
Does it need renderSplit() or renderRecordMode()?
Does it work in Dry Run?
Does it work for selected Tape 2 or later?
Does it preserve imported projects without Spotify token?
Does it avoid storing secrets?
```
