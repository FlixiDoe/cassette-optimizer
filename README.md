# Cassette Optimizer

Spotify playlist optimizer for cassette tape recording. The app runs as a single static HTML file with vanilla JavaScript and uses Spotify OAuth 2.0 PKCE, so no backend or client secret is needed.

## Setup

1. Create a Spotify app in the Spotify Developer Dashboard.
2. Add `http://localhost:3000/callback` as a redirect URI.
3. Start a local static server from this folder:

```powershell
python -m http.server 3000
```

4. Open `http://localhost:3000`.
5. Paste your Spotify Client ID into the app and connect Spotify.

## Spotify Scopes

- `playlist-read-private`
- `playlist-modify-private`
- `playlist-modify-public`
- `user-read-playback-state`
- `user-modify-playback-state`

## Features

- Accepts a Spotify playlist URL or ID.
- Fetches all playlist tracks and `duration_ms` values.
- Supports C60 and C90 tape lengths.
- Keeps original order and finds the best split point without cutting songs.
- Displays Side A and Side B tracklists with timestamps.
- Reorders the Spotify playlist with `PUT /v1/playlists/{id}/tracks`.
- Starts Side A and Side B playback with `PUT /v1/me/player/play`.
- Shows Side A countdown, current Spotify track, cassette fill, and auto-pauses at the end of Side A.
- Shows a flashing `FLIP THE CASSETTE!` banner.
- Explains how to fix no-active-device Spotify player errors.

## Dynamic Docs

The live docs are at `docs/index.html`. They read `docs/changelog.json`, render a progress bar and timeline, and refresh every 30 seconds.

## GitHub Publishing

The requested GitHub repository creation and push require a real GitHub token. With a token, create the repo:

```powershell
$headers = @{ Authorization = "Bearer YOUR_GITHUB_TOKEN"; Accept = "application/vnd.github+json" }
$body = @{ name = "cassette-optimizer"; description = "Spotify playlist optimizer for cassette tape recording"; private = $false } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "https://api.github.com/user/repos" -Headers $headers -Body $body -ContentType "application/json"
git remote add origin https://github.com/YOUR_USERNAME/cassette-optimizer.git
git push -u origin main
```
