# Cassette Optimizer Documentation

This file is the documentation index. It intentionally avoids repeating the README and the code guides.

## Start here

- [readme.md](readme.md) — short project overview, responsible use, feature summary, and documentation links.
- [setup.md](setup.md) — setup, first run, recording preparation, profiles, dry run, rate limits, and troubleshooting.
- [dev-guide.md](dev-guide.md) — regression test commands and manual checklist links.
- [streaming-services.md](streaming-services.md) — streaming service support status and contributor requirements.
- [changelog.md](changelog.md) — release notes and feature highlights.
- [todo.md](todo.md) — short-lived active task list; currently empty except later ideas.

## Code documentation

These files explain how the code works internally:

- [code-overview.md](code-overview.md) — architecture, runtime shape, central state, project model, render pattern, and code ownership boundaries.
- [app-state-and-flow.md](app-state-and-flow.md) — startup flow, playlist loading, project creation, split recomputation, import/export, recording, timer, and Spotify monitoring flow.
- [module-reference.md](module-reference.md) — file-by-file reference for `src/`, `server`, scripts, and support files.
- [ai-usage.md](ai-usage.md) — AI tools used for research, prompting, implementation, and repository maintenance.

## Manual regression checklists

- [j-card-print-regression.md](j-card-print-regression.md) — manual print layout checks.
- [audio-setup-regression.md](audio-setup-regression.md) — manual recording/audio setup wording checks.

## Documentation rule

Keep each topic in one place:

| Topic | Source |
| --- | --- |
| Project overview and responsible use | [readme.md](readme.md) |
| User setup, Spotify configuration, profiles, and troubleshooting | [setup.md](setup.md) |
| Developer regression tests | [dev-guide.md](dev-guide.md) |
| Streaming service support and roadmap | [streaming-services.md](streaming-services.md) |
| Release notes | [changelog.md](changelog.md) |
| Current active work | [todo.md](todo.md) |
| Code architecture | [code-overview.md](code-overview.md) |
| Runtime state and flow | [app-state-and-flow.md](app-state-and-flow.md) |
| Function/module reference | [module-reference.md](module-reference.md) |
| AI usage disclosure | [ai-usage.md](ai-usage.md) |
| Manual regression checklists | [*.md](.) checklist files |

If a section starts repeating another file, replace it with a link instead of copying the same explanation again.

Every code or behavior change must update the relevant documentation in the same work item when the change affects user behavior, architecture, state flow, setup, safety, or maintenance expectations. Each completed change must be committed and pushed.
