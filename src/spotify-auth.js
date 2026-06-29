/**
 * Provides Spotify Accounts helpers shared by the main browser application.
 *
 * This module keeps the token-state rules, auth-storage cleanup, and terminal
 * refresh-token failure handling outside `app.js` so the UI layer can call one
 * small API when Spotify Accounts rejects a session. It intentionally accepts
 * `localStorage` and `sessionStorage` as parameters for cleanup functions so
 * tests and callers can supply the browser storage objects without importing
 * global state here.
 */
export const SPOTIFY_SESSION_EXPIRED_MESSAGE = "Session expired. Please reconnect Spotify.";

// `spotify_token` stores the access token, refresh token, expiry timestamp, and original authorization timestamp.
const TOKEN_STORAGE_KEY = "spotify_token";
// `spotify_device_id` stores the preferred Spotify Connect device and must be removed when auth is no longer valid.
const DEVICE_STORAGE_KEY = "spotify_device_id";
// `pkce_verifier` stores the one-time PKCE verifier between the authorize redirect and callback exchange.
const PKCE_VERIFIER_KEY = "pkce_verifier";
// `oauth_state` stores the one-time CSRF token that must match the callback `state` query parameter.
const OAUTH_STATE_KEY = "oauth_state";

/**
 * Represents an error returned by the Spotify Accounts token endpoint.
 *
 * It wraps a failed `POST https://accounts.spotify.com/api/token` response and
 * preserves both the HTTP status and Spotify `error` code so callers can
 * distinguish recoverable refresh failures from the terminal `invalid_grant`
 * case. The raw parsed response body is kept for diagnostics.
 *
 * @param {string} message - Human-readable Spotify error description or fallback message.
 * @param {Response} response - Failed fetch response from the Spotify Accounts API.
 * @param {object|null} data - Parsed JSON response body, including `error` and `error_description` when Spotify provides them.
 * @returns {SpotifyAccountsError} Error instance with `status`, `errorCode`, and `data` fields.
 * @throws {Error} Does not throw directly; construction is used at the token exchange throw site in `app.js`.
 *
 * Side effects: Sets error metadata fields on the constructed instance.
 */
export class SpotifyAccountsError extends Error {
  constructor(message, response, data) {
    super(message);
    // The custom name lets logs and tests identify Spotify Accounts failures without relying on message text.
    this.name = "SpotifyAccountsError";
    // The HTTP status is required because Spotify uses 400 for terminal refresh-token failures.
    this.status = response.status;
    // `invalid_grant` means the authorization code or refresh token can no longer be used.
    this.errorCode = data?.error || "";
    // Preserve the full parsed body so callers can inspect Spotify-specific fields if needed.
    this.data = data || null;
  }
}

/**
 * Detects the terminal Spotify refresh-token failure.
 *
 * Spotify returns HTTP 400 with `error: "invalid_grant"` when a refresh token is
 * no longer usable, including expired, revoked, or already-consumed grants. The
 * app treats this as a hard session expiry because retrying the same refresh
 * token cannot recover.
 *
 * @param {unknown} error - Error thrown by `fetchAccounts` or another token helper.
 * @returns {boolean} `true` when the error is a Spotify Accounts invalid-grant response.
 * @throws {Error} Does not throw; optional chaining makes non-object values safe.
 *
 * Side effects: None.
 */
export function isInvalidGrantError(error) {
  // Spotify Accounts reports refresh-token expiry as a 400, not a 401 from the Web API.
  return error?.status === 400 && error?.errorCode === "invalid_grant";
}

/**
 * Builds the token fields stored in application state and `localStorage`.
 *
 * The initial authorization code exchange receives both an access token and a
 * refresh token, while later refreshes may omit `refresh_token`. This helper
 * preserves the previous refresh token and original `authorizedAt` value across
 * refreshes, subtracts a 60-second safety window from `expires_in`, and returns
 * only the token-related state that `app.js` should merge into its larger state
 * object.
 *
 * @param {object} data - Parsed Spotify Accounts token response.
 * @param {string} data.access_token - Bearer token for `https://api.spotify.com/v1` requests.
 * @param {string} [data.refresh_token] - Long-lived refresh token returned on initial authorization and sometimes on refresh.
 * @param {number} data.expires_in - Access-token lifetime in seconds from Spotify.
 * @param {object} [previousState={}] - Existing app state used to preserve refresh token and original authorization time.
 * @param {string|null} [previousState.refreshToken] - Previously stored refresh token.
 * @param {number|null} [previousState.authorizedAt] - Timestamp from the original successful authorization.
 * @param {object} [options={}] - Token construction options.
 * @param {boolean} [options.initialAuthorization=false] - Whether this token response came from the authorization-code exchange.
 * @param {number} [options.now=Date.now()] - Timestamp used for expiry and authorization calculations.
 * @returns {{token: string, refreshToken: string|null, expiresAt: number, authorizedAt: number}} Token state to merge into the app state.
 * @throws {Error} Does not throw directly; callers must validate Spotify response shape if stricter guarantees are needed.
 *
 * Side effects: None; callers persist the returned object separately.
 */
export function buildTokenState(data, previousState = {}, { initialAuthorization = false, now = Date.now() } = {}) {
  return {
    // `access_token` is the short-lived bearer token used for Spotify Web API calls.
    token: data.access_token,
    // Spotify may omit `refresh_token` during refresh; keep the existing one so the session remains renewable.
    refreshToken: data.refresh_token || previousState.refreshToken || null,
    // Refresh one minute early so a token does not expire mid-request or during recording startup.
    expiresAt: now + (data.expires_in - 60) * 1000,
    // `authorizedAt` records the original login time and is preserved across refreshes for session-age diagnostics.
    authorizedAt: initialAuthorization ? now : previousState.authorizedAt || now
  };
}

/**
 * Clears all browser storage keys tied to Spotify authentication.
 *
 * The app removes the durable token first so no future page load can restore an
 * invalid bearer or refresh token, then removes the selected device because
 * device IDs are only useful inside an authenticated Spotify session. Finally,
 * it removes transient PKCE verifier and OAuth state values from session
 * storage so an old callback cannot be exchanged after logout or expiry.
 *
 * @param {Storage} localStorage - Browser localStorage object containing durable Spotify auth keys.
 * @param {Storage} sessionStorage - Browser sessionStorage object containing transient PKCE keys.
 * @returns {void}
 * @throws {DOMException} May throw if browser storage access is blocked or unavailable.
 *
 * Side effects: Deletes `spotify_token`, `spotify_device_id`, `pkce_verifier`, and `oauth_state`.
 */
export function clearSpotifyAuthStorage(localStorage, sessionStorage) {
  // Delete `spotify_token` first so an interrupted cleanup cannot restore an invalid refresh token on reload.
  localStorage.removeItem(TOKEN_STORAGE_KEY);
  // Delete `spotify_device_id` because the selected device belongs to the expired Spotify session.
  localStorage.removeItem(DEVICE_STORAGE_KEY);
  // Delete `pkce_verifier` so a stale authorization code cannot be exchanged after logout or expiry.
  sessionStorage.removeItem(PKCE_VERIFIER_KEY);
  // Delete `oauth_state` so the next PKCE login must generate a fresh CSRF token.
  sessionStorage.removeItem(OAUTH_STATE_KEY);
}

/**
 * Expires the in-memory and persisted Spotify session after a terminal auth error.
 *
 * This function is used when `invalid_grant` proves the refresh token can no
 * longer produce access tokens. It clears all token fields on the provided app
 * state, removes auth-related storage through `clearSpotifyAuthStorage`, and
 * optionally invokes a redirect callback that starts PKCE login again. The
 * returned German message is shown to the user by `app.js`.
 *
 * @param {object} [options={}] - Expiry options.
 * @param {object} [options.state] - Mutable app state object whose token fields should be cleared.
 * @param {Storage} [options.localStorage] - Browser localStorage object for durable auth cleanup.
 * @param {Storage} [options.sessionStorage] - Browser sessionStorage object for PKCE cleanup.
 * @param {Function} [options.redirectToLogin] - Optional callback that starts the PKCE re-login flow.
 * @returns {string} User-facing session-expired message.
 * @throws {DOMException} May throw if browser storage cleanup fails.
 *
 * Side effects: Mutates `state`, deletes local/session storage keys, and may call `redirectToLogin`.
 */
export function expireSpotifySession({ state, localStorage, sessionStorage, redirectToLogin } = {}) {
  if (state) {
    // Clear the bearer token immediately so Web API calls stop before a re-login succeeds.
    state.token = null;
    // Clear the refresh token because `invalid_grant` means retrying it cannot recover the session.
    state.refreshToken = null;
    // Reset expiry to epoch so state no longer appears renewable.
    state.expiresAt = 0;
    // Drop the original authorization timestamp because the user must complete a new authorization.
    state.authorizedAt = null;
  }
  // Remove persistent and PKCE storage in the same order used by explicit logout.
  clearSpotifyAuthStorage(localStorage, sessionStorage);
  // When supplied, the redirect callback starts PKCE and shows the Spotify authorization screen to the user.
  if (redirectToLogin) redirectToLogin();
  return SPOTIFY_SESSION_EXPIRED_MESSAGE;
}
