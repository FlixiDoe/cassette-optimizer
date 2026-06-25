# Publishing Checklist

The repository is currently private and GitHub Pages is disabled.

Do not make the repository public until this checklist is reviewed.

## Current State

- Repository visibility: private
- GitHub Pages: disabled
- Public app/docs URLs: offline
- Local app URL: `http://127.0.0.1:8787/`
- Spotify redirect URI: `http://127.0.0.1:8787/callback`

## Before Making Public

1. Confirm there are no secrets in the repository:

```powershell
rg -n "secret|token|ghp_|github_pat_|sk-|client_secret|refresh_token|access_token" .
```

2. Do not keep personal Spotify Client IDs in source. Users should create their own Spotify app and paste the Client ID locally.
3. Confirm `README.md` uses neutral cassette-workflow language and does not describe the project as a ripping tool.
4. Confirm `README.md` includes the responsible-use notice.
5. Confirm `LICENSE` is present.
6. Decide whether the app should remain local-only or support a hosted callback URL.
7. If hosting publicly, add the final public callback URL to the Spotify Developer Dashboard.
8. If enabling GitHub Pages, document the Pages URL and update OAuth setup instructions.

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

```powershell
.\start-local.ps1
```

Or:

```powershell
python -m http.server 8787 --bind 127.0.0.1
```

Open:

```text
http://127.0.0.1:8787/
```

Keep the local server running while Spotify redirects back to the app. If the server is stopped, Spotify will show `ERR_CONNECTION_REFUSED` after login.
