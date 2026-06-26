# Cassette Optimizer TODO

Prioritized roadmap for the next implementation steps.

## P0 – Release blockers

### 0. [Highest priority] Add Spotify and Windows audio quality checklist to all recording guides

Cassette recording quality depends on the Spotify output chain. This must be documented before other release work, because otherwise recordings can be inconsistent even when the app logic works correctly.

**Goal**

Add a clear `Spotify / Windows audio settings before recording` checklist to:

- README Deck Setup guide.
- README Recording Workflow.
- In-app Deck Checklist.
- In-app Level Check helper.
- Release/manual test checklist.

**Checklist items**

```text
Spotify settings:
☐ Select the exact output device you will record from.
☐ Set Streaming quality to Lossless.
☐ Turn Auto-adjust quality off.
☐ Set Crossfade to 0 seconds.
☐ Turn Normalize volume off.
☐ Turn all Spotify Equalizer/EQ processing off.
☐ Open the selected output device settings.
☐ Enable Exclusive mode for this device.
☐ Enable Force volume for this device.

Windows / device settings:
☐ Set Windows output device to the same device used in Spotify.
☐ Set Windows output volume to 100% / maximum.
☐ Control final recording level on the cassette deck input, not with Windows volume.
☐ Watch the deck meters and avoid clipping/distortion.
```

**Implementation notes**

- Keep the wording practical and beginner-friendly.
- Explain that maximum digital volume is for a clean fixed source level, while final gain should be adjusted on the cassette deck.
- Do not claim that the app can verify these Spotify or Windows settings automatically unless detection is implemented later.
- Add screenshots or short notes if useful.
- Mention that users should turn off any system-wide EQ, sound enhancement, loudness normalization, or virtual surround effects if they use them.

**Acceptance criteria**

- Every recording guide mentions Lossless, Auto-adjust quality off, Crossfade 0, Normalize off, EQ off, correct output device, Exclusive mode, Force volume, and Windows volume max.
- The in-app checklist contains a compact version of the same settings.
- The README contains a fuller explanation.
- The guidance makes clear that cassette deck input level still needs manual adjustment.

**Suggested commit**

```text
docs: add spotify and windows recording settings checklist
```

---

### 1. [Done] Fix broken J-Card printing

The current print output can spread the J-Card across several pages and repeat Side A / Side B content.

**Goal**

- Print one clean A4 page for normal playlists.
- Use a maximum of two pages only when the tracklist is very long.
- Do not duplicate Side A or Side B blocks.
- Hide the normal app UI during print.

**Implementation notes**

- Add a dedicated print-only J-Card container.
- Use `@media print` to hide everything except the print layout.
- Use `@page { size: A4; margin: 10mm; }`.
- Add `break-inside: avoid` / `page-break-inside: avoid` where needed.
- Add compact overflow handling for long tracklists.

**Suggested commit**

```text
fix: make j-card print layout single-page
```

---

### 2. [Done] Add real physical J-Card layout

The print layout should look like a cassette inlay instead of a full-page app print.

**Goal**

```text
┌────────────┬────────────────────────┬────────────┐
│ Spine      │ Cover                  │ Back       │
└────────────┴────────────────────────┴────────────┘
```

**Implementation notes**

- Add separate print panels for spine, front cover, and back cover.
- Add visible fold lines.
- Put playlist title and tape format on the spine.
- Put cover art and title on the front cover.
- Put Side A and Side B tracklists on the back cover.
- Make the layout readable in grayscale.

**Suggested commit**

```text
feat: add physical j-card print template
```

---

### 3. [Done] Harden Client Secret handling

A browser-only static app cannot keep a Client Secret truly secret. The current field is useful for local testing, but it should not look safe for public hosting.

**Goal**

- Make PKCE without Client Secret the default and recommended path.
- Mark Client Secret as advanced local-only.
- Prevent accidental use on LAN or public hosting.

**Implementation notes**

- Add a strong UI warning near the Client Secret field:

```text
Advanced local-only option. Do not use a Client Secret on GitHub Pages, LAN devices, or public hosting.
```

- Consider hiding the Client Secret field behind an `Advanced` disclosure.
- Consider removing Client Secret support entirely before public release.
- Do not persist Client Secret unless the user explicitly enables local saving.
- Clear saved Client Secret on logout if possible.

**Acceptance criteria**

- New users are guided toward normal PKCE.
- Client Secret is never shown on LAN monitor mode.
- README and UI both warn against public-hosted secrets.

**Suggested commit**

```text
security: mark client secret as local-only advanced option
```

---

### 4. [Done] Add in-app responsible-use notice

The README has responsible-use text, but users running the app may never read it.

**Goal**

Add a small non-annoying reminder inside the app.

**Implementation notes**

- Add a compact notice near the recording controls or first-run setup.
- Keep wording clear but not scary.
- Do not block normal local use.

**Suggested UI copy**

```text
Use responsibly: this tool controls playback for cassette recording workflows. It does not download or rip audio. Only record music you have the right to copy.
```

**Suggested commit**

```text
docs: add responsible-use notice to app UI
```

---

## P1 – Important usability features

### 5. [Done] Split `index.html` into static modules

The app should stay static and build-free, but the current single-file structure will become hard to maintain.

**Goal**

Keep the no-build-step workflow, but split the code into clear files:

```text
index.html
styles.css
app.js
spotify.js
tape.js
recording.js
jcard.js
export.js
```

**Implementation notes**

- Move CSS from `index.html` to `styles.css`.
- Move Spotify API/OAuth helpers to `spotify.js`.
- Move tape length and split logic to `tape.js`.
- Move recording state, countdown, cue, pause/resume, and abort logic to `recording.js`.
- Move J-Card rendering and print logic to `jcard.js`.
- Move future JSON import/export logic to `export.js`.
- Use plain ES modules with `<script type="module">`.
- No bundler, no framework, no build step.

**Acceptance criteria**

- App still runs through `python -m http.server 8787 --bind 127.0.0.1`.
- No build command is required.
- Spotify login still works from `http://127.0.0.1:8787/`.
- Regression test still passes.

**Suggested commit**

```text
refactor: split static app into modules
```

---

### 6. [Done] Add Deck Setup guide to README

Users need to know how to connect their playback device, DAC, and cassette deck.

**Goal**

Add a practical hardware setup section to the README.

**Content to cover**

- Spotify device / PC / phone / tablet output.
- USB-C DAC or headphone output.
- Cable to cassette deck `LINE IN`, `AUX IN`, or `REC IN`.
- Avoid microphone input if a proper line input is available.
- Monitor through deck headphones or speakers.
- Disable notification sounds before recording.
- Test record level before the real run.
- Reference the highest-priority Spotify / Windows audio quality checklist.

**Suggested diagram**

```text
Spotify device / DAC / headphone output
        ↓
cassette deck LINE IN / AUX IN / REC IN
        ↓
deck monitor output / headphones / speakers
```

**Suggested commit**

```text
docs: add cassette deck setup guide
```

---

### 7. [Done] Add Deck Checklist before recording

Recording to cassette has physical steps that can easily be forgotten.

**Goal**

Add an optional checklist before `Start Side A` / `Start Side B`.

**Checklist items**

```text
☐ Tape inserted
☐ Rewound to start of side
☐ Correct side selected
☐ Record level checked
☐ Spotify device selected
☐ Spotify / Windows audio settings checked
☐ Notifications muted
☐ Deck is in record/pause
```

**Implementation notes**

- Show checklist inside the Record Mode panel.
- Let the user mark items as done.
- Store checklist preference in localStorage.
- Do not hard-block recording by default, but make unchecked items visually obvious.
- Add a compact `Skip checklist` option for advanced users.

**Acceptance criteria**

- User sees cassette-deck preparation steps before recording.
- The checklist helps prevent wrong-side or wrong-device recordings.
- UI remains usable on smaller screens.

**Suggested commit**

```text
feat: add pre-recording deck checklist
```

---

### 8. [Done] Add Dry Run / Safe Mode

Users should be able to test the recording workflow without starting Spotify playback.

**Goal**

Add a mode that runs cue, countdown, side timer, flip cue, and finish-time logic without sending playback commands to Spotify.

**Implementation notes**

- Add a toggle: `Dry Run / Test Mode`.
- In Dry Run, do not call `/me/player/play`, `/pause`, `/shuffle`, or `/repeat`.
- Still show `PRESS RECORD NOW` cue.
- Still run local side countdown.
- Clearly label the state as `Dry Run`.
- Allow testing Side A and Side B.

**Acceptance criteria**

- User can test the workflow without affecting Spotify.
- No Spotify playback starts in Dry Run.
- Countdown and flip cue behave like real recording mode.
- Normal recording mode still works unchanged.

**Suggested commit**

```text
feat: add dry run recording mode
```

---

### 9. Add recording delay calibration

Cassette decks and tapes have small physical delays before usable recording starts.

**Goal**

Add settings for:

- Lead-in delay
- Motor latency
- Optional end-of-side safety margin

**Implementation notes**

- Add numeric settings in seconds.
- Store settings in localStorage.
- Extend the record cue countdown using these settings.
- Show clear countdown text:
  - `PRESS RECORD NOW`
  - `Waiting for lead-in`
  - `Spotify starts in X seconds`
- Include settings in future JSON export/import.

**Acceptance criteria**

- User can configure delay in seconds.
- Spotify starts only after the configured delay.
- The countdown clearly explains what is happening.
- Settings persist after reload.

**Suggested commit**

```text
feat: add recording delay calibration
```

---

### 10. Add recording level helper

Cassette recording quality depends heavily on the deck input level.

**Goal**

Add a small guide that helps users set a safe recording level before starting the real run.

**Suggested UI copy**

```text
Level check: set Spotify to Lossless, disable EQ/normalization/crossfade, set Windows volume to 100%, play a loud part of the playlist, put your deck into record-pause, and adjust the deck input level so peaks stay below distortion. Then stop playback, rewind, and start the real recording.
```

**Implementation notes**

- Add this near the Deck Checklist or as a collapsible `Level check` panel.
- Keep it instructional, not technical.
- Do not imply the app measures audio level directly.
- Link or reference the Spotify / Windows audio settings checklist.

**Suggested commit**

```text
feat: add cassette recording level helper
```

---

### 11. Explain split logic in the UI

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

### 12. Add manual split override

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

### 13. Export and import tape configuration as JSON

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

### 14. Introduce Mixtape Project model

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

### 15. Add Spotify status panel

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

### 16. Add No Spotify Mode

The app should also be useful for owned files, local music, and manually planned cassette projects.

**Goal**

Allow users to create a tape plan without Spotify login.

**Input options**

- Manual track entry: artist, title, duration.
- Paste plain text tracklist.
- Import CSV.

**Example CSV**

```csv
artist,title,duration
Artist,Song,03:42
```

**Implementation notes**

- Keep Spotify-specific playback controls disabled in No Spotify Mode.
- Still allow tape splitting, J-Card printing, export/import, and Dry Run.
- Make this mode clearly responsible-use friendly for music the user owns or created.

**Suggested commit**

```text
feat: add no-spotify tape planning mode
```

---

## P2 – UI polish and output improvements

### 17. Add J-Card preview and HTML export

Printing should not be the only way to inspect the inlay.

**Goal**

Add:

```text
Preview J-Card
Print J-Card
Export J-Card as HTML
```

**Implementation notes**

- Preview should show the exact print layout inside the app.
- HTML export should save a standalone file containing the J-Card layout.
- Keep Browser Print to PDF as the primary PDF workflow.

**Suggested commit**

```text
feat: add j-card preview and html export
```

---

### 18. Reel animation

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

### 19. Better warning system

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

### 20. Add better empty and error states

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

### 21. Multi-tape splitter

Long playlists should be split across multiple cassettes.

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

**Implementation notes**

- Preserve original track order.
- Do not cut tracks.
- Generate one layout per tape.
- Generate one J-Card per tape.
- Add automatic titles such as `Vol. 1`, `Vol. 2`, etc.

**Suggested commit**

```text
feat: add multi-tape playlist splitter
```

---

### 22. Tape inventory with quantity

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

### 23. Per-tape J-Cards for multi-tape projects

Multi-tape output needs one inlay per physical cassette.

**Goal**

Generate separate J-Cards for:

```text
Playlist Title – Vol. 1
Playlist Title – Vol. 2
Playlist Title – Vol. 3
```

**Implementation notes**

- Each tape gets its own spine, cover, back, Side A and Side B.
- Print all J-Cards at once or one selected tape at a time.
- Export all J-Cards as one HTML file if possible.

**Suggested commit**

```text
feat: generate j-cards for multi-tape projects
```

---

## P4 – Testing and maintenance

### 24. Add tape split unit tests

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

**Suggested commit**

```text
test: add tape split unit tests
```

---

### 25. Add J-Card print regression test notes

Print layout is hard to unit test, but the project should document manual checks.

**Checklist**

- Chrome print preview shows one A4 page for normal playlists.
- Long playlists do not duplicate content.
- Fold lines are visible.
- Grayscale output is readable.
- Browser print-to-PDF works.

**Suggested commit**

```text
docs: add j-card print regression checklist
```

---

### 26. Add audio setup regression checklist

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

1. Add Spotify / Windows audio settings checklist to all guides.
2. Fix broken J-Card printing.
3. Add real physical J-Card layout.
4. Harden Client Secret handling.
5. Add Deck Setup guide to README.
6. Add Deck Checklist in the app.
7. Add Dry Run / Safe Mode.
8. Add recording delay calibration.
9. Add split explanation in UI.
10. Add manual split override.
11. Add Export/Import JSON.
12. Introduce Mixtape Project model.
13. Add Spotify status panel.
14. Add recording level helper.
15. Add J-Card preview / HTML export.
16. Add No Spotify Mode.
17. Add reel animation.
18. Add better warnings and empty states.
19. Add Multi-tape splitter.
20. Add tape inventory quantities.
21. Add tests and print/audio regression checklists.
