const assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

(async () => {
  const { migrateImportedConfig, CURRENT_CONFIG_VERSION } = await import(pathToFileURL(path.join(root, "config-migration.js")).href);

  const legacy = migrateImportedConfig({
    playlistId: "legacy-playlist",
    playlistName: "Legacy Mix",
    tapeMinutes: 90,
    tracks: [
      { id: "a", uri: "spotify:track:a", name: "A", duration_ms: 60000 },
      { id: "b", uri: "", name: "Missing URI", duration_ms: 70000 }
    ],
    sideA: [{ id: "a", uri: "spotify:track:a", name: "A", duration_ms: 60000 }],
    sideB: [{ id: "b", uri: "", name: "Missing URI", duration_ms: 70000 }]
  });

  assert.equal(legacy.configVersion, CURRENT_CONFIG_VERSION, "legacy config should migrate to current version");
  assert.equal(legacy.sourcePlaylistId, "legacy-playlist", "legacy playlist id should map to sourcePlaylistId");
  assert.equal(legacy.projectTitle, "Legacy Mix", "legacy playlist name should become project title");
  assert.equal(legacy.tapes.length, 1, "legacy side arrays should become one tape");
  assert.equal(legacy.tapes[0].tapeFormat, 90, "legacy tape format should be preserved");
  assert.equal(legacy.tapes[0].sideB[0].uri, "", "missing URI should survive for later recording validation");
  assert.equal(legacy.slackMarginSeconds, 0, "missing slack margin should default safely");

  const current = migrateImportedConfig({
    configVersion: CURRENT_CONFIG_VERSION,
    projectTitle: "Current Mix",
    sourcePlaylistId: "current-playlist",
    sourceTracks: [{ id: "x", uri: "spotify:track:x", name: "X", duration_ms: 120000 }],
    selectedTapeIndex: 9,
    tapeInventory: { 60: 1, 90: 2 },
    slackMarginSeconds: 999,
    calibration: { leadInSeconds: 500, motorLatencySeconds: -10, safetyMarginSeconds: 12 },
    tapes: [
      {
        tapeNumber: 1,
        tapeTitle: "Tape One",
        tapeFormat: 90,
        sideA: [{ id: "x", uri: "spotify:track:x", name: "X", duration_ms: 120000 }],
        sideB: [],
        splitMode: "manual",
        manualSplitIndex: 1,
        spineNote: "Recorded on Maxell XLII"
      },
      {
        tapeNumber: 2,
        tapeTitle: "Tape Two",
        tapeFormat: 60,
        sideA: [],
        sideB: []
      }
    ]
  });

  assert.equal(current.selectedTapeIndex, 1, "selected tape index should be clamped");
  assert.deepEqual(current.tapes.map(tape => tape.tapeFormat), [90, 60], "mixed tape formats should survive migration");
  assert.equal(current.tapes[0].splitMode, "manual", "manual split mode should survive migration");
  assert.equal(current.tapes[0].manualSplitIndex, 1, "manual split index should survive migration");
  assert.equal(current.tapes[0].spineNote, "Recorded on Maxell XLII", "future J-card fields should survive when known");
  assert.equal(current.slackMarginSeconds, 120, "slack margin should be capped safely");
  assert.deepEqual(current.calibration, { leadInSeconds: 120, motorLatencySeconds: 0, safetyMarginSeconds: 12 }, "calibration should be clamped safely");

  const future = migrateImportedConfig({
    configVersion: 999,
    projectTitle: "Future Mix",
    unknownFutureField: { keep: true },
    tapes: [{ tapeFormat: 74, sideA: [], sideB: [] }]
  });

  assert.equal(future.configVersion, CURRENT_CONFIG_VERSION, "future config should be normalized to current version");
  assert.equal(future.unknownFutureField.keep, true, "unknown future fields should not crash or be stripped unnecessarily");
  assert.equal(future.tapes[0].tapeFormat, 74, "future tape format should survive migration");

  console.log("Cassette config migration checks passed.");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
