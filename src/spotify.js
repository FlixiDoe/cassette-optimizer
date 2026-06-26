export class SpotifyApiError extends Error {
  constructor(message, response, data) {
    super(message);
    this.name = "SpotifyApiError";
    this.status = response.status;
    this.retryAfter = Number(response.headers.get("Retry-After") || 0);
    this.data = data;
  }
}

export function parsePlaylistId(value) {
  if (!value) return "";
  const match = value.match(/playlist[/:]([A-Za-z0-9]+)/) || value.match(/^([A-Za-z0-9]{20,})/);
  return match ? match[1] : "";
}

export function pickPlaylistCover(images) {
  return [...images].sort((a, b) => (b.width || 0) - (a.width || 0))[0]?.url || "";
}

export function randomBytes(length) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

export async function sha256Base64Url(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return base64Url(new Uint8Array(digest));
}

export function base64Url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
