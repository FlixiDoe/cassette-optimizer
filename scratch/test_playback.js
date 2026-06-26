const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const moduleFiles = [
  "app.js",
  "spotify.js",
  "tape.js",
  "recording.js",
  "jcard.js",
  "export.js"
];
const script = moduleFiles.map(file => fs.readFileSync(path.join(root, file), "utf8")).join("\n");
const styles = fs.readFileSync(path.join(root, "styles.css"), "utf8");

function contains(label, pattern) {
  const found = typeof pattern === "string" ? script.includes(pattern) : pattern.test(script);
  assert.ok(found, `Missing expected playback code: ${label}`);
}

function containsHtml(label, pattern) {
  const found = typeof pattern === "string" ? html.includes(pattern) : pattern.test(html);
  assert.ok(found, `Missing expected markup: ${label}`);
}

function containsStyles(label, pattern) {
  const found = typeof pattern === "string" ? styles.includes(pattern) : pattern.test(styles);
  assert.ok(found, `Missing expected CSS: ${label}`);
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
containsHtml("ES module script", '<script type="module" src="app.js"></script>');
containsHtml("External stylesheet", '<link rel="stylesheet" href="styles.css">');
for (const file of moduleFiles) {
  assert.ok(fs.existsSync(path.join(root, file)), `Missing module file: ${file}`);
}
containsHtml("Advanced Client Secret disclosure", 'id="clientSecretAdvanced"');
containsHtml("Client Secret local-only warning", "Advanced local-only option. Do not use a Client Secret on GitHub Pages, LAN devices, or public hosting.");
containsHtml("Explicit Client Secret save control", 'id="saveClientSecret"');
contains("Client Secret disabled off localhost", 'if (!isLocalhost()) return "";');
contains("Client Secret preference restore", "function restoreClientSecretPreference");
contains("Client Secret cleared on logout", "function clearSavedClientSecret");
containsHtml("Responsible use app notice", "Use responsibly: this tool controls playback for cassette recording workflows.");
containsHtml("Deck checklist panel", 'id="deckChecklist"');
containsHtml("Deck checklist skip option", 'id="skipDeckChecklist"');
contains("Deck checklist item source", "const DECK_CHECKLIST_ITEMS");
contains("Deck checklist persistence", 'localStorage.setItem("deck_checklist"');
contains("Deck checklist render", "function renderDeckChecklist");
contains("Deck checklist does not block start buttons", "el.startA.disabled = cueing || !a.length || !state.token");
containsHtml("Record cue banner", 'id="recordCue"');
contains("Record cue text", "PRESS RECORD NOW");
containsHtml("J-Card screen preview", 'id="jCardPreview"');
containsHtml("J-Card print-only container", 'class="print-only"');
containsHtml("J-Card print target", 'id="jCardPrint"');
containsStyles("A4 print page rule", "size: A4;");
contains("J-Card physical spine panel", 'class="j-panel j-spine"');
contains("J-Card physical front panel", 'class="j-panel j-front"');
contains("J-Card physical back panel", 'class="j-panel j-back"');
containsStyles("J-Card fold lines", ".j-panel + .j-panel");
contains("J-Card density class helper", "function getJCardDensityClass");
contains("J-Card preview render target", "el.jCardPreview.innerHTML = cardHtml");
contains("J-Card print render target", "el.jCardPrint.innerHTML = cardHtml");
contains("Start Side A enters cue state", 'state.recordMode = "cue_a"');
contains("Start Side B enters cue state", 'state.recordMode = "cue_b"');
containsHtml("Finish time display", 'id="finishTime"');
contains("Finish time renderer", "function renderFinishTime");
containsHtml("Abort recording button", 'id="abortBtn"');
contains("Abort recording handler", "async function abortRecording");
contains("Shared status push", "function pushSharedStatus");
contains("Shared status polling", "function startSharedStatusPolling");
contains("Shared status capability detection", "async function detectStatusApi");
contains("Shared status health endpoint", 'fetch("/api/health"');
contains("Shared status explicit capability flag", "health?.statusApi === true");
contains("Shared status disabled unless available", "if (!state.statusApiAvailable) return");

const server = fs.readFileSync(path.join(root, "server.js"), "utf8");
const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
assert.ok(server.includes('"/api/status"'), "Missing LAN status API");
assert.ok(server.includes('"/api/health"'), "Missing LAN status health API");
assert.ok(server.includes("statusApi: true"), "LAN health endpoint should advertise status API support");
assert.ok(fs.readFileSync(path.join(root, "api", "health"), "utf8").includes('"statusApi":false'), "Static health fallback should disable status API");
assert.ok(readme.includes("## Deck Setup"), "README should include deck setup guide");
assert.ok(readme.includes("cassette deck LINE IN / AUX IN / REC IN"), "README should show deck signal path");
assert.ok(readme.includes("Disable notification sounds before recording."), "README should include notification warning");
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
