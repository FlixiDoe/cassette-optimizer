# Cassette Optimizer Docs

Private local web app for optimizing Spotify playlists for cassette recording.

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
7. Review total runtime, tape recommendation, Side A, and Side B.
8. Use `Apply to Spotify` only when you want to sync the order to Spotify.
9. Use `Start Side A`, wait for auto-pause, flip the cassette, then use `Start Side B`.

## Supported Tape Formats

`C30`, `C46`, `C50`, `C54`, `C60`, `C64`, `C70`, `C74`, `C80`, `C90`, `C100`, `C110`, `C120`

## Cassette Logic

- Tracks are never cut.
- Original playlist order is preserved.
- Side A is filled until the next full track would exceed half of the selected tape.
- Side B contains the remaining tracks.
- Recommendations only use cassette formats selected under `Tapes you have`.
- The app recommends the smallest available format where total runtime and Side B fit cleanly.
- If total runtime fits but one side does not, the app warns that manual rebalancing would be needed.
- If the playlist exceeds the largest selected tape, the app reports how much audio must be removed.

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
- Playlist list is empty: reconnect Spotify and ensure the token has `playlist-read-private`.

## Repository State

- Repository: `https://github.com/FlixiDoe/cassette-optimizer`
- Visibility: private
- GitHub Pages: disabled
