# Developer Guide

This guide collects the regression commands and manual checklist links.

## Regression Tests

Run the automated test suite:

```sh
npm test
```

Run the standalone migration, export/import, preflight and playback checks from the repository root with the same Node.js installation.

```sh
node scratch/test_config_migration.cjs
node scratch/test_project_model.cjs
node scratch/test_recording_preflight.cjs
node scratch/test_playback.cjs
```

For an import change, try a track-only file whose tracks cross a side boundary. Select the final tape, reload the page and check that the same tape and tracks are still selected. Use Dry Run to check the A-to-B flip without controlling Spotify.

For manual checklists:

- [j-card-print-regression.md](j-card-print-regression.md)
- [audio-setup-regression.md](audio-setup-regression.md)
