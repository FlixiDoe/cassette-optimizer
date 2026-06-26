export function validateRecordingSide(options) {
  const input = options || {};
  const issues = [];
  const side = input.sideName || "?";
  const tracks = Array.isArray(input.tracks) ? input.tracks : [];
  const dryRun = Boolean(input.dryRun);
  const sideLengthMs = Number(input.sideLengthMs || 0);

  if (!tracks.length) {
    issues.push(blocking("empty_side", `Side ${side} has no tracks.`));
  }

  tracks.forEach((track, index) => {
    const label = `track ${index + 1} (${track?.name || "Untitled track"})`;
    const duration = Number(track?.duration_ms || 0);
    if (duration <= 0) issues.push(blocking("missing_duration", `Side ${side}, ${label}: missing duration metadata.`));
    if (track?.is_local) issues.push(blocking("local_track", `Side ${side}, ${label}: local-only Spotify track cannot be played through the Web API.`));
    if (!track?.uri) issues.push(blocking("missing_uri", `Side ${side}, ${label}: missing Spotify URI.`));
    if (sideLengthMs > 0 && duration > sideLengthMs) issues.push(blocking("track_too_long", `Side ${side}, ${label}: track is longer than the selected cassette side.`));
  });

  if (!dryRun) {
    if (!input.token) issues.push(blocking("missing_token", "Connect Spotify before real recording."));
    if (!input.deviceReady) issues.push(warning("device_not_ready", "Select or wake the Spotify target device before real recording."));
  }

  if (!input.checklistReady && !input.checklistSkipped) {
    issues.push(warning("checklist_incomplete", "Complete or explicitly skip the recording checklist before starting."));
  }

  const dryRunAllowedCodes = new Set(["missing_token", "missing_uri", "local_track"]);
  const blockingIssues = issues.filter(issue => issue.severity === "blocking");
  const remainingBlocks = dryRun ? blockingIssues.filter(issue => !dryRunAllowedCodes.has(issue.code)) : blockingIssues;

  return { ok: remainingBlocks.length === 0, issues };
}

export function summarizePreflightIssues(result) {
  if (!result?.issues?.length) return "Recording preflight passed.";
  return result.issues.map(issue => issue.message).join("\n");
}

function blocking(code, message) {
  return { severity: "blocking", code, message };
}

function warning(code, message) {
  return { severity: "warning", code, message };
}
