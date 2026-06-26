# J-Card Print Regression Checklist

Use this checklist before a release or after changing J-card markup, print CSS, tape planning, or per-tape format logic.

## Setup

- Open the app through `http://127.0.0.1:8787/`.
- Load a short playlist that fits on one cassette.
- Load or create a long playlist that requires multiple physical cassettes.
- For a multi-tape project, set at least two different tape formats, for example Tape 1 as `C90` and Tape 2 as `C60`.

## Checks

- `Print J-Card` opens the browser print dialog for the selected physical tape.
- `Print All J-Cards` includes one printable J-card page per physical tape.
- Chrome print preview shows one A4 landscape page for a normal one-tape playlist.
- Long playlists do not duplicate tracklist content across J-card panels.
- Fold and cut guide borders are visible in print preview.
- Grayscale output remains readable.
- Browser print-to-PDF completes without clipped core panels.
- Multi-tape projects print one J-card per tape.
- Mixed-format multi-tape projects print the correct `C` format on each J-card.
- Generated volume titles are visible for multi-tape projects, such as `Vol. 1` and `Vol. 2`.

## Notes

- Very long tracklists may require density classes to keep the inlay usable. If text overflows, capture the playlist size, selected format, and browser print settings before changing CSS.
- Browser print settings can affect scaling. Use default margins and 100% scale unless a release note says otherwise.
