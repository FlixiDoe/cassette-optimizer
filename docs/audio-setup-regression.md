# Audio Setup Regression Checklist

Use this checklist before a release or after changing recording setup copy, the deck checklist, calibration controls, or Record Mode.

## Documentation Checks

- README mentions Spotify `Lossless`.
- README says Auto-adjust quality should be off.
- README says Crossfade should be `0 seconds`.
- README says Normalize volume should be off.
- README says Spotify EQ and other sound processing should be off.
- README mentions selecting the exact Spotify output device used for recording.
- README mentions using the same Spotify and operating system output device.
- README mentions exclusive, fixed-volume, or direct hardware output where available.
- README says system output volume should be at 100% / maximum.
- README explains that final recording gain is adjusted on the cassette deck input.

## In-App Checks

- The Deck Checklist includes a compact audio-settings confirmation.
- The Deck Checklist reminds the user to turn Spotify EQ and system sound enhancements off.
- The Deck Checklist reminds the user that Spotify and operating system output devices should match.
- The Deck Checklist mentions exclusive, fixed-volume, or direct hardware output.
- The Level check helper shows seven compact informational checkpoints, not a long prose paragraph.
- The seven Level Check checkpoints are: Spotify Lossless/highest quality, Crossfade 0 s, Normalize off, EQ off, system volume 100 %, deck in record-pause, and peaks clean/no clipping.
- `Leader Tape Delay` appears in the calibration panel instead of `Lead-in delay`.
- During a leader-tape cue, the monitor copy says `Advancing past leader tape`.
- `Level Check` offers 400 Hz, 1 kHz, and pink noise.
- `Level Check` offers `-12 dBFS`, `-6 dBFS`, and `0 dBFS`, defaulting to a non-maximum level.
- Starting the tone shows a warning confirmation and does not auto-start on page load.
- `Stop Tone` is visible and stops the Web Audio source.
- Recording Readiness shows Spotify, Device, Playlist, Tape, Checklist, API, and Ready rows.
- Start Side A/B stays blocked until every Recording Readiness row is green.
- The Tape row turns red when `Tapes you have` is empty, short of the planned formats, or too small for a planned side.
- Recording Readiness shows actionable recovery text for sleeping devices, wrong target device, idle playback after command, rate limits, and expired tokens.

## Manual Recording Setup Check

- Select the Spotify playback device that feeds the deck.
- Set Spotify quality to Lossless.
- Disable Auto-adjust quality.
- Set Crossfade to 0 seconds.
- Disable Normalize volume.
- Disable Spotify EQ.
- Disable system EQ, loudness normalization, virtual surround, and sound enhancements where applicable.
- Set system output volume to 100%.
- Put the cassette deck into record-pause and set deck input gain from the deck meters.
- Confirm peaks stay below clipping or audible distortion.
- Start and stop the browser Level Check tone at a low deck input gain.
- Confirm Start Side A/B is blocked until Recording Readiness is all green.
- Confirm planning controls cannot be changed while cueing, recording, paused, or waiting at the flip prompt.
