export const CURRENT_CONFIG_VERSION = 1;

export function migrateImportedConfig(payload) {
  const input = isObject(payload) ? payload : {};
  const version = Number(input.configVersion || 0);

  if (version <= 0) return migrateLegacyConfig(input);
  if (version === CURRENT_CONFIG_VERSION) return migrateVersionOne(input);

  return migrateFutureConfig(input);
}

function migrateLegacyConfig(input) {
  const tapeMinutes = normalizeTapeMinutes(input.tapeMinutes || input.tapeFormat || 90);
  const sourceTracks = normalizeTracks(input.sourceTracks || input.tracks || []);
  const tapes = Array.isArray(input.tapes) && input.tapes.length
    ? input.tapes.map((tape, index) => normalizeTape(tape, index, tapeMinutes))
    : [normalizeTape({
        tapeNumber: 1,
        tapeTitle: input.projectTitle || input.playlistName || "Imported mixtape",
        tapeMinutes,
        tapeFormat: tapeMinutes,
        sideA: input.sideA || [],
        sideB: input.sideB || []
      }, 0, tapeMinutes)];

  return {
    ...input,
    configVersion: CURRENT_CONFIG_VERSION,
    projectTitle: input.projectTitle || input.playlistName || input.sourcePlaylistName || "Imported mixtape",
    sourcePlaylistId: input.sourcePlaylistId || input.playlistId || "",
    sourcePlaylistName: input.sourcePlaylistName || input.playlistName || input.projectTitle || "",
    coverUrl: input.coverUrl || input.playlistCoverUrl || "",
    sourceTracks,
    selectedTapeIndex: clampIndex(input.selectedTapeIndex, tapes.length),
    tapes,
    splitMode: input.splitMode || (tapes.some(tape => tape.splitMode === "manual") ? "manual" : "automatic"),
    calibration: normalizeCalibration(input.calibration),
    tapeInventory: normalizeTapeInventory(input.tapeInventory),
    slackMarginSeconds: normalizeNumber(input.slackMarginSeconds, 0, 0, 120),
    jCardOverrides: normalizeObject(input.jCardOverrides),
    createdAt: input.createdAt || new Date().toISOString(),
    updatedAt: input.updatedAt || new Date().toISOString()
  };
}

function migrateVersionOne(input) {
  const tapes = Array.isArray(input.tapes)
    ? input.tapes.map((tape, index) => normalizeTape(tape, index, tapeFallback(input)))
    : [];

  return {
    ...input,
    configVersion: CURRENT_CONFIG_VERSION,
    projectTitle: input.projectTitle || input.sourcePlaylistName || "Imported mixtape",
    sourcePlaylistId: input.sourcePlaylistId || "",
    sourcePlaylistName: input.sourcePlaylistName || input.projectTitle || "",
    coverUrl: input.coverUrl || "",
    sourceTracks: normalizeTracks(input.sourceTracks || []),
    selectedTapeIndex: clampIndex(input.selectedTapeIndex, tapes.length),
    tapes,
    splitMode: input.splitMode || (tapes.some(tape => tape.splitMode === "manual") ? "manual" : "automatic"),
    calibration: normalizeCalibration(input.calibration),
    tapeInventory: normalizeTapeInventory(input.tapeInventory),
    slackMarginSeconds: normalizeNumber(input.slackMarginSeconds, 0, 0, 120),
    jCardOverrides: normalizeObject(input.jCardOverrides),
    createdAt: input.createdAt || new Date().toISOString(),
    updatedAt: input.updatedAt || new Date().toISOString()
  };
}

function migrateFutureConfig(input) {
  console.warn(`Importing future cassette config version ${input.configVersion}; normalizing to version ${CURRENT_CONFIG_VERSION}.`);
  return migrateVersionOne({
    ...input,
    configVersion: CURRENT_CONFIG_VERSION
  });
}

function normalizeTape(input, index, fallbackTapeMinutes) {
  const tapeMinutes = normalizeTapeMinutes(input.tapeFormat || input.tapeMinutes || fallbackTapeMinutes);
  const sideA = normalizeTracks(input.sideA || []);
  const sideB = normalizeTracks(input.sideB || []);
  const sideLengthMs = normalizeNumber(input.sideLengthMs, tapeMinutes * 60 * 1000 / 2, 0, Number.MAX_SAFE_INTEGER);

  return {
    ...input,
    tapeNumber: normalizeNumber(input.tapeNumber || input.number, index + 1, 1, 999),
    number: normalizeNumber(input.number || input.tapeNumber, index + 1, 1, 999),
    tapeTitle: input.tapeTitle || `Tape ${index + 1}`,
    tapeMinutes,
    tapeFormat: tapeMinutes,
    sideLengthMs,
    sideAStartIndex: normalizeNumber(input.sideAStartIndex, 0, 0, Number.MAX_SAFE_INTEGER),
    sideAEndIndex: normalizeNumber(input.sideAEndIndex, sideA.length, 0, Number.MAX_SAFE_INTEGER),
    sideBStartIndex: normalizeNumber(input.sideBStartIndex, sideA.length, 0, Number.MAX_SAFE_INTEGER),
    sideBEndIndex: normalizeNumber(input.sideBEndIndex, sideA.length + sideB.length, 0, Number.MAX_SAFE_INTEGER),
    sideA,
    sideB,
    splitMode: input.splitMode === "manual" ? "manual" : "automatic",
    manualSplitIndex: input.manualSplitIndex ?? null,
    jCard: isObject(input.jCard) ? input.jCard : { title: "", notes: "" },
    spineNote: typeof input.spineNote === "string" ? input.spineNote : ""
  };
}

function normalizeTracks(value) {
  return Array.isArray(value) ? value.map(normalizeTrack).filter(track => track.duration_ms > 0) : [];
}

function normalizeTrack(input) {
  return {
    id: input?.id || "",
    uri: input?.uri || "",
    name: input?.name || "Untitled track",
    artists: input?.artists || "",
    duration_ms: normalizeNumber(input?.duration_ms, 0, 0, Number.MAX_SAFE_INTEGER),
    is_local: Boolean(input?.is_local)
  };
}

function normalizeCalibration(input) {
  return {
    leadInSeconds: normalizeNumber(input?.leadInSeconds, 0, 0, 120),
    motorLatencySeconds: normalizeNumber(input?.motorLatencySeconds, 0, 0, 30),
    safetyMarginSeconds: normalizeNumber(input?.safetyMarginSeconds, 0, 0, 300)
  };
}

function normalizeTapeInventory(input) {
  if (!isObject(input)) return {};
  return Object.fromEntries(Object.entries(input).map(([format, count]) => [
    String(normalizeTapeMinutes(format)),
    normalizeNumber(count, 0, 0, 999)
  ]));
}

function tapeFallback(input) {
  const firstTape = Array.isArray(input.tapes) ? input.tapes[0] : null;
  return normalizeTapeMinutes(input.tapeMinutes || input.tapeFormat || firstTape?.tapeFormat || firstTape?.tapeMinutes || 90);
}

function normalizeTapeMinutes(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 90;
}

function normalizeNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function clampIndex(value, count) {
  if (!count) return 0;
  return Math.max(0, Math.min(count - 1, normalizeNumber(value, 0, 0, count - 1)));
}

function normalizeObject(value) {
  return isObject(value) ? value : {};
}

function isObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}
