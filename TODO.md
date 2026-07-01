# Cassette Optimizer TODO

No active implementation TODOs remain in this short-lived task list.

The P0-P3 work items previously tracked here were completed, tested, committed, and pushed on 2026-06-26.

## Later Ideas

- Add custom notes/spine comment fields (`spineNote`) for tape formulations.
- Add printable outer cassette shell stickers.
- Add local project history and automated session recovery.
- Add a Smart Gap-Filler routine for significant trailing silence.
- Add configurable inter-track silence gap for AMS (Automatic Music Search) systems. A user-defined gap duration (seconds) should be inserted between tracks during recording by pausing playback, waiting, then resuming. Gap duration must also be factored into tape planning so split points and side lengths remain accurate. Polling jitter of 1–2 s is acceptable; AMS systems typically need 3+ seconds of silence. Crossfade must be 0 s (already recommended in setup).

## Streaming Service Roadmap

- [ ] YouTube Music support — needs contributor with API access and active account
- [ ] Tidal support — needs contributor with API access and active account
- [ ] Apple Music / MusicKit JS support — needs contributor with Apple Developer account
