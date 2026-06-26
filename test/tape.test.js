import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeTapeFitForTracks,
  applyManualSplitToTapeLayout,
  duration,
  splitTracksForSide,
  splitTracksIntoTapes,
  splitTracksIntoTapesByFormats
} from "../src/tape.js";

function track(name, minutes) {
  return {
    id: name,
    uri: `spotify:track:${name}`,
    name,
    artists: "Test Artist",
    duration_ms: minutes * 60 * 1000
  };
}

test("empty playlist produces no tapes", () => {
  assert.deepEqual(splitTracksIntoTapes([], 60), []);
});

test("playlist fits one side", () => {
  const tracks = [track("a", 10), track("b", 12)];
  const result = splitTracksForSide(tracks, 30 * 60 * 1000);
  assert.equal(result.split, 2);
  assert.equal(result.sideAMs, duration(tracks));
});

test("playlist fits one tape with original order preserved", () => {
  const tracks = [track("a", 20), track("b", 10), track("c", 25)];
  const [layout] = splitTracksIntoTapes(tracks, 60);
  assert.equal(layout.sideA.length, 2);
  assert.equal(layout.sideB.length, 1);
  assert.deepEqual([...layout.sideA, ...layout.sideB].map(item => item.name), ["a", "b", "c"]);
});

test("playlist exceeding selected tape uses multiple tapes", () => {
  const tracks = [track("a", 30), track("b", 30), track("c", 30)];
  const layouts = splitTracksIntoTapes(tracks, 60);
  assert.equal(layouts.length, 2);
});

test("track longer than side remains planned and overflows its side", () => {
  const tracks = [track("long", 35)];
  const [layout] = splitTracksIntoTapes(tracks, 60);
  assert.equal(layout.sideA.length, 1);
  assert.ok(duration(layout.sideA) > layout.sideLengthMs);
});

test("manual split valid", () => {
  const tracks = [track("a", 10), track("b", 10), track("c", 10)];
  const [layout] = splitTracksIntoTapes(tracks, 60);
  const result = applyManualSplitToTapeLayout(layout, tracks, 1);
  assert.equal(result.ok, true);
  assert.equal(result.layout.sideA.length, 1);
  assert.equal(result.layout.sideB.length, 2);
  assert.equal(result.layout.splitMode, "manual");
});

test("manual split invalid when side A exceeds side length", () => {
  const tracks = [track("a", 20), track("b", 20), track("c", 5)];
  const [layout] = splitTracksIntoTapes(tracks, 60);
  const result = applyManualSplitToTapeLayout(layout, tracks, 2);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "side_a_overflow");
});

test("safety margin can be evaluated against remaining side time", () => {
  const tracks = [track("a", 28)];
  const [layout] = splitTracksIntoTapes(tracks, 60);
  const remainingMs = layout.sideLengthMs - duration(layout.sideA);
  assert.ok(remainingMs < 3 * 60 * 1000);
});

test("multi-tape split uses correct tape count", () => {
  const tracks = [track("a", 25), track("b", 25), track("c", 25), track("d", 25), track("e", 25)];
  assert.equal(splitTracksIntoTapes(tracks, 60).length, 3);
});

test("per-tape side split preserves original order", () => {
  const tracks = [track("a", 20), track("b", 20), track("c", 20), track("d", 20)];
  const layouts = splitTracksIntoTapes(tracks, 60);
  assert.deepEqual(layouts.flatMap(layout => [...layout.sideA, ...layout.sideB]).map(item => item.name), ["a", "b", "c", "d"]);
});

test("multi-tape project with mixed C60/C90 formats", () => {
  const tracks = [track("a", 30), track("b", 35), track("c", 35), track("d", 35)];
  const layouts = splitTracksIntoTapesByFormats(tracks, [60, 90], 90);
  assert.equal(layouts[0].tapeMinutes, 60);
  assert.equal(layouts[1].tapeMinutes, 90);
});

test("changing Tape 2 format does not change Tape 1 format", () => {
  const tracks = [track("a", 30), track("b", 35), track("c", 35), track("d", 35)];
  const before = splitTracksIntoTapesByFormats(tracks, [60, 60], 60);
  const after = splitTracksIntoTapesByFormats(tracks, [60, 90], 60);
  assert.equal(before[0].tapeMinutes, after[0].tapeMinutes);
  assert.equal(after[1].tapeMinutes, 90);
});

test("analyzeTapeFit reports side B overflow", () => {
  const tracks = [track("a", 20), track("b", 20), track("c", 20)];
  const fit = analyzeTapeFitForTracks(tracks, 60);
  assert.equal(fit.split, 1);
  assert.equal(fit.sideBFits, false);
});

test("serialized split data can restore the full layout model", () => {
  const tracks = [track("a", 20), track("b", 10), track("c", 20)];
  const [layout] = splitTracksIntoTapes(tracks, 60);
  const serialized = JSON.parse(JSON.stringify({ sourceTracks: tracks, tapes: [layout], selectedTapeIndex: 0 }));
  assert.deepEqual(serialized.tapes[0].sideA.map(item => item.uri), layout.sideA.map(item => item.uri));
  assert.deepEqual(serialized.tapes[0].sideB.map(item => item.uri), layout.sideB.map(item => item.uri));
  assert.equal(serialized.selectedTapeIndex, 0);
});

test("optional slack margin extends planned side length", () => {
  const tracks = [
    track("a", 30),
    track("b", 20 / 60)
  ];
  const [withoutSlack] = splitTracksIntoTapesByFormats(tracks, [60], 60);
  const [withSlack] = splitTracksIntoTapesByFormats(tracks, [60], 60, 30 * 1000);

  assert.equal(withoutSlack.sideA.length, 1);
  assert.equal(withSlack.sideA.length, 2);
  assert.equal(withSlack.sideLengthMs, 30 * 60 * 1000 + 30 * 1000);
});
