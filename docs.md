# Cassette Optimizer Documentation

This file is the documentation index. It intentionally avoids repeating the README and the code guides.

## Start here

- [README.md](README.md) — short user setup, Spotify configuration, responsible use, and recording checklist.
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

```text
User setup and safe use      -> README.md
Current active work          -> TODO.md
Code architecture            -> docs/code-overview.md
Runtime state and flow       -> docs/app-state-and-flow.md
Function/module reference    -> docs/module-reference.md
AI usage disclosure          -> docs/ai-usage.md
Manual regression checklists -> docs/*.md checklist files
```

If a section starts repeating another file, replace it with a link instead of copying the same explanation again.
