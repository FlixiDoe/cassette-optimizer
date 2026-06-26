# Cassette Optimizer TODO

Prioritized roadmap for the next implementation steps.

## P0 – Release blockers

### 1. Introduce Mixtape Project model

The app should treat the result as a cassette project, not just a temporary playlist calculation. This should come before per-tape format selection so multi-tape state has one clean source of truth.

**Status: Implemented**

**Goal**

Create a central project object that can power UI state, JSON export/import, J-Card rendering, recording, and per-tape format selection.

**Project shape**

```text
projectTitle
sourcePlaylistId
sourcePlaylistName
coverUrl
selectedTapeIndex
tapes[]
  tapeNumber
  tapeTitle
  tapeFormat
  sideLengthMs
  sideA[]
  sideB[]
  jCard
splitMode
calibration
createdAt
updatedAt
```

**Implementation notes**

- Use the project object as the source of truth after playlist load/import.
- Model multi-tape projects as an array of physical tape objects.
- Store `tapeFormat`, `sideLengthMs`, Side A, Side B, and J-Card data per tape.
- Avoid duplicating state between split rendering, J-Card, recording, and export/import.
- When the selected physical tape changes, the UI should read from `project.tapes[selectedTapeIndex]`.
- Make future tape inventory support easier.

**Acceptance criteria**

- The app has one central project object after playlist load or import.
- Each physical tape is represented as its own object.
- J-Card, recording, and UI side lists read from the same tape object.
- Future per-tape format selection can be implemented without adding parallel state.

**Suggested commit**

```text
refactor: introduce mixtape project model
```

---

### 2. Add per-tape format selection for multi-tape projects

Multi-tape projects should not use one global tape format for every physical cassette. If a playlist spans multiple tapes, each tape needs its own tape format selector because users may have mixed cassette lengths available, for example Tape 1 as C90 and Tape 2 as C60.

**Goal**

Replace or extend the global `Tape format` selector with per-tape format selection when the project contains more than one tape.

Example UI:

```text
Tape 1 format: C90 - 1:30:00 total / 45:00 per side
Tape 2 format: C60 - 1:00:00 total / 30:00 per side
Tape 3 format: C90 - 1:30:00 total / 45:00 per side
```

**Implementation notes**

- Keep a default/global tape format for simple one-tape projects.
- For multi-tape projects, show one selector per physical tape.
- Changing the format of one tape should update that tape object in the central project model.
- If recalculating one tape changes track overflow, continue filling later tapes while preserving original track order.
- Show warnings when a selected tape format cannot fit its assigned tracks.
- Make Side A / Side B lists update based on the currently selected physical tape.
- J-Cards must use the tape format of their own tape, not a global tape format.
- Recording controls must use the selected physical tape's side lengths.
- Export/import JSON should store `tapeFormat` per tape.
- Future tape inventory quantities should limit how often each format can be selected.

**Acceptance criteria**

- A multi-tape project can use mixed formats such as Tape 1 C90 and Tape 2 C60.
- Each tape shows its own total runtime and side length.
- Changing Tape 2 format does not silently change Tape 1 format.
- J-Card for Tape 2 prints with Tape 2's own format.
- Record Mode for Tape 2 uses Tape 2's side length.
- Exported project JSON restores all per-tape format choices.

**Suggested commit**

```text
feat: add per-tape format selection
```

---

### 3. Export and import tape configuration as JSON

After optimizing a mixtape, the user should be able to save and restore the exact tape layout.

**Goal**

Add `Export Config` and `Import Config` buttons.

**Export should include**

- App config version
- Project title
- Playlist ID
- Playlist name
- Playlist cover URL
- Selected tape index
- Available tape formats
- Full `tapes[]` array
- Per-tape format choices
- Per-tape Side A and Side B tracks
- Per-tape J-Card data
- Track names, artists, durations, and URIs
- Timestamps
- Split mode: automatic or manual
- Recording calibration settings

**Import should**

- Load a saved JSON file.
- Restore the full project model.
- Restore all physical tapes.
- Restore per-tape format choices.
- Restore Side A / Side B for every tape.
- Restore J-Card data.
- Work without fetching the Spotify playlist again.
- Warn if Spotify playback control needs reconnection.

**Suggested commit**

```text
feat: add tape config export and import
```

---

## P1 – Important usability features

### 4. Explain split logic in the UI

Users should understand why the app chose the current Side A / Side B split.

**Goal**

Show a small explanation near the split recommendation.

**Suggested UI copy**

```text
Why this split?
Side A is filled until the next track would exceed the selected side length.
Original playlist order is preserved.
No tracks are cut.
```

**Implementation notes**

- Display the explanation under the tape recommendation or split point.
- Add dynamic values when possible:
  - selected side length
  - time left on Side A
  - next track that would not fit
- Keep the text short so it does not clutter the UI.

**Acceptance criteria**

- User can understand the split without reading the source code.
- The explanation updates when tape format changes.
- The explanation updates when playlist changes.

**Suggested commit**

```text
feat: explain tape split decision
```

---

### 5. Add manual split override

The automatic split is useful, but mixtapes sometimes need a musical side ending.

**Goal**

Let the user manually move or lock the Side A / Side B split while preserving tape constraints.

**Controls**

```text
Move split earlier
Move split later
Lock split after this track
Reset to automatic split
```

**Implementation notes**

- Allow moving the split later only if Side A still fits.
- Show a warning if the user tries to exceed side length.
- Store whether the current split is automatic or manual.
- Include manual split state in JSON export/import.

**Acceptance criteria**

- User can intentionally end Side A earlier.
- User cannot accidentally create an impossible Side A without a warning.
- Reset returns to the automatic split.

**Suggested commit**

```text
feat: add manual tape split override
```

---

### 6. Add Spotify status panel

The log is useful, but recording mode needs a clearer status overview.

**Goal**

Show an always-visible status panel for playback readiness.

**Status items**

```text
Spotify connected
Device selected
Device active
Expected track playing
Playback in sync
Dry Run enabled/disabled
Audio quality checklist confirmed
```

**Implementation notes**

- Use simple status chips or an indicator list.
- Keep it readable at a glance.
- Show warnings before the user starts recording.
- Include a manual confirmation for the Spotify / Windows audio settings checklist.

**Suggested commit**

```text
feat: add spotify recording status panel
```

---

## P2 – UI polish and output improvements

### 7. Reel animation

Make the cassette visual feel alive during Record Mode.

**Goal**

- Rotate both reels while recording.
- Stop animation while paused or idle.
- Simulate tape movement by changing reel fill/scale.
- Respect `prefers-reduced-motion`.

**Suggested commit**

```text
feat: animate cassette reels during recording
```

---

### 8. Better warning system

Add clearer warnings for cassette planning and Spotify playback.

**Warnings to add**

- Track too long for one side.
- Playlist longer than selected tape.
- Side has less than the configured safety margin remaining.
- Spotify device missing.
- Imported config has missing/unavailable track URIs.
- Print layout may need two pages because the tracklist is long.
- Client Secret is configured while not on localhost.
- Manual split exceeds side length.
- Audio quality checklist has not been confirmed before recording.
- One selected tape format cannot fit its assigned tracks.
- A later tape overflows after changing an earlier tape format.

**Suggested commit**

```text
feat: improve tape fit warnings
```

---

### 9. Add better empty and error states

The UI should guide users when nothing is loaded or Spotify is unavailable.

**States to improve**

- No playlist loaded.
- Spotify not connected.
- No active device.
- Playlist has no usable tracks.
- Imported config is invalid.
- LAN monitor has no active host status yet.

**Suggested commit**

```text
feat: improve empty and error states
```

---

## P3 – Larger roadmap features

### 10. Tape inventory with quantity

The app should know how many physical tapes are available.

**Goal**

Example:

```text
C60: 2 available
C90: 1 available
C120: 0 available
```

Use this for:

- better recommendations
- multi-tape splitting
- warnings when a playlist needs more tapes than available
- limiting per-tape format selection to available physical inventory

**Suggested commit**

```text
feat: add tape inventory quantities
```

---

## P4 – Testing and maintenance

### 11. Add tape split unit tests

The split engine should be tested independently from the UI.

**Cases to test**

- Empty playlist.
- Playlist fits one side.
- Playlist fits one tape.
- Playlist exceeds selected tape.
- Track longer than side length.
- Manual split valid.
- Manual split invalid.
- Safety margin enabled.
- Multi-tape split uses correct tape count.
- Per-tape side split preserves original order.
- Multi-tape project with mixed C60/C90 formats.
- Changing Tape 2 format does not change Tape 1 format.
- Import restores the full project model.

**Suggested commit**

```text
test: add tape split unit tests
```

---

### 12. Add J-Card print regression test notes

Print layout is hard to unit test, but the project should document manual checks.

**Checklist**

- Chrome print preview shows one A4 page for normal playlists.
- Long playlists do not duplicate content.
- Fold lines are visible.
- Grayscale output is readable.
- Browser print-to-PDF works.
- Multi-tape projects can print one J-Card per tape.
- Mixed-format multi-tape projects print the correct format on each J-Card.

**Suggested commit**

```text
docs: add j-card print regression checklist
```

---

### 13. Add audio setup regression checklist

The audio-quality setup is manual, but it should be part of release testing and user documentation checks.

**Checklist**

- README mentions Lossless.
- README mentions Auto-adjust quality off.
- README mentions Crossfade 0 seconds.
- README mentions Normalize volume off.
- README mentions all EQ / sound processing off.
- README mentions selected Spotify output device.
- README mentions Exclusive mode and Force volume on the chosen device.
- README mentions Windows output volume at maximum.
- In-app Deck Checklist has a compact audio-settings confirmation.
- Level helper explains that final recording gain is adjusted on the cassette deck.

**Suggested commit**

```text
docs: add audio setup regression checklist
```

---

## Recommended implementation order

1. Introduce Mixtape Project model.
2. Add per-tape format selection for multi-tape projects.
3. Add Export/Import JSON.
4. Add split explanation in UI.
5. Add manual split override.
6. Add Spotify status panel.
7. Add reel animation.
8. Add better warnings and empty states.
9. Add tape inventory quantities.
10. Add tests and print/audio regression checklists.
