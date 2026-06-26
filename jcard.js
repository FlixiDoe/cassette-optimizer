import { formatLongTime, formatTime } from "./tape.js";

export function renderJCardMarkup({ title, coverHtml, tapeMinutes, tracks, sideA, sideB, sideAMs, sideBMs, totalMs, splitIndex, escapeHtml }) {
  const densityClass = getJCardDensityClass(sideA.length + sideB.length);
  const html = `
        <section class="j-panel j-spine" aria-label="J-Card spine">
          <span class="j-panel-label">Spine</span>
          <span class="j-spine-title">${escapeHtml(title)}</span>
          <span class="j-spine-format">C${tapeMinutes}</span>
        </section>
        <section class="j-panel j-front" aria-label="J-Card front cover">
          <span class="j-panel-label">Front</span>
          <div class="j-title">${escapeHtml(title)}</div>
          <div class="j-cover-art">${coverHtml}</div>
          <div class="j-meta">
            <span>Total: ${formatLongTime(totalMs)}</span>
            <span>Side A: ${formatLongTime(sideAMs)}</span>
            <span>Side B: ${formatLongTime(sideBMs)}</span>
            <span>${tracks.length} tracks - C${tapeMinutes}</span>
          </div>
        </section>
        <section class="j-panel j-back" aria-label="J-Card back cover tracklist">
          <span class="j-panel-label">Back</span>
          ${renderJCardSide("Side A", sideA, sideAMs, 0, escapeHtml)}
          ${renderJCardSide("Side B", sideB, sideBMs, splitIndex, escapeHtml)}
        </section>
      `;
  return { html, densityClass };
}

export function getJCardDensityClass(trackCount) {
  if (trackCount > 56) return " dense";
  if (trackCount > 36) return " compact";
  return "";
}

function renderJCardSide(label, tracks, totalMs, offset, escapeHtml) {
  if (!tracks.length) {
    return `<div class="j-side"><h3>${label} - ${formatLongTime(totalMs)}</h3><p class="j-empty">Load a playlist to fill this side.</p></div>`;
  }
  const items = tracks.map(track => `
        <li>
          <div class="j-track-line">
            <span>${escapeHtml(track.name)}</span>
            <span>${formatTime(track.duration_ms)}</span>
          </div>
        </li>
      `).join("");
  return `<div class="j-side"><h3>${label} - ${formatLongTime(totalMs)} - ${offset + 1}-${offset + tracks.length}</h3><ol>${items}</ol></div>`;
}
