# Developer Guide

This guide collects the regression commands and manual checklist links.

## Regression Tests

Run the automated test suite:

```sh
npm test
```

Optional lightweight playback regression checks:

```sh
node scratch/test_playback.cjs
```

Run the project model / export-import regression checks:

```sh
node scratch/test_project_model.cjs
```

For manual checklists:

- [docs/j-card-print-regression.md](docs/j-card-print-regression.md)
- [docs/audio-setup-regression.md](docs/audio-setup-regression.md)
