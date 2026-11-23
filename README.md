# Cassette Optimizer

Plan a playlist across both sides of one or more cassettes, then use the recording controls to cue each side. The app keeps songs in order and leaves each track intact.

## Run locally

From the repository root, use Node.js 18 or newer and npm.

```sh
npm start
```

Open [the local app](http://127.0.0.1:8787/) and keep the server running while you use it. For an offline rehearsal, import a cassette project, add a matching cassette to your inventory, complete or skip the deck checklist, and enable **Dry Run**. The cue, flip prompt and timers work without a Spotify login. For real playback, configure the Spotify Client ID, callback URL and target device as described in the [setup guide](docs/setup.md).

## Check a change

```sh
npm test
```

The [developer guide](docs/dev-guide.md) covers the standalone regression scripts and the manual audio and print checks. The [project overview](docs/readme.md) explains the features and intended use.
