const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1] || "";

function contains(label, pattern) {
  const found = typeof pattern === "string" ? script.includes(pattern) : pattern.test(script);
  assert.ok(found, `Missing expected playback code: ${label}`);
}

function containsHtml(label, pattern) {
  const found = typeof pattern === "string" ? html.includes(pattern) : pattern.test(html);
  assert.ok(found, `Missing expected markup: ${label}`);
}

function buttonState(recordMode, activeRecordSide, hasToken = true) {
  const pausedA = recordMode === "paused" && activeRecordSide === "A";
  const pausedB = recordMode === "paused" && activeRecordSide === "B";
  const recording = recordMode === "recording_a" || recordMode === "recording_b";
  const cueing = recordMode === "cue_a" || recordMode === "cue_b";
  return {
    startAText: pausedA ? "Resume Side A" : "Start Side A",
    startBText: pausedB ? "Resume Side B" : "Start Side B",
    startADisabled: cueing || !hasToken || !(recordMode === "idle" || pausedA),
    startBDisabled: cueing || !hasToken || !(recordMode === "flip" || pausedB),
    pauseDisabled: cueing || !hasToken || !recording
  };
}

contains("Side B completion function", "async function completeSideB()");
contains("Side B timer completion check", /state\.recordMode === "recording_b"[\s\S]*remaining <= 0[\s\S]*completeSideB\(\)/);
contains("Side B Spotify completion check", /state\.recordMode === "recording_b"[\s\S]*duration\(sideB\(\)\)[\s\S]*completeSideB\(\)/);
contains("Resume Side A text", "Resume Side A");
contains("Resume Side B text", "Resume Side B");
contains("Resume uses play without payload", /resuming \? \{ method: "PUT" \}/);
contains("Explicit side URI playback", "uris: tracks.map(track => track.uri)");
contains("Side B starts with side track list", "buildSidePlaybackPayload(sideB(), 0, 0)");
contains("Unexpected track correction", "correctUnexpectedPlaybackTrack");
contains("Shuffle disabled before recording", "/me/player/shuffle?state=false");
contains("Repeat disabled before recording", "/me/player/repeat?state=off");
containsHtml("Device selector markup", 'id="deviceSelect"');
contains("Device fetch endpoint", 'spotifyFetch("/me/player/devices")');
contains("Play uses selected device id", /device_id=\$\{encodeURIComponent\(state\.selectedDeviceId\)\}/);
contains("Record cue delay", "const RECORD_CUE_SECONDS = 5");
containsHtml("Record cue banner", 'id="recordCue"');
contains("Record cue text", "PRESS RECORD NOW");
contains("Start Side A enters cue state", 'state.recordMode = "cue_a"');
contains("Start Side B enters cue state", 'state.recordMode = "cue_b"');
containsHtml("Finish time display", 'id="finishTime"');
contains("Finish time renderer", "function renderFinishTime");
containsHtml("Abort recording button", 'id="abortBtn"');
contains("Abort recording handler", "async function abortRecording");
contains("Shared status push", "function pushSharedStatus");
contains("Shared status polling", "function startSharedStatusPolling");

const server = fs.readFileSync(path.join(root, "server.js"), "utf8");
assert.ok(server.includes('"/api/status"'), "Missing LAN status API");
assert.ok(server.includes("0.0.0.0"), "LAN server should listen on all interfaces by default");

assert.deepEqual(buttonState("idle", null), {
  startAText: "Start Side A",
  startBText: "Start Side B",
  startADisabled: false,
  startBDisabled: true,
  pauseDisabled: true
});

assert.deepEqual(buttonState("recording_a", "A"), {
  startAText: "Start Side A",
  startBText: "Start Side B",
  startADisabled: true,
  startBDisabled: true,
  pauseDisabled: false
});

assert.deepEqual(buttonState("cue_a", "A"), {
  startAText: "Start Side A",
  startBText: "Start Side B",
  startADisabled: true,
  startBDisabled: true,
  pauseDisabled: true
});

assert.deepEqual(buttonState("paused", "A"), {
  startAText: "Resume Side A",
  startBText: "Start Side B",
  startADisabled: false,
  startBDisabled: true,
  pauseDisabled: true
});

assert.deepEqual(buttonState("flip", "A"), {
  startAText: "Start Side A",
  startBText: "Start Side B",
  startADisabled: true,
  startBDisabled: false,
  pauseDisabled: true
});

assert.deepEqual(buttonState("recording_b", "B"), {
  startAText: "Start Side A",
  startBText: "Start Side B",
  startADisabled: true,
  startBDisabled: true,
  pauseDisabled: false
});

assert.deepEqual(buttonState("paused", "B"), {
  startAText: "Start Side A",
  startBText: "Resume Side B",
  startADisabled: true,
  startBDisabled: false,
  pauseDisabled: true
});

assert.deepEqual(buttonState("idle", null, false), {
  startAText: "Start Side A",
  startBText: "Start Side B",
  startADisabled: true,
  startBDisabled: true,
  pauseDisabled: true
});

console.log("Playback regression checks passed.");
