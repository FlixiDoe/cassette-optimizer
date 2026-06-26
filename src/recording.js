export const RECORD_CUE_SECONDS = 5;

export function getExpectedTrackAtElapsed(tracks, elapsedMs) {
  let running = 0;
  for (let index = 0; index < tracks.length; index += 1) {
    const track = tracks[index];
    const next = running + track.duration_ms;
    if (elapsedMs < next) {
      return {
        index,
        track,
        startsAt: running,
        positionMs: Math.max(0, elapsedMs - running)
      };
    }
    running = next;
  }
  const lastIndex = tracks.length - 1;
  return tracks[lastIndex]
    ? { index: lastIndex, track: tracks[lastIndex], startsAt: running - tracks[lastIndex].duration_ms, positionMs: tracks[lastIndex].duration_ms - 1000 }
    : null;
}
