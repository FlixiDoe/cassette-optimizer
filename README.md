# Cassette Optimizer

A local-first Spotify playlist planner and playback controller for recording mixtapes to cassette.

Cassette Optimizer keeps a Spotify playlist in order, plans it across one or more physical cassettes, shows a recording countdown, and controls Spotify playback so the user can record one side at a time.

<img width="2425" height="1237" alt="demo1" src="https://github.com/user-attachments/assets/35ee286c-fd36-4c0a-9bfa-be8ca59ce49c" />

<img width="2465" height="1230" alt="demo2" src="https://github.com/user-attachments/assets/0787fe56-16e1-4888-bea3-3630c2ad903a" />

<img width="2537" height="1241" alt="demo3" src="https://github.com/user-attachments/assets/d745e9ea-7903-4263-b988-4d3c09d7d712" />




## Documentation

- [docs.md](docs.md) — documentation index.
- [docs/code-overview.md](docs/code-overview.md) — how the code is structured.
- [docs/app-state-and-flow.md](docs/app-state-and-flow.md) — how state moves through the app.
- [docs/module-reference.md](docs/module-reference.md) — file-by-file code reference.
- [docs/ai-usage.md](docs/ai-usage.md) — AI tools used for research, prompting, implementation, and repository maintenance.
- [CHANGELOG.md](CHANGELOG.md) — release notes and feature highlights.
- [TODO.md](TODO.md) — short-lived task list; currently no active implementation tasks.

## Responsible Use

This project is a cassette workflow tool, not a music ripping or redistribution tool.

You are responsible for complying with Spotify's terms, copyright law, and the rules that apply in your country. Do not use this project to bypass DRM, copy-protection, access controls, or licensing restrictions. Do not distribute recordings unless you have the rights to do so.

For the safest use, record only music you own, created yourself, or are otherwise licensed to copy.

## What it does

- Loads Spotify playlists through OAuth PKCE.
- Plans tracks across one or more cassette tapes without cutting tracks.
- Keeps multi-tape state in a central project model.
- Supports deck profiles, cassette model profiles, exact per-tape cassette model selection, and owned tape inventory quantities.
- Blocks recording when `Tapes you have` cannot satisfy the current plan or any planned side is too long for its cassette format.
- Exports/imports cassette projects as JSON.
- Exports/imports profile folders with deck profiles, cassette profiles, playlist profiles, and tape collection JSON separated into subfolders; unreadable JSON files are skipped with a log entry.
- Migrates older cassette project JSON during import.
- Controls Spotify playback for Side A / Side B recording with preflight safety checks.
- Locks planning controls while cueing, recording, pausing, or waiting for a flip.
- Provides a seven-row Recording Readiness panel and blocks Start Side A/B until all rows are green.
- Provides Dry Run mode with visible simulation logging, recording countdowns, deck readiness guidance, and optional LAN monitoring.
- Handles Spotify 429 rate limits with a Retry-After countdown and recording-safe playback command replay.
- Adds calibration helpers for leader tape delay, motor latency, safety margin, and browser-based level-check tones.
- Prints J-cards with title cleanup, manual print-only title overrides, and cover-derived theme colors.
- Supports explicit tape slack margin tolerance with warnings when unofficial tape length is used.

For implementation details, read [docs/code-overview.md](docs/code-overview.md) and [docs/module-reference.md](docs/module-reference.md).

## Local Setup

Use Node.js 18 or newer for the local server and automated tests.

Create or open a Spotify app in the Spotify Developer Dashboard and add this redirect URI:

```text
http://127.0.0.1:8787/callback
```

If you use Tailscale Serve, also add the exact HTTPS Tailscale callback URL, for example:

```text
https://der-dicke.tenrec-typhon.ts.net/callback
```

Start the local server on Windows, Linux, or macOS:

```sh
npm run start:local
```

Windows PowerShell convenience script:

```powershell
.\scripts\start-local.ps1
```

Linux/macOS convenience script:

```sh
./scripts/start-local.sh
```

Or manually with Python:

```sh
python -m http.server 8787 --bind 127.0.0.1
```

Open:

```text
http://127.0.0.1:8787/
```

Do not use `file://` for Spotify login. OAuth PKCE requires the local HTTP origin, and the server must stay running until Spotify redirects back to `/callback`.

## LAN Monitor Mode

For monitoring from another device on the same network, use the optional Node server:

```sh
npm run start:lan
```

PowerShell and POSIX shell convenience scripts are also available:

```powershell
.\scripts\start-lan.ps1
```

```sh
./scripts/start-lan.sh
```

They serve the same app on all network interfaces and add a small `/api/status` endpoint. Open the printed LAN URL on another device to monitor the current playback status.

LAN clients are monitor-only. Spotify OAuth and playback control must be done from `http://127.0.0.1:8787` on the host machine.

Keep the LAN server on a trusted private network only. Do not expose it directly to the public internet.

## Tailscale Serve Control Mode

Tailscale Serve can expose the local app over your private tailnet with HTTPS:

```sh
npm run start:lan
tailscale serve 8787
```

Open the printed `https://...ts.net/` URL on a tailnet device. Unlike plain LAN/IP access, Tailscale HTTPS is allowed to show Spotify login and playback controls.

Spotify tokens are stored per browser origin. Being connected on `http://127.0.0.1:8787` does not connect `https://...ts.net/`; click `Connect Spotify` on the Tailscale URL once.

Client Secret auth remains disabled on Tailscale. Use normal PKCE with your Spotify Client ID.

## Spotify App Configuration

Create your own Spotify app and paste its Client ID into the app UI. The repository does not ship with a default Client ID.

The app defaults to OAuth PKCE without a Client Secret. The optional Client Secret field is advanced, local-only, and should not be used on public hosting or LAN devices.

Do not add Spotify Client IDs, client secrets, GitHub tokens, OAuth access tokens, or refresh tokens to the repository.

Required scopes:

```text
playlist-read-private
playlist-modify-private
playlist-modify-public
user-read-playback-state
user-modify-playback-state
```

## Basic Usage

1. Open `http://127.0.0.1:8787/`.
2. Click `Connect Spotify`.
3. Click `Refresh` under `Your Spotify playlists`.
4. Choose a playlist from the dropdown or paste a playlist URL/ID.
5. Click `Load playlist` in the playlist block.
6. Review or create a `Deck profile`; use `Save deck profile` after edits, or `Delete` / `Delete all` when cleaning up profiles.
7. Review or create cassette model profiles; use `Save cassette profile` after edits, or `Delete` / `Delete all` when cleaning up cassette models.
8. Add owned physical cassettes with the plus controls under `Tapes you have`. First-run inventory starts empty, and creating a cassette profile does not automatically add a physical tape.
9. Choose a tape format.
10. For multi-tape plans, choose the exact owned cassette model for each physical tape when needed.
11. Review the physical tape plan, Side A, Side B, remaining blank tape, warnings, and J-card preview.
12. Confirm the Tape row in Recording Readiness is green; it turns red if `Tapes you have` is empty, too small, or short of the formats the plan needs.
13. Optionally set `Tape Slack Margin (seconds)` if you intentionally want to use unofficial tape headroom.
14. Refresh Spotify devices and choose the target device if needed.
15. Complete the recording checklist, or explicitly use `Skip checklist`.
16. Use the seven Level Check checkpoints and `Level Check` tone only after turning the deck input gain down, then stop the tone before recording.
17. Wait until all Recording Readiness rows are green.
18. Click `Start Side A` and start the cassette deck when `PRESS RECORD NOW` appears.
19. After Side A auto-pauses, flip the cassette and use `Start Side B`.
20. For multi-tape projects, choose the next physical cassette from the plan selector and repeat Side A / Side B.

## Profiles and Tape Collection

Deck profiles store recorder-specific timing and capability fields: name, manufacturer, model, leader delay, motor latency, safety margin, default slack margin, optional auto recording level, Dolby NR, Type II support, Type IV support, and notes.

Cassette profiles store reusable cassette model fields: name, manufacturer, model, type, length, optional year, condition flags, leader offset, and slack override. Cassette profiles are model definitions only. Use the plus/minus controls under `Tapes you have` to add or remove the physical cassette copies you actually own.

When a plan uses multiple physical tapes, each tape can select an exact owned cassette model from the dropdown. The dropdown only offers models that match the selected tape length and available owned copies.

Use `Export profiles` / `Import profiles` for a single JSON profile bundle. Use `Export profile folder` / `Import profile folder` to keep all local config surfaces split into JSON files under `profiles/deck-profiles`, `profiles/cassette-profiles`, `profiles/playlist-profiles`, and `profiles/tape-collection`.

Recording Readiness has seven rows:

```text
Spotify   Token valid
Device    Spotify device selected or Dry Run active
Playlist  At least one track loaded
Tape      Inventory and plan are valid
Checklist All deck checklist items complete or skipped
API       No active rate limit or non-retryable API error
Ready     All rows above are green
```

Start Side A/B is disabled, and the click handler also blocks, unless every Recording Readiness row is green.

`Apply to Spotify` always asks for confirmation before changing the remote playlist order. `Export Backup` downloads the project JSON and does not continue with the Spotify reorder. Playlists above 100 tracks show an extra warning because Spotify receives the update in batches.

## Deck and Audio Setup

Use a clean line-level path from your Spotify playback device to the cassette deck.

```text
Spotify device / DAC / headphone output
        ↓
cassette deck LINE IN / AUX IN / REC IN
        ↓
deck monitor output / headphones / speakers
```

Before a real recording run:

- Select the exact Spotify output device you will record from.
- Set Spotify Streaming quality to Lossless if available, otherwise choose the highest available quality.
- Turn Auto-adjust quality, Crossfade, Normalize volume, Spotify EQ, and system sound enhancements off.
- Use the same output device in Spotify and your operating system mixer.
- Enable exclusive, fixed-volume, or direct hardware output for that device if available.
- Set system output volume to 100% / maximum.
- Adjust final recording level on the cassette deck input, not with OS mixer volume.
- Disable notification sounds before recording.
- Watch the deck meters and avoid clipping or distortion.
- The deck checklist gates Start Side A/B unless all items are checked or `Skip checklist` is active. The Spotify device row can be checked automatically when the app detects a selected or active Spotify device.
- If using `Leader Tape Delay`, the cue phase shows `Advancing past leader tape...` while the shared cue delay pipeline runs.
- The Level Check section has seven informational checkpoints: Spotify Lossless/highest quality, Crossfade 0 s, Normalize off, EQ off, system volume 100 %, deck in record-pause, and peaks clean/no clipping.
- The browser `Level Check` source can play 400 Hz, 1 kHz, or pink noise at `-12 dBFS`, `-6 dBFS`, or `0 dBFS`; it never auto-starts and must be stopped manually.

## Dry Run and Rate Limits

Dry Run simulates the recording flow without Spotify playback API calls. The cue countdown, leader/motor delays, side timers, flip prompt, and completion state still run at real speed. A visible DRY RUN banner and log show the playback commands that would have been sent.

Spotify Web API 429 responses are handled centrally. Outside recording, the app waits for `Retry-After` and retries once. During active recording, playback commands are buffered and replayed only if the same side is still active after the wait; the tape countdown is not interrupted.

## Regression Tests

Run the automated test suite:

```sh
npm test
```

Optional lightweight playback regression checks:

```sh
node scratch/test_playback.cjs
```

Run the project model / export-import regression checks:

```sh
node scratch/test_project_model.cjs
```

For manual checklists:

- [docs/j-card-print-regression.md](docs/j-card-print-regression.md)
- [docs/audio-setup-regression.md](docs/audio-setup-regression.md)

## Troubleshooting

- `ERR_CONNECTION_REFUSED` after Spotify login: start `npm run start:local` and reload the callback URL.
- `OAuth callback rejected`: start from `http://127.0.0.1:8787/` and connect again.
- `No active Spotify device found`: open Spotify on desktop/mobile, start playback once, then retry.
- Wrong target device: click `Refresh` under `Spotify device`, select the intended Spotify Connect device, then retry.
- Recording Readiness Tape row is red: add the missing cassette quantity under `Tapes you have`, choose a larger format, or adjust the plan so every side fits.
- Playback command sent but Spotify stays idle: wake the target Spotify device by playing any song, then retry or pause/resume the side.
- Rate limited: wait for the app's retry countdown in the Recording Readiness panel.
- Expired token: reconnect Spotify and refresh devices.
- Playlist list is empty: reconnect Spotify and ensure the token has `playlist-read-private`.
- Connect Spotify not visible on plain phone/LAN IP: this is by design. Open `http://127.0.0.1:8787` on the host machine, or use Tailscale Serve with the `https://...ts.net/callback` redirect URI registered in Spotify.
- Tailscale URL shows disconnected: tokens are per origin; connect Spotify again on the `https://...ts.net/` URL.

## Security

- Do not commit secrets.
- Do not commit Spotify access/refresh tokens.
- Do not commit GitHub tokens.
- Keep the app local unless you have reviewed the OAuth redirect URI and public-hosting implications.

## License

MIT. See [LICENSE](LICENSE).
