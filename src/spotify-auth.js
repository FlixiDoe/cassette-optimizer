export const SPOTIFY_SESSION_EXPIRED_MESSAGE = "Deine Sitzung ist abgelaufen. Bitte melde dich erneut an.";

const TOKEN_STORAGE_KEY = "spotify_token";
const DEVICE_STORAGE_KEY = "spotify_device_id";
const PKCE_VERIFIER_KEY = "pkce_verifier";
const OAUTH_STATE_KEY = "oauth_state";

export class SpotifyAccountsError extends Error {
  constructor(message, response, data) {
    super(message);
    this.name = "SpotifyAccountsError";
    this.status = response.status;
    this.errorCode = data?.error || "";
    this.data = data || null;
  }
}

export function isInvalidGrantError(error) {
  return error?.status === 400 && error?.errorCode === "invalid_grant";
}

export function buildTokenState(data, previousState = {}, { initialAuthorization = false, now = Date.now() } = {}) {
  return {
    token: data.access_token,
    refreshToken: data.refresh_token || previousState.refreshToken || null,
    expiresAt: now + (data.expires_in - 60) * 1000,
    authorizedAt: initialAuthorization ? now : previousState.authorizedAt || now
  };
}

export function clearSpotifyAuthStorage(localStorage, sessionStorage) {
  localStorage.removeItem(TOKEN_STORAGE_KEY);
  localStorage.removeItem(DEVICE_STORAGE_KEY);
  sessionStorage.removeItem(PKCE_VERIFIER_KEY);
  sessionStorage.removeItem(OAUTH_STATE_KEY);
}

export function expireSpotifySession({ state, localStorage, sessionStorage, redirectToLogin } = {}) {
  if (state) {
    state.token = null;
    state.refreshToken = null;
    state.expiresAt = 0;
    state.authorizedAt = null;
  }
  clearSpotifyAuthStorage(localStorage, sessionStorage);
  if (redirectToLogin) redirectToLogin();
  return SPOTIFY_SESSION_EXPIRED_MESSAGE;
}
