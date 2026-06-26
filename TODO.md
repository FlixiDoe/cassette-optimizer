# Cassette Optimizer TODO

Prioritized roadmap for the next implementation steps.

## P0 – Release blockers

### 1. [Highest priority] Multi-tape splitter with per-tape J-Cards

Long playlists should be split across multiple physical cassettes. This is now the top roadmap item because it turns Cassette Optimizer from a one-tape helper into a real mixtape planning system.

**Status: Implemented**

- Long playlists are split into multiple physical tapes while preserving track order.
- The selected physical tape drives the visible Side A / Side B lists and recording controls.
- J-Cards get automatic volume titles and can be printed for one selected tape or for all tapes.

**Goal**

Example output:

```text
This playlist fits on 2x C90.

Tape 1:
- Side A
- Side B

Tape 2:
- Side A
- Side B
```

The app should also generate separate J-Cards for every physical cassette:

```text
Playlist Title – Vol. 1
Playlist Title – Vol. 2
Playlist Title – Vol. 3
```

**Implementation notes**

- Preserve original track order.
- Do not cut tracks.
- Generate one layout per tape.
- Generate one Side A and Side B per tape.
- Generate one J-Card per tape.
- Each tape gets its own spine, cover, back, Side A and Side B.
- Print all J-Cards at once or one selected tape at a time.
- Export all J-Cards as one HTML file if possible.
- Add automatic titles such as `Vol. 1`, `Vol. 2`, etc.
- Make sure this can later use tape inventory quantities.

**Suggested commit**

```text
feat: add multi-tape splitter with per-tape j-cards
```

---

## P1 – Important usability features

### 2. Explain split logic in the UI

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

### 3. Add manual split override

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

### 4. Export and import tape configuration as JSON

After optimizing a mixtape, the user should be able to save and restore the exact tape layout.

**Goal**

Add `Export Config` and `Import Config` buttons.

**Export should include**

- App config version
- Project title
- Playlist ID
- Playlist name
- Playlist cover URL
- Selected tape format
- Available tape formats
- Split mode: automatic or manual
- Split index
- Side A tracks
- Side B tracks
- Track names, artists, durations, and URIs
- Timestamps
- J-Card text
- Recording calibration settings

**Import should**

- Load a saved JSON file.
- Restore the exact split.
- Restore Side A / Side B.
- Restore J-Card data.
- Work without fetching the Spotify playlist again.
- Warn if Spotify playback control needs reconnection.

**Suggested commit**

```text
feat: add tape config export and import
```

---

### 5. Introduce Mixtape Project model

The app should treat the result as a cassette project, not just a temporary playlist calculation.

**Goal**

Create a central project object that can power UI state, JSON export/import, J-Card rendering, and recording.

**Project fields**

```text
projectTitle
sourcePlaylistId
sourcePlaylistName
coverUrl
tapeFormat
sideLengthMs
splitMode
sideA
sideB
calibration
jCard
createdAt
updatedAt
```

**Implementation notes**

- Use the project object as the source of truth after playlist load/import.
- Avoid duplicating state between split rendering, J-Card, and recording.
- Make future multi-tape support easier.

**Suggested commit**

```text
refactor: introduce mixtape project model
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

1. Add Multi-tape splitter with per-tape J-Cards.
2. Add split explanation in UI.
3. Add manual split override.
4. Add Export/Import JSON.
5. Introduce Mixtape Project model.
6. Add Spotify status panel.
7. Add reel animation.
8. Add better warnings and empty states.
9. Add tape inventory quantities.
10. Add tests and print/audio regression checklists.
