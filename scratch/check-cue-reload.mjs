// Optional browser regression, run from the repository root:
// npm install --no-save --package-lock=false playwright-core
// npx playwright-core install chromium
// node scratch/check-cue-reload.mjs
// CHROMIUM_PATH can select an existing Chromium executable. Every request stays in the fixture.
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = new URL("../", import.meta.url);
const origin = "http://127.0.0.1:8787";
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH,
  args: process.env.CHROMIUM_SINGLE_PROCESS ? ["--single-process", "--disable-gpu"] : []
});

try {
  const page = await browser.newPage();
  const plays = [];
  await page.route("**/*", async route => {
    const { origin: requestOrigin, pathname } = new URL(route.request().url());
    if (requestOrigin === "https://api.spotify.com") {
      if (pathname === "/v1/me/player/play") plays.push(route.request().postDataJSON());
      return route.fulfill({ status: 204 });
    }
    if (requestOrigin !== origin) return route.abort();
    if (pathname.startsWith("/api/")) return route.fulfill({ json: { statusApi: false } });
    const asset = pathname === "/" ? "index.html" : pathname.slice(1);
    return route.fulfill({ path: fileURLToPath(new URL(asset, root)) });
  });
  await page.clock.install();
  await page.addInitScript(() => {
    const legacy = sessionStorage.getItem("legacy");
    if (legacy) {
      localStorage.setItem("cassetteOptimizerRecordingState", legacy);
      sessionStorage.removeItem("legacy");
    }
    if (sessionStorage.getItem("fixture")) return;
    sessionStorage.setItem("fixture", "1");
    const entries = {
      spotify_token: { token: "offline-fixture", expiresAt: Date.now() + 86400000 },
      spotify_selected_device: { id: "stub", name: "Offline device" },
      cassetteProfiles: [{ id: "fixture", name: "C60", lengthMinutes: 60 }],
      tapeCollection: [{ id: "owned", cassetteProfileId: "fixture" }],
      deck_checklist: { skip: true }
    };
    for (const [name, data] of Object.entries(entries)) localStorage.setItem(name, JSON.stringify(data));
    localStorage.setItem("spotify_device_id", "stub");
  });
  await page.goto(origin);
  const tracks = ["A", "B"].map(id => ({
    name: id, id, uri: "spotify:track:" + id, duration_ms: 20000
  }));
  const fixture = { configVersion: 1, tracks, projectTitle: "Offline recording",
    tapeInventory: { 60: 1 }, selectedTapeMinutes: 60,
    tapes: [{ tapeMinutes: 60, sideA: tracks.slice(0, 1), sideB: tracks.slice(1) }] };
  await page.locator("#importConfigFile").setInputFiles({
    name: "two-sides.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(fixture))
  });
  const pausedSnapshots = {};
  for (const side of ["A", "B"]) {
    const start = page.locator("#start" + side);
    await start.click();
    await page.waitForSelector("#recordCue.show");
    await page.reload();
    const recoveredLabel = await start.textContent();
    await start.click();
    await page.clock.runFor(6000);
    await page.waitForFunction(() => !document.querySelector("#pauseBtn").disabled);
    assert.deepEqual(plays.at(-1), { uris: ["spotify:track:" + side], offset: { position: 0 }, position_ms: 0 });
    assert.equal(recoveredLabel, "Start Side " + side, "fresh cue on " + side);
    await page.clock.runFor(2500);
    await page.locator("#pauseBtn").click();
    await page.waitForFunction(() => document.querySelector("#recordModeStatus").textContent === "Paused");
    const paused = await page.evaluate(() => JSON.parse(localStorage.getItem("cassetteOptimizerRecordingState")));
    assert.ok(paused.elapsedMs >= 2500 && paused.elapsedMs < 20000);
    pausedSnapshots[side] = paused;
    await start.click();
    await page.waitForSelector("#recordCue.show");
    await page.reload();
    assert.equal(await start.textContent(), "Resume Side " + side, "resume cue on " + side);
    const recoveredElapsed = await page.evaluate(() => JSON.parse(localStorage.getItem("cassetteOptimizerRecordingState")).elapsedMs);
    assert.equal(recoveredElapsed, paused.elapsedMs);
    await start.click();
    await page.clock.runFor(6000);
    await page.waitForFunction(() => !document.querySelector("#pauseBtn").disabled);
    assert.equal(plays.at(-1), null, "resume the existing queue");
    await page.clock.runFor(21000);
  }
  assert.equal(plays.length, 4);
  await page.waitForFunction(() => !document.querySelector("#startA").disabled);
  for (const side of ["A", "B"]) {
    const legacy = { ...pausedSnapshots[side], recordMode: "cue_" + side.toLowerCase() };
    await page.evaluate(data => sessionStorage.setItem("legacy", JSON.stringify(data)), legacy);
    await page.reload();
    const start = page.locator("#start" + side);
    assert.equal(await start.isEnabled(), true);
    assert.equal(await start.textContent(), "Start Side " + side, "legacy cue on " + side);
  }
  assert.equal(plays.length, 4, "restoring must not send a play command");
  console.log("Passed fresh, paused and legacy cue recovery on both sides.");
} finally {
  await browser.close();
}
