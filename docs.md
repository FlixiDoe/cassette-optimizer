# Cassette Optimizer Documentation

This file is the documentation index. It intentionally avoids repeating the README and the code guides.

## Start here

- [README.md](README.md) — short project overview, responsible use, feature summary, and documentation links.
- [docs/setup.md](docs/setup.md) — setup, first run, recording preparation, profiles, dry run, rate limits, and troubleshooting.
- [docs/dev-guide.md](docs/dev-guide.md) — regression test commands and manual checklist links.
- [docs/streaming-services.md](docs/streaming-services.md) — streaming service support status and contributor requirements.
- [CHANGELOG.md](CHANGELOG.md) — release notes and feature highlights.
- [TODO.md](TODO.md) — short-lived active task list; currently empty except later ideas.

## Code documentation

These files explain how the code works internally:

- [docs/code-overview.md](docs/code-overview.md) — architecture, runtime shape, central state, project model, render pattern, and code ownership boundaries.
- [docs/app-state-and-flow.md](docs/app-state-and-flow.md) — startup flow, playlist loading, project creation, split recomputation, import/export, recording, timer, and Spotify monitoring flow.
- [docs/module-reference.md](docs/module-reference.md) — file-by-file reference for `src/`, `server/`, scripts, and support files.
- [docs/ai-usage.md](docs/ai-usage.md) — AI tools used for research, prompting, implementation, and repository maintenance.

## Manual regression checklists

- [docs/j-card-print-regression.md](docs/j-card-print-regression.md) — manual print layout checks.
- [docs/audio-setup-regression.md](docs/audio-setup-regression.md) — manual recording/audio setup wording checks.

## Documentation rule

Keep each topic in one place:

| Topic | Source |
| --- | --- |
| Project overview and responsible use | [README.md](README.md) |
| User setup, Spotify configuration, profiles, and troubleshooting | [docs/setup.md](docs/setup.md) |
| Developer regression tests | [docs/dev-guide.md](docs/dev-guide.md) |
| Streaming service support and roadmap | [docs/streaming-services.md](docs/streaming-services.md) |
| Release notes | [CHANGELOG.md](CHANGELOG.md) |
| Current active work | [TODO.md](TODO.md) |
| Code architecture | [docs/code-overview.md](docs/code-overview.md) |
| Runtime state and flow | [docs/app-state-and-flow.md](docs/app-state-and-flow.md) |
| Function/module reference | [docs/module-reference.md](docs/module-reference.md) |
| AI usage disclosure | [docs/ai-usage.md](docs/ai-usage.md) |
| Manual regression checklists | [docs/*.md](docs/) checklist files |

If a section starts repeating another file, replace it with a link instead of copying the same explanation again.

Every code or behavior change must update the relevant documentation in the same work item when the change affects user behavior, architecture, state flow, setup, safety, or maintenance expectations. Each completed change must be committed and pushed.
