# Streaming Service Support

Cassette Optimizer currently supports Spotify only. This document explains
the realistic status of other services and what would be needed to add them.

## Spotify

Fully supported. PKCE OAuth, no backend required. Playlist loading, playback
control, progress polling, and device management all use the Spotify Web API.

## Tidal

Tidal has an official developer API (developer.tidal.com) with OAuth 2.0 and
playlist endpoints. Playlist import is technically feasible.

Playback control is not feasible. Tidal has no Web Playback SDK equivalent,
so the recording session features (pause, resume, current-track polling, flip
prompt) could not be driven via the API. Without playback control, Cassette
Optimizer loses its main value over a manual approach.

Status: blocked on playback control. A contributor with an active Tidal
account and API access who can clarify whether any playback API exists would
be needed before this can be scoped properly. Open a GitHub issue if that
is you.

## YouTube Music

There is no official public API for YouTube Music playlists. The YouTube Data
API v3 covers YouTube videos only, not Music-specific library access. Existing
third-party approaches rely on reverse-engineered internal endpoints, which
carry Terms of Service risk and break without notice.

Status: not realistically implementable without a stable official API.
Removed from active roadmap. If Google releases a public YouTube Music API,
this assessment should be revisited.

## Apple Music

Apple provides MusicKit JS, an official browser-side SDK that can load
playlists and control playback. The OAuth-equivalent flow requires a
MusicKit developer token generated via an Apple Developer account. The
setup burden for the user is similar to the current Spotify Client ID step.

Playback control via MusicKit JS is documented and covers the operations
Cassette Optimizer needs: play, pause, next track, and current track state.

Status: technically feasible. Blocked on a contributor who uses Apple Music
and holds an Apple Developer account to implement and test the MusicKit JS
integration. The maintainer does not own Apple devices. Open a GitHub issue
if that is you.
