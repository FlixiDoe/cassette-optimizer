import assert from "node:assert/strict";
import test from "node:test";

import { CURRENT_CONFIG_VERSION, migrateImportedConfig } from "../config-migration.js";

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
