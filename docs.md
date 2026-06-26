# Cassette Optimizer Docs

Local web app for planning Spotify playlists across one or more physical cassettes and controlling cassette recording workflows.

## Responsible Use

This project is a cassette workflow tool, not a music ripping or redistribution tool. Users are responsible for complying with Spotify's terms, copyright law, and the rules that apply in their country. Do not use it to bypass DRM, copy-protection, access controls, or licensing restrictions.

## Local Setup

Spotify redirect URI:

```text
http://127.0.0.1:8787/callback
```

Start the local server:

```powershell
.\start-local.ps1
```

Or manually:

```powershell
python -m http.server 8787 --bind 127.0.0.1
```

Open:

```text
http://127.0.0.1:8787/
```

Do not use `file://` for Spotify login. OAuth PKCE needs the local HTTP origin, and the server must stay running until Spotify redirects back to `/callback`.

## Usage

1. Connect Spotify.
2. Click `Refresh` under `Your Spotify playlists`.
3. Choose a playlist or paste a Spotify playlist URL/ID manually.
4. Check the cassette formats you own under `Tapes you have`.
5. Choose the tape format to plan against.
6. Click `Load playlist`.
7. Review total runtime, tape recommendation, physical tape plan, Side A, and Side B.
8. In `Playback`, click `Refresh` under `Spotify device` if you want to target a specific Spotify Connect device.
9. Complete the Spotify / Windows audio settings checklist below.
10. Use `Apply to Spotify` only when you want to sync the order to Spotify.
11. Use `Start Side A`; when the red `PRESS RECORD NOW` cue appears, start recording on your cassette/cable deck.
12. Spotify starts automatically after the cue and any configured delay calibration. Wait for auto-pause, flip the cassette, then use `Start Side B` and start recording again when the cue appears.
13. For multi-tape projects, choose the next physical cassette from the plan selector and repeat Side A / Side B.
14. Use `Abort Recording` only if you want to stop the current recording run and reset Record Mode.

## Spotify / Windows Audio Settings Before Recording

The app cannot verify these settings automatically. Use them as a manual checklist before real recording.

Spotify settings:

- Select the exact output device you will record from.
- Set Streaming quality to Lossless.
- Turn Auto-adjust quality off.
- Set Crossfade to 0 seconds.
- Turn Normalize volume off.
- Turn all Spotify Equalizer/EQ processing off.
- Open the selected output device settings.
- Enable Exclusive mode for this device.
- Enable Force volume for this device.

Windows / device settings:

- Set Windows output device to the same device used in Spotify.
- Set Windows output volume to 100% / maximum.
- Turn off system-wide EQ, sound enhancements, loudness normalization, virtual surround, or other processing if you use them.
- Control final recording level on the cassette deck input, not with Windows volume.
- Watch the deck meters and avoid clipping or distortion.

## LAN Status Mode

Use this optional server when another device, such as a phone, should open the same UI and monitor the current status:

```powershell
.\start-lan.ps1
```

The LAN server listens on `0.0.0.0:8787`, serves the same app, and exposes `/api/status` for status mirroring. The main app posts status only; Spotify tokens are not shared. Use it only on a trusted private network.

## Supported Tape Formats

`C30`, `C46`, `C50`, `C54`, `C60`, `C64`, `C70`, `C74`, `C80`, `C90`, `C100`, `C110`, `C120`

## Cassette Logic

- Tracks are never cut.
- Original playlist order is preserved.
- Side A is filled until the next full track would exceed half of the selected tape.
- Side B is filled the same way from the next remaining track.
- If tracks remain after Side B, the app creates another physical tape and continues filling it.
- Recommendations only use cassette formats selected under `Tapes you have`.
- The app recommends the smallest available format where total runtime and Side B fit cleanly.
- If total runtime fits but one side does not, the app warns that manual rebalancing would be needed.
- If the playlist exceeds one selected tape, the app plans multiple physical cassettes while preserving order.

## Mixtape Project Model

After loading a playlist, the app creates a central project object. It stores playlist metadata, source tracks, selected physical tape index, split mode, calibration settings, timestamps, and a `tapes[]` array.

Each tape object stores:

- `tapeNumber`
- `tapeTitle`
- `tapeFormat`
- `sideLengthMs`
- `sideA[]`
- `sideB[]`
- `jCard`

The selected physical tape is `project.tapes[selectedTapeIndex]`. The visible Side A / Side B lists, Record Mode, J-card preview, print output, and mirrored LAN status all read from that selected tape object. This avoids parallel state for multi-tape planning and keeps future JSON export/import and per-tape format selection straightforward.

## J-Card Generator

- The app renders a printable cassette inlay after a playlist is loaded.
- The J-card includes playlist name or generated volume title, Spotify cover image, total runtime, selected physical tape format, Side A tracks, and Side B tracks.
- Multi-tape projects automatically generate volume titles such as `Playlist Title - Vol. 1`.
- Use `Print J-Card` to print the selected physical tape.
- Use `Print All J-Cards` to print all physical tapes in one print run.
- Print CSS hides the app UI and prints only the J-card layout on A4 landscape paper.
- Fold/cut guides are shown as dashed panel borders.

## Record Mode

- The Playback panel can load Spotify Connect devices via `/me/player/devices`.
- If a device is selected, playback commands use that device with `device_id`; otherwise Spotify uses the default active device.
- `Start Side A` starts Spotify playback with the calculated Side A queue.
- Playback starts from an explicit Side A/B track queue so Spotify receives only the tracks for the current cassette side.
- In multi-tape projects, Record Mode follows the selected physical tape from the plan selector.
- For fresh side starts, the app disables Spotify shuffle and repeat before playback so Side A/B does not jump to later songs.
- Before recording, set Spotify to Lossless, turn Auto-adjust quality off, set Crossfade to 0 seconds, turn Normalize volume and EQ off, select the same output device in Spotify and Windows, enable Exclusive mode and Force volume, and keep Windows output volume at 100%. Adjust final gain on the cassette deck input.
- During recording, the app compares Spotify's current track with the track expected from the local record timer and corrects Spotify if it jumps ahead.
- Before Spotify starts, the app shows `PRESS RECORD NOW - SIDE A` for 5 seconds so you can start recording first.
- If Side A is paused, the button changes to `Resume Side A` and resumes Spotify without resetting the queue.
- The app polls Spotify playback state while recording.
- Polling is adaptive to avoid unnecessary Spotify API load.
- During recording, playback is checked about every 2 seconds.
- In paused, flip, idle, no-device, or outside-side states, polling slows down.
- If Spotify returns rate limit `429`, the app respects the `Retry-After` delay before polling again.
- Current Spotify track and track remaining time stay visible.
- The timer also shows the estimated local clock time when the currently active side will finish.
- Side elapsed time is calculated from Spotify's current track position plus previous tracks on that side.
- Duplicate tracks are handled conservatively, and the local recording timer stays authoritative so stale Spotify positions cannot jump the display forward by minutes.
- A local monotonic timer keeps the countdown moving between Spotify polls and prevents stale playback positions from moving the display backward.
- At the end of Side A, the app pauses Spotify automatically.
- The UI switches to `Flip cassette` and shows `FLIP THE CASSETTE!`.
- `Start Side B` is unlocked after the Side A auto-pause/flip state and starts the calculated Side B queue.
- Before Side B playback starts, the app shows `PRESS RECORD NOW - SIDE B` for 5 seconds.
- If Side B is paused, the button changes to `Resume Side B` and resumes Spotify without resetting the queue.
- At the end of Side B, the app pauses Spotify automatically and returns Record Mode to `Idle`.
- `Abort Recording` pauses Spotify where possible, clears timers/cues/polling, and returns Record Mode to `Idle`.
- If Spotify reports no active device, open Spotify on desktop/mobile and start playback once.

## Spotify Scopes

- `playlist-read-private`
- `playlist-modify-private`
- `playlist-modify-public`
- `user-read-playback-state`
- `user-modify-playback-state`

## Troubleshooting

- `ERR_CONNECTION_REFUSED` after Spotify login: start `.\start-local.ps1` and reload the callback URL.
- `OAuth callback rejected`: start again from `http://127.0.0.1:8787/` and reconnect Spotify.
- `No active Spotify device found`: open Spotify on desktop/mobile, start playback once, then retry.
- If default playback fails, click `Refresh` under `Spotify device`, choose the visible Spotify Connect device, then retry.
- Playlist list is empty: reconnect Spotify and ensure the token has `playlist-read-private`.

## Regression Test

Run the playback regression checks:

```powershell
node scratch/test_playback.js
```

## Repository State

- Repository: `https://github.com/FlixiDoe/cassette-optimizer`
- Visibility: private
- GitHub Pages: disabled
- Open-source preparation: README, MIT license, and publishing checklist are prepared, but the repository has not been made public.
