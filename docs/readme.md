# Cassette Optimizer

A local-first Spotify playlist planner and playback controller for recording mixtapes to cassette. Cassette Optimizer keeps a Spotify playlist in order, plans it across one or more physical cassettes, shows a recording countdown, and controls Spotify playback so the user can record one side at a time.

For screenshots, see [screenshots](screenshots).

## Documentation

- [index.md](index.md) - documentation index.
- [setup.md](setup.md) - setup, first run, recording preparation, profiles, dry run, rate limits, and troubleshooting.
- [dev-guide.md](dev-guide.md) - regression test commands and manual checklist links.
- [code-overview.md](code-overview.md) - how the code is structured.
- [app-state-and-flow.md](app-state-and-flow.md) - how state moves through the app.
- [module-reference.md](module-reference.md) - file-by-file code reference.
- [ai-usage.md](ai-usage.md) - AI tools used for research, prompting, implementation, and repository maintenance.
- [changelog.md](changelog.md) - release notes and feature highlights.
- [todo.md](todo.md) - short-lived task list; currently no active implementation tasks.

## Responsible Use

This project is a cassette workflow tool, not a music ripping or redistribution tool.

> [!WARNING]
> You are responsible for complying with Spotify's terms, copyright law, and the rules that apply in your country. Do not use this project to bypass DRM, copy-protection, access controls, or licensing restrictions. Do not distribute recordings unless you have the rights to do so.
>
> For the safest use, record only music you own, created yourself, or are otherwise licensed to copy.

## What it does

- Loads Spotify playlists through OAuth PKCE.
- Plans tracks across one or more cassette tapes without cutting tracks.
- Supports deck profiles, cassette model profiles, exact per-tape cassette model selection, and owned tape inventory quantities.
- Blocks recording when inventory is short or a planned side is too long for its cassette format.
- Exports/imports cassette projects and profile folders as JSON.
- Restores the active project, selected playlist, selected Spotify device, and in-progress recording state after reload or browser close.
- Controls Spotify playback for Side A / Side B recording with preflight safety checks.
- Provides Dry Run mode with visible simulation logging, recording countdowns, deck readiness guidance, and optional LAN monitoring.
- Handles Spotify 429 rate limits with a Retry-After countdown and recording-safe playback command replay.
- Adds calibration helpers for leader tape delay, motor latency, safety margin, and browser-based level-check tones.
- Prints J-cards with title cleanup, manual print-only title overrides, and cover-derived theme colors.
- Supports explicit tape slack margin tolerance with warnings when unofficial tape length is used.

For setup and first run, see [setup.md](setup.md).

For regression tests and manual checklists, see [dev-guide.md](dev-guide.md).

## Security

- Do not commit secrets, Spotify access/refresh tokens, or GitHub tokens.
- Keep the app local unless you have reviewed the OAuth redirect URI and public-hosting implications.

## License

MIT. See [LICENSE](../LICENSE).
