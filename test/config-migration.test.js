import assert from "node:assert/strict";
import test from "node:test";

import { CURRENT_CONFIG_VERSION, migrateImportedConfig } from "../src/config-migration.js";

test("legacy configs migrate to the current project shape", () => {
  const migrated = migrateImportedConfig({
    playlistName: "Legacy Mix",
    selectedTapeMinutes: 60,
    tracks: [
      { uri: "spotify:track:1", name: "One", artists: "Artist", duration_ms: 120000 }
    ],
    sideA: [
      { uri: "spotify:track:1", name: "One", artists: "Artist", duration_ms: 120000 }
    ],
    slackMarginSeconds: 999,
    jCardOverrides: { "spotify:track:1": "One Clean" }
  });

  assert.equal(migrated.configVersion, CURRENT_CONFIG_VERSION);
  assert.equal(migrated.projectTitle, "Legacy Mix");
  assert.equal(migrated.sourceTracks.length, 1);
  assert.equal(migrated.tapes.length, 1);
  assert.equal(migrated.tapes[0].tapeFormat, 60);
  assert.equal(migrated.tapes[0].sideLengthMs, 30 * 60 * 1000);
  assert.equal(migrated.slackMarginSeconds, 120);
  assert.deepEqual(migrated.jCardOverrides, { "spotify:track:1": "One Clean" });
});

test("future configs are normalized without dropping unknown fields", () => {
  const migrated = migrateImportedConfig({
    configVersion: 99,
    projectTitle: "Future Mix",
    futureCalibrationField: { deckBias: "normal" },
    sourceTracks: [
      { uri: "spotify:track:2", name: "Two", artists: "Artist", duration_ms: 90000 }
    ],
    tapes: [
      {
        tapeNumber: 1,
        tapeFormat: 90,
        sideA: [{ uri: "spotify:track:2", name: "Two", artists: "Artist", duration_ms: 90000 }],
        sideB: []
      }
    ]
  });

  assert.equal(migrated.configVersion, CURRENT_CONFIG_VERSION);
  assert.equal(migrated.futureCalibrationField.deckBias, "normal");
  assert.equal(migrated.tapes[0].tapeFormat, 90);
  assert.equal(migrated.slackMarginSeconds, 0);
});

test("imports drop zero-length tracks", () => {
  const migrated = migrateImportedConfig({
    sourceTracks: [
      { uri: "spotify:track:zero", name: "Zero", artists: "Artist", duration_ms: 0 },
      { uri: "spotify:track:one", name: "One", artists: "Artist", duration_ms: 120000 }
    ],
    tapes: [
      {
        sideA: [
          { uri: "spotify:track:zero", name: "Zero", artists: "Artist", duration_ms: 0 },
          { uri: "spotify:track:one", name: "One", artists: "Artist", duration_ms: 120000 }
        ],
        sideB: []
      }
    ]
  });

  assert.deepEqual(migrated.sourceTracks.map(track => track.uri), ["spotify:track:one"]);
  assert.deepEqual(migrated.tapes[0].sideA.map(track => track.uri), ["spotify:track:one"]);
});

test("multi-tape imports retain absolute track boundaries when indexes are omitted", () => {
  const track = id => ({ id, name: id, duration_ms: 60000 });
  const [one, two, three, four] = ["same", "two", "same", "four"].map(track);
  for (const configVersion of [0, CURRENT_CONFIG_VERSION]) {
    const saved = {
      configVersion,
      sourceTracks: [one, two, three, four],
      tapes: [{ sideA: [one], sideB: [two] }, { sideA: [three], sideB: [four] }]
    };
    const { tapes, sourceTracks } = migrateImportedConfig(JSON.parse(JSON.stringify(saved)));
    assert.deepEqual(tapes.map(t => [t.sideAStartIndex, t.sideAEndIndex, t.sideBStartIndex, t.sideBEndIndex]),
      [[0, 1, 1, 2], [2, 3, 3, 4]]);
    assert.deepEqual(sourceTracks.slice(tapes[1].sideBStartIndex, tapes[1].sideBEndIndex), tapes[1].sideB);
  }
});

test("legacy track-only projects leave tape placement to the planner", () => {
  const imported = migrateImportedConfig({
    selectedTapeMinutes: 60,
    tracks: [{ name: "Opening", duration_ms: 1800000 }, { name: "Next side", duration_ms: 120000 }]
  });
  assert.equal(imported.sourceTracks.length, 2);
  assert.deepEqual(imported.tapes, []);
  assert.equal(imported.selectedTapeMinutes, 60);
});
