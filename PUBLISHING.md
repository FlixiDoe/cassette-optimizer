# Publishing Checklist

The repository is currently private and hosted deployment is disabled.

Do not make the repository public until this checklist is reviewed.

## Current State

- Repository visibility: private
- Public app/docs URLs: offline
- Local app URL: `http://127.0.0.1:8787/`
- Spotify redirect URI: `http://127.0.0.1:8787/callback`

## Before Making Public

1. Confirm there are no secrets in the repository:

```sh
rg -n "secret|token|ghp_|github_pat_|sk-|client_secret|refresh_token|access_token" .
```

2. Do not keep personal Spotify Client IDs in source. Users should create their own Spotify app and paste the Client ID locally.
3. Confirm `README.md` uses neutral cassette-workflow language and does not describe the project as a ripping tool.
4. Confirm `README.md` includes the responsible-use notice.
5. Confirm `LICENSE` is present.
6. Keep the app local-only unless a separate hosting plan is reviewed.
7. If hosting publicly in the future, add the final public callback URL to the Spotify Developer Dashboard.

## Manual Recording Setup Test

Before a release, confirm the recording guides and in-app checklist cover these manual audio setup items:

- README mentions Spotify Streaming quality set to Lossless.
- README mentions Auto-adjust quality off.
- README mentions Crossfade set to 0 seconds.
- README mentions Normalize volume off.
- README mentions Spotify EQ off.
- README mentions selecting the exact Spotify output device.
- README mentions exclusive, fixed-volume, or direct hardware output where available.
- README mentions operating system output device matching Spotify.
- README mentions system output volume at 100% / maximum.
- README explains that final recording gain is adjusted on the cassette deck input while watching deck meters for clipping or distortion.
- In-app Deck Checklist has compact confirmations for Spotify quality, output device, exclusive/fixed/direct output, and system volume.
- In-app Recording readiness panel shows Spotify connection, selected device, playback sync, Dry Run, and audio checklist state at a glance.
- In-app Level check helper explains that the app does not measure audio level automatically.
- README documents Export / Import Config for saving and restoring the full cassette project.

## Optional Public Repo Settings

- Add repository topics such as `spotify`, `cassette`, `mixtape`, `pkce`, `vanilla-js`.
- Keep Issues enabled only if you want external feedback.
- Consider disabling Wikis unless needed.
- Add a short repository description:

```text
Local Spotify playlist optimizer and cassette recording controller
```

## Do Not Publish

- Spotify client secrets
- Personal Spotify Client IDs
- GitHub tokens
- OAuth access tokens
- OAuth refresh tokens
- Browser local storage dumps
- Recordings or copied music files

## Local Use

Start the local server:

```sh
npm run start:local
```

Optional Python fallback:

```sh
python -m http.server 8787 --bind 127.0.0.1
```

Open:

```text
http://127.0.0.1:8787/
```

Keep the local server running while Spotify redirects back to the app. If the server is stopped, Spotify will show `ERR_CONNECTION_REFUSED` after login.

## Windows Portable Release Asset

Build the no-Node Windows portable ZIP from a clean checkout:

```powershell
npm run build:windows-portable -- -Version 1.2.2
```

Before uploading the ZIP to GitHub Releases:

- Extract it on Windows.
- Double-click `Cassette Optimizer.exe`.
- Confirm the browser opens `http://127.0.0.1:8787/`.
- Confirm `http://127.0.0.1:8787/api/health` returns JSON with `"ok": true`.
- Keep `dist/` out of git; upload the ZIP as a release asset instead.
