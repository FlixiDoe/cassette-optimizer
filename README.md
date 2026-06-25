# Cassette Optimizer

Spotify playlist optimizer for cassette tape recording. The app runs as a single static HTML file with vanilla JavaScript and uses Spotify OAuth 2.0 PKCE, so no backend or client secret is needed.

Repository: https://github.com/FlixiDoe/cassette-optimizer
Status: private repository, GitHub Pages disabled
Spotify Client ID: `[REMOVED_SPOTIFY_CLIENT_ID]`

## Setup

1. Create or open a Spotify app in the Spotify Developer Dashboard.
2. Add this redirect URI:
   - `http://127.0.0.1:8787/callback`
3. Start a local static server from this folder:

```powershell
python -m http.server 8787 --bind 127.0.0.1
```

4. Open `http://127.0.0.1:8787`.
5. Confirm the prefilled Spotify Client ID and connect Spotify.

Do not open `index.html` via `file://` for Spotify login. PKCE redirects require the local HTTP URL above.
Keep the local server running until Spotify redirects back to `http://127.0.0.1:8787/callback`.

You can also start the local server with:

```powershell
.\start-local.ps1
```

## Usage

1. Open `http://127.0.0.1:8787`.
2. Click `Connect Spotify`.
3. Click `Refresh` in `Your Spotify playlists`.
4. Choose a playlist from the dropdown or paste a playlist URL/ID manually.
5. Check the cassette formats you actually have under `Tapes you have`.
6. Choose the tape format you want to plan for in `Tape format`.
7. Click `Load playlist`.
8. Review total runtime, recommended cassette format, Side A, and Side B.
9. Use `Apply to Spotify` only if you want to sync the calculated order back to Spotify.
10. Use Record Mode with `Start Side A` and `Start Side B` when recording.

## Spotify Scopes

- `playlist-read-private`
- `playlist-modify-private`
- `playlist-modify-public`
- `user-read-playback-state`
- `user-modify-playback-state`

## Features

- Accepts a Spotify playlist URL or ID.
- Lets the signed-in user refresh and choose from their Spotify playlists.
- Fetches all playlist tracks and `duration_ms` values.
- Supports common cassette lengths from C30 through C120.
- Lets you mark which cassette formats you have available.
- Shows total playlist length and recommends the smallest available cassette format that fits cleanly.
- Keeps original order and finds the best split point without cutting songs.
- Displays Side A and Side B tracklists with timestamps.
- Reorders the Spotify playlist with `PUT /v1/playlists/{id}/tracks`.
- Starts Side A and Side B playback with `PUT /v1/me/player/play`.
- Shows Record Mode state, Side countdown, current Spotify track, cassette fill, and auto-pauses at the end of Side A.
- Uses adaptive Spotify playback polling and respects rate-limit retry delays.
- Shows a flashing `FLIP THE CASSETTE!` banner.
- Explains how to fix no-active-device Spotify player errors.

## Cassette Logic

- The optimizer never cuts tracks.
- Track order is preserved.
- Side A is filled until the next full track would exceed half of the selected tape.
- Side B contains the remaining tracks.
- The recommendation checks only the cassette formats selected under `Tapes you have`.
- It recommends the smallest available format where the total runtime and Side B both fit cleanly.
- If total runtime fits a cassette but one side does not, the app warns that manual rebalancing would be needed.
- If the playlist exceeds the largest selected cassette, the app reports how much audio must be removed.

## Troubleshooting

- `ERR_CONNECTION_REFUSED` after Spotify login: start `.\start-local.ps1` and reload the callback URL. The local server must keep running during login.
- `OAuth callback rejected`: start from `http://127.0.0.1:8787` and connect again. Spotify auth codes are short-lived.
- `No active Spotify device found`: open Spotify on desktop/mobile, start playback once, then retry.
- `Connect Spotify` from `file://` will not work. Use `http://127.0.0.1:8787`.

## Docs

Project docs are in `docs.md`.

## GitHub Visibility

This repository is private and GitHub Pages is disabled. The app is intended to run locally at `http://127.0.0.1:8787`.
