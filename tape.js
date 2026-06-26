export const TAPE_FORMATS = [30, 46, 50, 54, 60, 64, 70, 74, 80, 90, 100, 110, 120];

export function splitTracksForSide(tracks, sideLengthMs) {
  let sideAMs = 0;
  let split = 0;
  for (let i = 0; i < tracks.length; i += 1) {
    const next = sideAMs + tracks[i].duration_ms;
    if (next > sideLengthMs) break;
    sideAMs = next;
    split = i + 1;
  }
  return { split, sideAMs };
}

export function splitTracksIntoTapes(tracks, minutes) {
  return splitTracksIntoTapesByFormats(tracks, [minutes], minutes);
}

export function splitTracksIntoTapesByFormats(tracks, formats, fallbackMinutes) {
  const tapes = [];
  let cursor = 0;

  while (cursor < tracks.length) {
    const formatIndex = tapes.length;
    const minutes = formats[formatIndex] || fallbackMinutes;
    const sideLengthMs = minutes * 60 * 1000 / 2;
    const sideAStartIndex = cursor;
    const sideAEndIndex = fillSide(tracks, cursor, sideLengthMs);
    const sideBStartIndex = sideAEndIndex;
    const sideBEndIndex = fillSide(tracks, sideBStartIndex, sideLengthMs);

    tapes.push({
      number: tapes.length + 1,
      tapeMinutes: minutes,
      sideLengthMs,
      sideAStartIndex,
      sideAEndIndex,
      sideBStartIndex,
      sideBEndIndex,
      sideA: tracks.slice(sideAStartIndex, sideAEndIndex),
      sideB: tracks.slice(sideBStartIndex, sideBEndIndex)
    });

    cursor = sideBEndIndex;
  }

  return tapes;
}

export function analyzeTapeFitForTracks(tracks, minutes) {
  const halfMs = minutes * 60 * 1000 / 2;
  const { split, sideAMs } = splitTracksForSide(tracks, halfMs);
  const sideBMs = duration(tracks.slice(split));
  return {
    split,
    sideAMs,
    sideBMs,
    sideBFits: sideBMs <= halfMs
  };
}

export function duration(tracks) {
  return tracks.reduce((sum, track) => sum + track.duration_ms, 0);
}

function fillSide(tracks, startIndex, sideLengthMs) {
  let endIndex = startIndex;
  let sideMs = 0;
  while (endIndex < tracks.length) {
    const nextMs = sideMs + tracks[endIndex].duration_ms;
    if (nextMs > sideLengthMs && endIndex > startIndex) break;
    sideMs = nextMs;
    endIndex += 1;
    if (sideMs > sideLengthMs) break;
  }
  return endIndex;
}

export function formatTime(ms) {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function formatLongTime(ms) {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (!hours) return `${minutes}:${String(seconds).padStart(2, "0")}`;
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
