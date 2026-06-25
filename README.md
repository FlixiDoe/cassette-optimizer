# Cassette Optimizer

A local-first Spotify playlist planner and playback controller for recording mixtapes to cassette.

Cassette Optimizer keeps a playlist in order, calculates the best Side A / Side B split for common cassette lengths, shows a recording countdown, and controls Spotify playback so the user can record one side at a time.

Repository: https://github.com/FlixiDoe/cassette-optimizer  
Current visibility: private  
GitHub Pages: disabled

## Responsible Use

This project is a cassette workflow tool, not a music ripping or redistribution tool.

You are responsible for complying with Spotify's terms, copyright law, and the rules that apply in your country. Do not use this project to bypass DRM, copy-protection, access controls, or licensing restrictions. Do not distribute recordings unless you have the rights to do so.

For the safest use, record only music you own, created yourself, or are otherwise licensed to copy.

## Features

- Single static HTML app, no backend and no build step.
- Spotify OAuth 2.0 PKCE flow with no client secret.
- Playlist input by Spotify URL/ID or account playlist picker.
- Fetches all playlist tracks and durations.
- Supports cassette formats from `C30` through `C120`.
- Lets you select which tape formats you physically have.
- Calculates Side A / Side B without cutting tracks.
- Keeps original track order.
- Shows total runtime, cassette recommendation, side fill, tracklists, timestamps, and warnings.
- Optional `Apply to Spotify` button to sync the calculated order back to the playlist.
- Spotify Connect device selector.
- Record Mode with Side A / Side B start, pause, resume, automatic side-end pause, flip cue, and finish-time estimate.
- Abort button to stop the current recording run and pause Spotify.
- Red `PRESS RECORD NOW` cue before playback starts.
- Automatic shuffle/repeat disable before fresh side starts.
- Conservative playback correction if Spotify jumps to an unexpected track.
- Optional LAN status server so another device can open the same UI and monitor the current state.
- Printable J-card cassette inlay from playlist title, cover, side tracks, and runtime.

## Local Setup

Create or open a Spotify app in the Spotify Developer Dashboard and add this redirect URI:

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

Do not use `file://` for Spotify login. OAuth PKCE requires the local HTTP origin, and the server must stay running until Spotify redirects back to `/callback`.

## LAN Status Mode

For monitoring from another device on the same network, use the optional Node server instead of the Python static server:

```powershell
.\start-lan.ps1
```

It serves the same app on all network interfaces and adds a small `/api/status` endpoint. The main browser posts safe status data only; Spotify tokens are not shared.

The server prints LAN URLs such as:

```text
http://192.168.x.x:8787/
```

Open that URL on your phone to see the same playback status. The phone does not start from `0:00`; it mirrors the last status posted by the main app.

Keep this LAN server on a trusted private network only. Do not expose it directly to the public internet.

## Spotify App Configuration

Create your own Spotify app and paste its Client ID into the app UI. The repository does not ship with a default Client ID.

The app does not use a Spotify client secret. Do not add Spotify Client IDs, client secrets, GitHub tokens, OAuth access tokens, or refresh tokens to the repository.

Required scopes:

- `playlist-read-private`
- `playlist-modify-private`
- `playlist-modify-public`
- `user-read-playback-state`
- `user-modify-playback-state`

## Usage

1. Open `http://127.0.0.1:8787/`.
2. Click `Connect Spotify`.
3. Click `Refresh` under `Your Spotify playlists`.
4. Choose a playlist from the dropdown or paste a playlist URL/ID.
5. Select the cassette formats you have under `Tapes you have`.
6. Choose a tape format.
7. Click `Load playlist`.
8. Review total runtime, recommendation, Side A, Side B, and warnings.
9. Optional: refresh Spotify devices and choose the target device.
10. Use `Apply to Spotify` only if you want to sync the order back to Spotify.
11. Click `Start Side A`.
12. When the red `PRESS RECORD NOW` cue appears, start recording on your deck.
13. Spotify starts automatically after the 5-second cue.
14. Wait for auto-pause, flip the cassette, then use `Start Side B`.

## Record Mode Notes

- Side starts are sent to Spotify as an explicit side queue.
- Fresh side starts disable shuffle and repeat first.
- The local record timer is authoritative for the side countdown.
- Spotify playback state is polled sparingly to avoid unnecessary API load.
- If Spotify jumps to a wrong track, the app attempts to correct playback to the track expected from the local recording time.
- The app shows the estimated local clock time when the current side will finish.
- `Abort Recording` pauses Spotify where possible, clears cue/timer/polling state, and returns the UI to idle.

## J-Card

After loading a playlist, use `Print J-Card` to print a cassette inlay. The J-card includes:

- Playlist name
- Playlist cover
- Selected tape format
- Total runtime
- Side A and Side B runtime
- Side A and Side B tracklists

## Regression Test

Run the lightweight playback regression checks:

```powershell
node scratch/test_playback.js
```

These checks validate the important playback-control code paths and UI state rules. They do not replace a real Spotify device test.

## Troubleshooting

- `ERR_CONNECTION_REFUSED` after Spotify login: start `.\start-local.ps1` and reload the callback URL.
- `OAuth callback rejected`: start from `http://127.0.0.1:8787/` and connect again.
- `No active Spotify device found`: open Spotify on desktop/mobile, start playback once, then retry.
- Wrong target device: click `Refresh` under `Spotify device`, select the intended Spotify Connect device, then retry.
- Playlist list is empty: reconnect Spotify and ensure the token has `playlist-read-private`.

## Security

- Do not commit secrets.
- Do not commit Spotify access/refresh tokens.
- Do not commit GitHub tokens.
- Keep the app local unless you have reviewed the OAuth redirect URI and public-hosting implications.

## License

MIT. See [LICENSE](LICENSE).
