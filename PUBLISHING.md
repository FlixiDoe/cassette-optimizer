# Publishing

This repository is ready for GitHub Pages.

## Public URLs

- App: https://flixidoe.github.io/cassette-optimizer/
- Docs: https://flixidoe.github.io/cassette-optimizer/docs/
- Spotify callback: https://flixidoe.github.io/cassette-optimizer/callback/

## Spotify Redirect URIs

Add these redirect URIs in the Spotify Developer Dashboard:

```text
https://flixidoe.github.io/cassette-optimizer/callback/
http://localhost:3000/callback/
```

The app computes the callback URL from the current origin, so the same `index.html` works on GitHub Pages and on a local `python -m http.server 3000` server.

## GitHub Pages

The workflow at `.github/workflows/pages.yml` deploys the repository root on every push to `main`. If Pages is not enabled yet, run:

```powershell
gh api repos/FlixiDoe/cassette-optimizer/pages -X POST -f build_type=workflow
```

If Pages already exists, this command can return an error; the workflow deployment is still the source of truth.
