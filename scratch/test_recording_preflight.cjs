const assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

function track(overrides = {}) {
  return {
    id: "track-id",
    uri: "spotify:track:trackid",
    name: "Playable Track",
    artists: "Test Artist",
    duration_ms: 180000,
    is_local: false,
    ...overrides
  };
}

(async () => {
  const { validateRecordingSide, summarizePreflightIssues } = await import(pathToFileURL(path.join(root, "src", "recording-preflight.js")).href);

  const valid = validateRecordingSide({
    sideName: "A",
    tracks: [track()],
    token: "token",
    deviceReady: true,
    checklistReady: true,
    sideLengthMs: 45 * 60 * 1000
  });
  assert.equal(valid.ok, true, "valid real recording side should pass");
  assert.deepEqual(valid.issues, [], "valid side should not report issues");

  const invalid = validateRecordingSide({
    sideName: "B",
    tracks: [
      track({ name: "Missing URI", uri: "" }),
      track({ name: "Local Only", is_local: true }),
      track({ name: "No Duration", duration_ms: 0 }),
      track({ name: "Too Long", duration_ms: 60 * 60 * 1000 })
    ],
    token: null,
    deviceReady: false,
    checklistReady: false,
    sideLengthMs: 45 * 60 * 1000
  });
  assert.equal(invalid.ok, false, "invalid real recording side should block");
  assert.ok(invalid.issues.some(issue => issue.code === "missing_uri"), "missing URI should be detected");
  assert.ok(invalid.issues.some(issue => issue.code === "local_track"), "local-only track should be detected");
  assert.ok(invalid.issues.some(issue => issue.code === "missing_duration"), "missing duration should be detected");
  assert.ok(invalid.issues.some(issue => issue.code === "track_too_long"), "track longer than side should be detected");
  assert.ok(invalid.issues.some(issue => issue.code === "missing_token"), "missing token should be detected for real recording");
  assert.ok(invalid.issues.some(issue => issue.code === "device_not_ready"), "device warning should be detected");
  assert.ok(invalid.issues.some(issue => issue.code === "checklist_incomplete"), "checklist warning should be detected");

  const dryRun = validateRecordingSide({
    sideName: "A",
    dryRun: true,
    tracks: [track({ uri: "", is_local: true })],
    token: null,
    deviceReady: false,
    checklistSkipped: true,
    sideLengthMs: 45 * 60 * 1000
  });
  assert.equal(dryRun.ok, true, "Dry Run should allow missing Spotify URI/token/local-track validation");

  const empty = validateRecordingSide({
    sideName: "A",
    tracks: [],
    dryRun: true,
    checklistSkipped: true
  });
  assert.equal(empty.ok, false, "empty side should still block Dry Run");

  const summary = summarizePreflightIssues(invalid);
  assert.ok(summary.includes("Side B"), "summary should mention the affected side");
  assert.ok(summary.includes("Missing URI"), "summary should mention the affected track");

  console.log("Recording preflight validation checks passed.");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
