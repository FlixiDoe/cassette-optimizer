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
  return {
    startAText: pausedA ? "Resume Side A" : "Start Side A",
    startBText: pausedB ? "Resume Side B" : "Start Side B",
    startADisabled: !hasToken || !(recordMode === "idle" || pausedA),
    startBDisabled: !hasToken || !(recordMode === "flip" || pausedB),
    pauseDisabled: !hasToken || !recording
  };
}

contains("Side B completion function", "async function completeSideB()");
contains("Side B timer completion check", /state\.recordMode === "recording_b"[\s\S]*remaining <= 0[\s\S]*completeSideB\(\)/);
contains("Side B Spotify completion check", /state\.recordMode === "recording_b"[\s\S]*duration\(sideB\(\)\)[\s\S]*completeSideB\(\)/);
contains("Resume Side A text", "Resume Side A");
contains("Resume Side B text", "Resume Side B");
contains("Resume uses play without payload", /resuming \? \{ method: "PUT" \}/);
containsHtml("Device selector markup", 'id="deviceSelect"');
contains("Device fetch endpoint", 'spotifyFetch("/me/player/devices")');
contains("Play uses selected device id", /device_id=\$\{encodeURIComponent\(state\.selectedDeviceId\)\}/);

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
