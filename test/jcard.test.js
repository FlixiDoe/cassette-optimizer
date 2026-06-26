import assert from "node:assert/strict";
import test from "node:test";

import { cleanJCardTrackTitle } from "../src/jcard.js";

test("j-card title cleanup removes common long suffixes", () => {
  assert.equal(cleanJCardTrackTitle("Song - 2011 Remastered"), "Song");
  assert.equal(cleanJCardTrackTitle("Song (Live at Wembley)"), "Song");
  assert.equal(cleanJCardTrackTitle("Song [Deluxe Edition]"), "Song");
  assert.equal(cleanJCardTrackTitle("Song"), "Song");
});
