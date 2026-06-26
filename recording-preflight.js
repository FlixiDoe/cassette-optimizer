export function validateRecordingSide({ sideName, tracks, dryRun = false, token = null, deviceReady = false, checklistReady = false, checklistSkipped = false, sideLengthMs = 0 }) {
  const issues = [];
  const side = sideName || "?";
  const sideTracks = Array.isArray(tracks) ? tracks : [];

  if (!sideTracks.length) {
    issues.push(blocking("empty_side", `Side ${side} has no tracks.`));
  }

  sideTracks.forEach((track, index) => {
    const label = trackLabel(track, index);
    if (!track?.duration_ms || Number(track.duration_ms) <= 0) {
      issues.push(blocking("missing_duration", `Side ${side}, ${label}: missing duration metadata.`));
    }
    if (track?.is_local) {
      issues.push(blocking("local_track", `Side ${side}, ${label}: local-only Spotify track cannot be played through the Web API.`));
    }
    if (!track?.uri) {
      issues.push(blocking("missing_uri", `Side ${side}, ${label}: missing Spotify URI.`));
    }
    if (sideLengthMs > 0 && Number(track?.duration_ms || 0) > sideLengthMs) {
      issues.push(blocking("track_too_long", `Side ${side}, ${label}: track is longer than the selected cassette side.`));
    }
  });

  if (!dryRun) {
    if (!token) {
      issues.push(blocking("missing_token", "Connect Spotify before real recording."));
    }
    if (!deviceReady) {
      issues.push(warning("device_not_ready", "Select or wake the Spotify target device before real recording."));
    }
  }

  if (!checklistReady && !checklistSkipped) {
    issues.push(warning("checklist_incomplete", "Complete or explicitly skip the recording checklist before starting."));
  }

  const blockingIssues = issues.filter(issue => issue.severity === "blocking");
  return {
    ok: dryRun ? blockingIssues.every(issue => !["missing_token", "missing_uri", "local_track"].includes(issue.code)) : blockingIssues.length === 0,
    issues
  };
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

function trackLabel(track, index) {
  const number = index + 1;
  const name = track?.name || "Untitled track";
  return `track ${number} (${name})`;
}
