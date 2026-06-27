import assert from "node:assert/strict";
import test from "node:test";

import {
  SpotifyAccountsError,
  buildTokenState,
  expireSpotifySession,
  isInvalidGrantError
} from "../src/spotify-auth.js";

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    }
  };
}

test("Spotify Accounts invalid_grant errors are classified as terminal auth failures", () => {
  const error = new SpotifyAccountsError("Refresh token expired", { status: 400 }, {
    error: "invalid_grant",
    error_description: "Refresh token expired"
  });

  assert.equal(isInvalidGrantError(error), true);
  assert.equal(error.status, 400);
  assert.equal(error.errorCode, "invalid_grant");
});

test("token state records original authorization time and preserves it across refreshes", () => {
  const authorized = buildTokenState({
    access_token: "access-1",
    refresh_token: "refresh-1",
    expires_in: 3600
  }, {}, { initialAuthorization: true, now: 1000 });

  const refreshed = buildTokenState({
    access_token: "access-2",
    expires_in: 3600
  }, authorized, { now: 2000 });

  assert.equal(authorized.authorizedAt, 1000);
  assert.equal(refreshed.authorizedAt, 1000);
  assert.equal(refreshed.refreshToken, "refresh-1");
});

test("expired Spotify sessions clear tokens, auth session data, device state, and redirect to login", () => {
  const localStorage = memoryStorage({
    spotify_token: JSON.stringify({ token: "access", refreshToken: "refresh", expiresAt: 1 }),
    spotify_device_id: "device-1",
    spotify_client_id: "client-id"
  });
  const sessionStorage = memoryStorage({
    pkce_verifier: "verifier",
    oauth_state: "state"
  });
  const state = {
    token: "access",
    refreshToken: "refresh",
    expiresAt: 1,
    authorizedAt: 1000
  };
  let redirectCount = 0;

  const message = expireSpotifySession({
    state,
    localStorage,
    sessionStorage,
    redirectToLogin: () => {
      redirectCount += 1;
    }
  });

  assert.equal(message, "Deine Sitzung ist abgelaufen. Bitte melde dich erneut an.");
  assert.equal(state.token, null);
  assert.equal(state.refreshToken, null);
  assert.equal(state.expiresAt, 0);
  assert.equal(state.authorizedAt, null);
  assert.equal(localStorage.getItem("spotify_token"), null);
  assert.equal(localStorage.getItem("spotify_device_id"), null);
  assert.equal(localStorage.getItem("spotify_client_id"), "client-id");
  assert.equal(sessionStorage.getItem("pkce_verifier"), null);
  assert.equal(sessionStorage.getItem("oauth_state"), null);
  assert.equal(redirectCount, 1);
});
