# Cassette Optimizer TODO

Short-lived active task list for the next development pass.

Focus: protect real cassette recordings from bad playback state, accidental user actions, and regressions in the new multi-tape project model.

## P0 – Recording safety

### 1. Add pre-recording track availability check

Before starting a real recording side, validate that the selected side can actually be played through Spotify.

**Goal**

Warn before recording if a side contains tracks that are likely to fail, skip, or not play through the Spotify Web API.

**Checks**

```text
Track has Spotify URI
Track is not local-only
Track has duration
Imported project has no missing track URIs
Side A / Side B contain no invalid tracks
```

**Implementation notes**

- Run the check before `Start Side A` and `Start Side B`.
- Show a clear blocking warning for missing URIs or unusable tracks.
- Allow Dry Run to continue even when Spotify URIs are missing.
- Imported JSON configs should surface missing URI counts in the UI, not only in the log.
- Keep this as a local validation first; do not over-query Spotify unless needed.

**Acceptance criteria**

- Recording cannot start in real Spotify mode when the selected side has missing track URIs.
- Dry Run still works with imported/offline project data.
- The user sees which side and track caused the problem.
- The status panel or warnings area shows the issue before recording.

**Suggested commit**

```text
feat: add pre-recording track availability check
```

---

### 2. Add recording lock mode

While a cue or recording is active, dangerous planning controls should be locked so the user cannot accidentally change the cassette plan mid-recording.

**Goal**

Disable state-changing planning controls during cue, recording, pause, and flip states.

**Controls to lock**

```text
Tape format
Per-tape format selectors
Tape inventory
Manual split controls
Import Config
Load playlist
Apply to Spotify
Playlist picker
```

**Implementation notes**

- Allow only safe recording controls: Pause, Resume, Abort, and Start Side B after flip.
- Keep read-only views visible.
- Show a small note such as `Recording lock active` while controls are disabled.
- Re-enable controls after abort or after Side B completes.
- Dry Run should use the same lock behavior because it tests the real flow.

**Acceptance criteria**

- The user cannot change tape layout while a side is being recorded or cued.
- Abort always remains available.
- The UI clearly explains why controls are disabled.
- Normal editing works again after recording ends.

**Suggested commit**

```text
feat: add recording lock mode
```

---

### 3. Add confirmation and backup prompt before applying playlist order

`Apply to Spotify` changes the user's Spotify playlist order. Add a safety step before sending the reorder request.

**Goal**

Prevent accidental playlist changes and encourage exporting a backup JSON first.

**Suggested prompt**

```text
This will reorder your Spotify playlist to match the cassette plan.
Export a backup JSON before continuing?

Cancel
Export Backup
Continue Anyway
```

**Implementation notes**

- Show the prompt before any Spotify playlist modification request.
- `Export Backup` should download the current cassette config and then let the user continue manually.
- Make clear whether the action applies the full multi-tape plan.
- Keep the existing `Apply to Spotify` behavior after confirmation.

**Acceptance criteria**

- Clicking `Apply to Spotify` never modifies the playlist without confirmation.
- The user can cancel safely.
- The user can export JSON before applying.
- The log clearly says when the playlist order was actually synced.

**Suggested commit**

```text
feat: confirm playlist reorder before apply
```

---

### 4. Improve Spotify playback recovery states

When Spotify playback does not start or the wrong device is active, the UI should guide the user instead of relying only on log messages.

**Goal**

Show actionable recovery messages in the playback/status area.

**States to handle**

```text
No active Spotify device
Selected device not active
Playback command sent but nothing started
Spotify API rate limit
Token expired or refresh failed
Expected track not playing
Playback outside selected side
```

**Implementation notes**

- Reuse the recording readiness panel where possible.
- Add retry guidance: open Spotify, refresh devices, select device, retry side start.
- Keep the log detailed, but make the main UI readable at a glance.
- Avoid retry loops that spam Spotify.

**Acceptance criteria**

- Start failure leaves the app in a clear recoverable state.
- The user sees the next practical step without opening dev tools.
- Rate limit and token errors are distinguishable from device errors.

**Suggested commit**

```text
feat: improve spotify playback recovery states
```

---

## P1 – Regression safety

### 5. Add regression tests for project model and multi-tape export/import

The new project model, mixed tape formats, inventory, manual splits, and JSON import/export need regression coverage.

**Cases to test**

```text
C90 + C60 mixed multi-tape project
Export -> Import restores the same tape count
Export -> Import restores per-tape formats
Changing Tape 2 format does not change Tape 1 format
Manual split survives export/import
J-Card uses the selected tape's own format
Tape inventory survives export/import
Dry Run can start with imported project data
```

**Implementation notes**

- Add lightweight Node tests similar to the existing playback regression script.
- Keep tests build-free and runnable from the repo root.
- Prefer pure functions from `tape.js` where possible.
- Document the command in README if a new test script is added.

**Acceptance criteria**

- Tests can be run locally without Spotify login.
- Tests fail if per-tape formats are lost during export/import.
- Tests fail if a mixed-format project is flattened into one global format.

**Suggested commit**

```text
test: add project model export regression tests
```

---

## P2 – Recording UX polish

### 6. Add side-end warning cue

Give the user an obvious warning shortly before the current cassette side ends.

**Goal**

Show visible warnings before auto-pause / flip.

**Warning points**

```text
60 seconds left
30 seconds left
10 seconds left
```

**Implementation notes**

- Add visual warning in Record Mode and LAN monitor payload.
- Avoid sound by default.
- Make the cue work in Dry Run too.
- Reset warnings when a new side starts.

**Suggested commit**

```text
feat: add side-end warning cue
```

---

### 7. Improve mobile LAN monitor layout

The LAN monitor works, but a phone should show a clearer large-status recording view.

**Goal**

Make the monitor useful on a phone next to the cassette deck.

**Mobile view priorities**

```text
Big record status
Active side
Countdown
Current track
Flip / cue warning
Progress bar
Last important log line
```

**Implementation notes**

- Use responsive CSS; no separate app needed.
- Keep LAN mode monitor-only.
- Make cue and flip states highly visible.
- Keep controls hidden on LAN IPs.

**Suggested commit**

```text
feat: improve mobile lan monitor layout
```

---

## Later ideas

These are useful, but lower priority than recording safety and regression tests.

```text
Add printable cassette shell labels
Add local project history
Add optional track gap planning
Add manual level-check track marker
```
