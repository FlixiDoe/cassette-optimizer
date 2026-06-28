# App State and Flow

This document explains how `src/app.js` moves data through the app. It is meant for code maintenance and agent work.

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

`applyHostMode()` leaves localhost in full-control mode, enables full PKCE control on HTTPS Tailscale hosts ending in `.ts.net`, and keeps plain LAN/IP hosts monitor-only. Tailscale control still hides the local-only Client Secret panel.

## Event binding

`bindEvents()` connects DOM IDs from `index.html` to handler functions in `src/app.js`.

Examples:

```text
connectBtn          -> login()
loadBtn             -> loadPlaylist()
exportConfigBtn     -> exportTapeConfig()
importConfigBtn     -> import file picker
slackMargin         -> updateSlackMargin()
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
startLevelToneBtn   -> startLevelTone()
stopLevelToneBtn    -> stopLevelTone()
jCardOverrides      -> updateJCardOverride()
startWizardBtn      -> startWizard()
wizardNextBtn       -> advanceWizard()
wizardBackBtn       -> retreatWizard()
wizardExitBtn       -> exitWizard()
```

New UI controls should follow the same pattern: keep the DOM element in `index.html`, add a handler in `bindEvents()`, mutate `state`, then call the render function that owns the affected UI.

## First Tape Wizard flow

The First Tape Wizard keeps `wizardActive`, `wizardStep`, and `wizardDryRunComplete` in memory only. It resets on page close and does not write to localStorage or the project model.

```text
Step 1 - Select playlist      -> existing playlist input/load UI
Step 2 - Select cassette      -> existing tape format UI
Step 3 - Deck checklist       -> existing deck checklist, gated by isChecklistComplete()
Step 4 - Level check          -> existing level-check block, gated by all level checkpoints
Step 5 - Dry run              -> existing Dry Run flow, gated by dry-run completion
Step 6 - Start recording      -> calls startSideA()
```

The wizard shows one step title at a time and scrolls to the existing block for that step. It never creates a wizard-specific recording path.

## Playlist loading flow

`loadPlaylist()` is the real start of a cassette project.

```text
parse playlist URL/ID
confirm replacing unsaved project if dirty
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
  project = metadata + sourceTracks + calibration + slack/J-card defaults
  project.tapes = buildProjectTapes(project, tapeMinutes, [tapeMinutes])
  project.selectedTapeIndex = clampTapeIndex(...)
```

`buildProjectTapes(...)` delegates the actual split to `splitTracksIntoTapesByFormats(...)` from `src/tape.js`, then enriches each layout with cassette-project fields such as `tapeTitle`, `tapeFormat`, `sideLengthMs`, and `jCard`.

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
state.slackMarginSeconds
state.project.slackMarginSeconds
state.project.jCardOverrides
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

`Tape Slack Margin (seconds)` is applied during this rebuild by extending each side's planning limit. Warnings still call out unofficial extra tape length when the plan uses space beyond the official side length.

## Tape inventory readiness flow

`Tapes you have` is part of Recording Readiness, not just a planning hint.

```text
updateAvailableTapeFormats()
  read C-length quantities from tapeInventory inputs
  normalize quantities, preserving 0 when the user has no tapes
  recompute available tape formats
  rebuild split plan
  renderSplit()
  renderRecordMode()
```

`getTapeReadinessStatus(...)` blocks recording when:

```text
no playlist is loaded
no selected tape layout exists
all inventory quantities are 0
the current plan needs more tapes of a format than inventory provides
any planned side exceeds its cassette format capacity
```

The Tape row in Recording Readiness shows the specific inventory shortage or side overflow, and Start Side A/B remains blocked until the Tape row is green.

## Selected tape flow

The physical cassette selector changes `state.selectedTapeIndex` through `selectTapeLayout()`.

```text
selectTapeLayout()
  read selected index from tapePlanSelect
  clamp selected index
  write project.selectedTapeIndex
  set global tapeMinutes to selected tape's format
  mark project dirty
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
      -> mark project dirty
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
mark project dirty
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

Export also clears `state.projectDirty`, because the current local plan has just been backed up.

## Import flow

`importTapeConfig(event)` reads a JSON file and normalizes it into the current project model.

```text
read file
confirm replacing unsaved project if dirty
JSON.parse
migrateImportedConfig(payload)
normalizeImportedConfig(migratedPayload)
normalize tape inventory
normalize calibration
normalize slack margin and J-card overrides
setProject(project)
render options/inventory/slack/calibration/split
```

`migrateImportedConfig(...)` from `src/config-migration.js` is the compatibility layer for legacy, current, and future config payloads. `normalizeImportedConfig(...)` then creates the app project model. `normalizeImportedTape(...)` creates safe tape objects with side indexes, side arrays, format, J-card data, and manual split data.

If imported tracks are missing Spotify URIs, the app records a missing URI count. Future recording safety checks should block real Spotify recording for those tracks but still allow Dry Run.

## Recording flow

Side starts share the same pattern:

```text
startSideA/startSideB
  validate side has tracks
  assertRecordingReadinessReady(side)
  runRecordingPreflight(side, tracks)
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

`assertRecordingReadinessReady(...)` is the hard click guard behind the disabled Start buttons. It uses the same `getRecordingReadinessStatus()` rows shown in the panel, so recording cannot start unless Spotify, Device, Playlist, Tape, Checklist, and API are all green.

`runRecordingPreflight(...)` calls the pure `validateRecordingSide(...)` helper. Real recording blocks missing Spotify URI, local-only tracks, missing duration, empty sides, missing token, tracks longer than the selected side, and unsafe device/checklist state. Dry Run may continue with imported/offline URI data, but still blocks empty sides and invalid durations.

When Dry Run is active, recording-flow Spotify playback commands are routed through `simulateDryRunAction(...)` instead of `spotifyFetch(...)`. The visible DRY RUN banner and log make the simulation explicit, while cue delays, motor/leader timing, side countdowns, flip state, and return-to-idle behavior still run at real speed.

Dry Run also simulates one Spotify 429 during the Side A countdown and routes it through the same visible rate-limit banner, countdown, button-disable, and Readiness API-row path used by real 429 handling.

While `recordMode` is `cue_a`, `cue_b`, `recording_a`, `recording_b`, `paused`, or `flip`, `renderRecordingLockState()` disables dangerous planning controls and sets `body[data-recording-state="active"]`. Each dangerous handler also calls `blockIfRecordingLocked(...)`.

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

Playback/device recovery text is surfaced through `setPlaybackRecovery(...)` and rendered by `renderReadiness()`. Use that path for user-actionable Spotify failures instead of logging only to the console.

## Spotify rate-limit flow

All Spotify Web API calls go through `spotifyFetch(...)`. When Spotify returns HTTP 429, `handleRateLimit(...)` reads `Retry-After` in seconds and defaults to 5 seconds if the header is missing.

Outside active recording, the failed request waits for the countdown and retries once. If the second attempt returns 429, the API row turns red and the error is surfaced instead of retrying indefinitely.

During active recording, playback commands are buffered with their target side. The cassette countdown is not paused. After the countdown, the command replays only if the same side is still actively recording; otherwise it is discarded.

The rate-limit banner disables Start Side A, Start Side B, Refresh Devices, and Refresh Playlists while the countdown runs. The Recording Readiness API row shows warning during countdown, red for non-retryable errors, and green otherwise.

## Remote playlist reorder flow

`applyToSpotify()` never sends playlist reorder requests immediately.

```text
applyToSpotify()
  block if recording lock is active
  require project tracks
  confirmPlaylistReorder()
    Cancel          -> stop
    Export Backup   -> export JSON, stop
    Continue Anyway -> send PUT/POST playlist track requests
```

This keeps a local backup path available before the remote playlist sequence changes.

## Dirty project flow

`state.projectDirty` tracks local edits after load/import/export. It is set by tape format changes, tape inventory changes, selected tape changes, manual split changes, calibration changes, slack margin changes, and J-card title overrides.

Before a new playlist or config import replaces the current project:

```text
confirmReplaceDirtyProject()
  Cancel          -> stop
  Export Backup   -> export JSON, stop
  Replace Anyway  -> continue replacement
```

`Export Backup` never continues replacement automatically.

## Level-check tone flow

The level-check helper shows seven compact, informational setup checkpoints before the tone controls. Those checkboxes help the operator verify Spotify quality, crossfade, normalization, EQ, system volume, deck record-pause, and clipping, but they do not gate Start Side A or Start Side B.

The level-check tone uses the Web Audio API and only starts after a user click plus confirmation dialog.

```text
startLevelTone()
  confirm warning
  create/resume AudioContext
  create sine oscillator or pink-noise BufferSource
  set gain from selected dBFS
  connect to destination

stopLevelTone()
  stop/disconnect source
  re-enable Level Check button
```

No audio is auto-started during page load.

## J-card flow

`renderJCard()` owns the selected tape preview. It now also:

```text
extracts a cover-derived theme color when possible
passes project.jCardOverrides into src/jcard.js
renders print-only title override inputs
updates print markup for selected/all tapes
```

`src/jcard.js` performs automatic title cleanup for common suffixes such as remasters, live versions, and deluxe editions. Manual overrides are keyed by track URI/ID and affect printed J-card text only; underlying Spotify/project track names are not changed.

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
J-card title editor  -> renderJCardOverrides()
Recording panel      -> renderRecordMode()
Readiness panel      -> renderReadiness()
LAN status payload   -> getSharedStatusPayload()
```

A common bug source is updating one visible element manually while another render function later overwrites it. Prefer changing state and using the owner render function.

## Safe change checklist

Before committing changes to `src/app.js`, check:

```text
Does this mutate state.project or only legacy state?
Does it need syncStateFromProject()?
Does it need resetRecordingProgress()?
Does it need renderSplit() or renderRecordMode()?
Does it work in Dry Run?
Does it work for selected Tape 2 or later?
Does it preserve imported projects without Spotify token?
Does it preserve projectDirty correctly?
Does it respect recording lock guards?
Does it avoid storing secrets?
Did relevant docs change in the same commit?
```

## Profile Selection Flow

Deck and cassette profiles are initialized during `init()` before the main render path. First-run startup creates the default deck and cassette profiles only when their localStorage keys are absent.

```text
init()
  initializeDeckProfiles()
  initializeCassetteProfiles()
  bindEvents()
  renderProfileControls()
  renderAuth()
  renderSplit()
```

The profile selectors write only active ids:

```text
deckProfileSelect      -> setActiveDeck(...)
cassetteProfileSelect  -> setActiveCassette(...)
```

The active profile data remains in the profile arrays. This keeps selection stable when imports overwrite profile objects by id.

The existing timing inputs are profile editors:

```text
leadInDelay     -> active deck leaderTapeDelay
motorLatency    -> active deck motorLatency
safetyMargin    -> active deck safetyMargin
slackMargin     -> active deck defaultSlackMargin, unless the active cassette has a slack override
```

Cassette-specific fields edit the active cassette profile:

```text
cassetteProfileName
cassetteProfileType
cassetteProfileLength
cassetteLeaderLength
cassetteSlackMargin
```

After a profile selection or edit, `recomputeTimingDependentViews(...)` recomputes tape planning when tracks exist, re-renders selector/input state, updates recording UI, and logs the change.

## Profile Import Flow

Profile import is separate from tape config import.

```text
Import profiles button
  -> hidden importProfilesFile input
  -> importProfiles(file)
      -> FileReader reads JSON
      -> validate deckProfiles and cassetteProfiles arrays
      -> validate individual entries
      -> skip malformed entries with console.warn
      -> merge valid entries by id
      -> saveDeckProfiles(...)
      -> saveCassetteProfiles(...)
      -> preserve active ids when still present
      -> renderProfileControls()
      -> recomputeTimingDependentViews(...)
```

The merge strategy is intentionally non-destructive. Imported profiles overwrite local profiles with the same id, imported new ids are added, and local profiles not included in the export are kept.
