import assert from "node:assert/strict";
import test from "node:test";

import { validateRecordingSide } from "../recording-preflight.js";

const playableTrack = {
  uri: "spotify:track:1",
  name: "Playable",
  duration_ms: 180000,
  is_local: false
};

test("real recording blocks unplayable Spotify track data", () => {
  const result = validateRecordingSide({
    sideName: "A",
    tracks: [
      { ...playableTrack, uri: "", name: "Missing URI" },
      { ...playableTrack, is_local: true, name: "Local File" }
    ],
    dryRun: false,
    token: "token",
    deviceReady: true,
    checklistReady: true,
    sideLengthMs: 30 * 60 * 1000
  });

  assert.equal(result.ok, false);
  assert.deepEqual(
    result.issues.filter(issue => issue.severity === "blocking").map(issue => issue.code),
    ["missing_uri", "local_track"]
  );
});

test("dry run allows offline imports but still blocks invalid side data", () => {
  const offlineResult = validateRecordingSide({
    sideName: "A",
    tracks: [{ ...playableTrack, uri: "", is_local: true }],
    dryRun: true,
    token: "",
    deviceReady: false,
    checklistReady: true,
    sideLengthMs: 30 * 60 * 1000
  });
  assert.equal(offlineResult.ok, true);

  const invalidResult = validateRecordingSide({
    sideName: "B",
    tracks: [{ ...playableTrack, duration_ms: 0 }],
    dryRun: true,
    checklistReady: true,
    sideLengthMs: 30 * 60 * 1000
  });
  assert.equal(invalidResult.ok, false);
  assert.equal(invalidResult.issues[0].code, "missing_duration");
});

test("preflight blocks empty sides and tracks longer than a side", () => {
  assert.equal(validateRecordingSide({
    sideName: "A",
    tracks: [],
    dryRun: true,
    checklistReady: true,
    sideLengthMs: 30 * 60 * 1000
  }).ok, false);

  const result = validateRecordingSide({
    sideName: "B",
    tracks: [{ ...playableTrack, duration_ms: 31 * 60 * 1000 }],
    dryRun: true,
    checklistReady: true,
    sideLengthMs: 30 * 60 * 1000
  });

  assert.equal(result.ok, false);
  assert.equal(result.issues.at(-1).code, "track_too_long");
});
