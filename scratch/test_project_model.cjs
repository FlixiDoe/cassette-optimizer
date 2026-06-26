const assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

function track(id, minutes) {
  return {
    id,
    uri: `spotify:track:${id}`,
    name: `Track ${id}`,
    artists: "Test Artist",
    duration_ms: minutes * 60 * 1000
  };
}

function serializeTrack(input) {
  return {
    id: input.id || "",
    uri: input.uri || "",
    name: input.name || "Untitled track",
    artists: input.artists || "",
    duration_ms: Number(input.duration_ms) || 0
  };
}

function serializeTape(input) {
  return {
    tapeNumber: input.tapeNumber || input.number || 1,
    tapeTitle: input.tapeTitle || "Untitled mixtape",
    tapeMinutes: input.tapeMinutes,
    tapeFormat: input.tapeFormat || input.tapeMinutes,
    sideLengthMs: input.sideLengthMs,
    sideAStartIndex: input.sideAStartIndex,
    sideAEndIndex: input.sideAEndIndex,
    sideBStartIndex: input.sideBStartIndex,
    sideBEndIndex: input.sideBEndIndex,
    sideA: input.sideA.map(serializeTrack),
    sideB: input.sideB.map(serializeTrack),
    splitMode: input.splitMode || "automatic",
    manualSplitIndex: input.manualSplitIndex ?? null,
    jCard: input.jCard || { title: "", notes: "" }
  };
}

function normalizeTape(input, index) {
  const tapeFormat = Number(input.tapeFormat || input.tapeMinutes || 90);
  return {
    tapeNumber: Number(input.tapeNumber || input.number || index + 1),
    tapeTitle: input.tapeTitle || `Tape ${index + 1}`,
    tapeMinutes: tapeFormat,
    tapeFormat,
    sideLengthMs: Number(input.sideLengthMs) || tapeFormat * 60 * 1000 / 2,
    sideAStartIndex: Number(input.sideAStartIndex) || 0,
    sideAEndIndex: Number(input.sideAEndIndex) || (input.sideA || []).length,
    sideBStartIndex: Number(input.sideBStartIndex) || (input.sideA || []).length,
    sideBEndIndex: Number(input.sideBEndIndex) || ((input.sideA || []).length + (input.sideB || []).length),
    sideA: (input.sideA || []).map(serializeTrack),
    sideB: (input.sideB || []).map(serializeTrack),
    splitMode: input.splitMode || "automatic",
    manualSplitIndex: input.manualSplitIndex ?? null,
    jCard: input.jCard || { title: "", notes: "" }
  };
}

function roundTripProject(project) {
  const exported = JSON.parse(JSON.stringify({
    configVersion: 1,
    projectTitle: project.projectTitle,
    sourcePlaylistId: project.sourcePlaylistId,
    sourcePlaylistName: project.sourcePlaylistName,
    coverUrl: project.coverUrl,
    selectedTapeIndex: project.selectedTapeIndex,
    sourceTracks: project.sourceTracks.map(serializeTrack),
    tapeInventory: project.tapeInventory,
    splitMode: project.splitMode,
    calibration: project.calibration,
    tapes: project.tapes.map(serializeTape)
  }));

  return {
    ...exported,
    sourceTracks: exported.sourceTracks.map(serializeTrack),
    tapes: exported.tapes.map(normalizeTape)
  };
}

(async () => {
  const tape = await import(pathToFileURL(path.join(root, "src", "tape.js")).href);
  const jcard = await import(pathToFileURL(path.join(root, "src", "jcard.js")).href);

  const tracks = [
    track("a", 10),
    track("b", 11),
    track("c", 12),
    track("d", 13),
    track("e", 14),
    track("f", 15),
    track("g", 16),
    track("h", 17)
  ];

  const layouts = tape.splitTracksIntoTapesByFormats(tracks, [90, 60], 90);
  assert.equal(layouts.length, 2, "mixed C90/C60 project should create two tapes for this fixture");
  assert.equal(layouts[0].tapeMinutes, 90, "Tape 1 should keep C90 format");
  assert.equal(layouts[1].tapeMinutes, 60, "Tape 2 should keep C60 format");

  const project = {
    projectTitle: "Regression Mix",
    sourcePlaylistId: "playlist123",
    sourcePlaylistName: "Regression Mix",
    coverUrl: "",
    selectedTapeIndex: 1,
    sourceTracks: tracks,
    tapeInventory: { 60: 1, 90: 1 },
    splitMode: "manual",
    calibration: { leadInSeconds: 5, motorLatencySeconds: 1, safetyMarginSeconds: 0 },
    tapes: layouts.map((layout, index) => ({
      ...layout,
      tapeNumber: index + 1,
      tapeTitle: `Regression Mix - Vol. ${index + 1}`,
      tapeFormat: layout.tapeMinutes,
      splitMode: index === 0 ? "manual" : "automatic",
      manualSplitIndex: index === 0 ? layout.sideBStartIndex : null,
      jCard: { title: `Vol. ${index + 1}`, notes: index === 0 ? "Manual split" : "" }
    }))
  };

  const restored = roundTripProject(project);
  assert.equal(restored.tapes.length, 2, "export/import should restore tape count");
  assert.deepEqual(restored.tapes.map(item => item.tapeFormat), [90, 60], "export/import should restore per-tape formats");
  assert.equal(restored.tapes[0].splitMode, "manual", "manual split mode should survive export/import");
  assert.equal(restored.tapes[0].manualSplitIndex, project.tapes[0].manualSplitIndex, "manual split index should survive export/import");
  assert.deepEqual(restored.tapeInventory, { 60: 1, 90: 1 }, "tape inventory should survive export/import");

  const changedTape2 = roundTripProject({
    ...project,
    tapes: [project.tapes[0], { ...project.tapes[1], tapeFormat: 74, tapeMinutes: 74 }]
  });
  assert.equal(changedTape2.tapes[0].tapeFormat, 90, "changing Tape 2 must not reset Tape 1 format");
  assert.equal(changedTape2.tapes[1].tapeFormat, 74, "changing Tape 2 should persist its own format");

  const card = jcard.renderJCardMarkup({
    title: "Selected Tape",
    coverHtml: "<span>No cover</span>",
    tapeMinutes: restored.tapes[1].tapeFormat,
    tracks,
    sideA: restored.tapes[1].sideA,
    sideB: restored.tapes[1].sideB,
    sideAMs: tape.duration(restored.tapes[1].sideA),
    sideBMs: tape.duration(restored.tapes[1].sideB),
    totalMs: tape.duration([...restored.tapes[1].sideA, ...restored.tapes[1].sideB]),
    splitIndex: restored.tapes[1].sideBStartIndex,
    escapeHtml: value => String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
  });
  assert.ok(card.html.includes("C60"), "J-Card should use selected tape's own C-format");

  console.log("Project model export/import regression checks passed.");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
