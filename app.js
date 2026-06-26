    import { TAPE_CONFIG_VERSION } from "./export.js";
    import { renderJCardMarkup } from "./jcard.js";
    import { RECORD_CUE_SECONDS, getExpectedTrackAtElapsed } from "./recording.js";
    import { SpotifyApiError, base64Url, parsePlaylistId, pickPlaylistCover, randomBytes, sha256Base64Url } from "./spotify.js";
    import { TAPE_FORMATS, analyzeTapeFitForTracks, duration, formatLongTime, formatTime, splitTracksForSide } from "./tape.js";

    const DEFAULT_SPOTIFY_CLIENT_ID = "";
    const APP_BASE_URL = getAppBaseUrl();
    const REDIRECT_URI = `${APP_BASE_URL}callback`;
    const REQUIRED_SCOPES = [
      "playlist-read-private",
      "playlist-modify-private",
      "playlist-modify-public",
      "user-read-playback-state",
      "user-modify-playback-state"
    ];
    const DECK_CHECKLIST_ITEMS = [
      "Tape inserted",
      "Rewound to start of side",
      "Correct side selected",
      "Record level checked",
      "Spotify device selected",
      "Notifications muted",
      "Deck is in record/pause"
    ];
    const state = {
      token: null,
      refreshToken: null,
      expiresAt: 0,
      playlistId: "",
      playlistName: "",
      playlistCoverUrl: "",
      tracks: [],
      playlists: [],
      devices: [],
      selectedDeviceId: localStorage.getItem("spotify_device_id") || "",
      tapeMinutes: 90,
      availableTapeFormats: [60, 90],
      splitIndex: 0,
      sideAStartedAt: 0,
      sideAElapsedBeforePause: 0,
      spotifySideElapsedMs: 0,
      lastSideProgressMs: 0,
      lastProgressUpdatedAt: 0,
      recordMode: "idle",
      activeRecordSide: null,
      autoPauseDone: false,
      timerId: null,
      cueTimerId: null,
      pollingId: null,
      pollingDelayMs: 5000,
      pollingPausedUntil: 0,
      lastRateLimitLogAt: 0,
      lastPlaybackCorrectionAt: 0,
      lastStatusPushAt: 0,
      statusPollId: null,
      statusApiAvailable: false,
      deckChecklistDone: [],
      skipDeckChecklist: false,
      dryRun: false,
      calibration: {
        leadInSeconds: 0,
        motorLatencySeconds: 0,
        safetyMarginSeconds: 0
      }
    };
    state.configVersion = TAPE_CONFIG_VERSION;

    const el = Object.fromEntries([...document.querySelectorAll("[id]")].map(node => [node.id, node]));

    init();

    function init() {
      el.clientId.value = localStorage.getItem("spotify_client_id") || DEFAULT_SPOTIFY_CLIENT_ID;
      restoreClientSecretPreference();
      applyHostMode();
      restoreToken();
      handleCallback();
      bindEvents();
      renderAuth();
      renderSplit();
      renderRecordMode();
      warnIfFileProtocol();
    }

    function isLocalhost() {
      return location.hostname === "127.0.0.1" || location.hostname === "localhost";
    }

    function applyHostMode() {
      if (isLocalhost()) return;
      // Spotify OAuth only allows loopback (127.0.0.1) as redirect URI.
      // On LAN IPs, hide all login/credential controls — device is monitor-only.
      el.credentialsPanel.hidden = true;
      el.authControls.hidden = true;
      el.playlistPickerPanel.hidden = true;
      el.lanNotice.hidden = false;
    }

    function bindEvents() {
      el.clientId.addEventListener("change", () => localStorage.setItem("spotify_client_id", el.clientId.value.trim()));
      el.clientSecret.addEventListener("change", persistClientSecretIfEnabled);
      el.saveClientSecret.addEventListener("change", updateClientSecretStorage);
      el.connectBtn.addEventListener("click", login);
      el.logoutBtn.addEventListener("click", logout);
      el.loadBtn.addEventListener("click", loadPlaylist);
      el.loadPlaylistsBtn.addEventListener("click", loadUserPlaylists);
      el.playlistSelect.addEventListener("change", selectUserPlaylist);
      el.loadDevicesBtn.addEventListener("click", loadDevices);
      el.deviceSelect.addEventListener("change", selectDevice);
      el.applyBtn.addEventListener("click", applyToSpotify);
      el.startA.addEventListener("click", startSideA);
      el.startB.addEventListener("click", startSideB);
      el.pauseBtn.addEventListener("click", pausePlayback);
      el.abortBtn.addEventListener("click", abortRecording);
      el.printJCardBtn.addEventListener("click", () => window.print());
      el.tapeSelect.addEventListener("change", () => setTapeLength(Number(el.tapeSelect.value)));
      el.tapeInventory.addEventListener("change", updateAvailableTapeFormats);
      el.deckChecklist.addEventListener("change", updateDeckChecklist);
      el.skipDeckChecklist.addEventListener("change", updateDeckChecklist);
      el.dryRunToggle.addEventListener("change", updateDryRun);
      el.leadInDelay.addEventListener("change", updateCalibration);
      el.leadInDelay.addEventListener("input", updateCalibration);
      el.motorLatency.addEventListener("change", updateCalibration);
      el.motorLatency.addEventListener("input", updateCalibration);
      el.safetyMargin.addEventListener("change", updateCalibration);
      el.safetyMargin.addEventListener("input", updateCalibration);
      window.addEventListener("beforeunload", persistToken);
      startSharedStatusPolling();
      restoreTapeInventory();
      restoreDeckChecklist();
      restoreDryRun();
      restoreCalibration();
      renderTapeOptions();
      renderTapeInventory();
      renderDeckChecklist();
      renderDryRun();
      renderCalibration();
    }

    async function login() {
      const clientId = getClientId();
      if (location.protocol === "file:") {
        log("Open http://127.0.0.1:8787 instead. Spotify OAuth cannot complete from a file:// page.");
        return;
      }
      if (!clientId) return log("Add your Spotify Client ID first.");
      const verifier = base64Url(randomBytes(64));
      const challenge = await sha256Base64Url(verifier);
      const oauthState = base64Url(randomBytes(18));
      sessionStorage.setItem("pkce_verifier", verifier);
      sessionStorage.setItem("oauth_state", oauthState);
      localStorage.setItem("spotify_client_id", clientId);

      const params = new URLSearchParams({
        response_type: "code",
        client_id: clientId,
        scope: REQUIRED_SCOPES.join(" "),
        redirect_uri: REDIRECT_URI,
        state: oauthState,
        code_challenge_method: "S256",
        code_challenge: challenge
      });
      location.href = `https://accounts.spotify.com/authorize?${params}`;
    }

    async function handleCallback() {
      if (!location.pathname.replace(/\/$/, "").endsWith("/callback") && !new URLSearchParams(location.search).has("callback")) return;
      const params = new URLSearchParams(location.search);
      const code = params.get("code");
      const callbackState = params.get("state");
      const expectedState = sessionStorage.getItem("oauth_state");
      const verifier = sessionStorage.getItem("pkce_verifier");
      if (!code) return;
      if (!verifier || callbackState !== expectedState) {
        log("OAuth callback rejected: state or verifier was missing.");
        return;
      }
      try {
        const body = new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: REDIRECT_URI,
          client_id: getClientId(),
          code_verifier: verifier
        });
        const data = await fetchAccounts(body);
        saveToken(data);
        history.replaceState({}, "", new URL(APP_BASE_URL).pathname);
        log("Spotify connected.");
      } catch (error) {
        log(`OAuth failed: ${error.message}`);
      }
    }

    function logout() {
      state.token = null;
      state.refreshToken = null;
      state.expiresAt = 0;
      localStorage.removeItem("spotify_token");
      clearSavedClientSecret();
      resetDevices();
      renderAuth();
      log("Token cleared.");
    }

    function restoreToken() {
      try {
        const saved = JSON.parse(localStorage.getItem("spotify_token") || "null");
        if (saved) Object.assign(state, saved);
      } catch {
        localStorage.removeItem("spotify_token");
      }
    }

    function persistToken() {
      if (!state.token) return;
      localStorage.setItem("spotify_token", JSON.stringify({
        token: state.token,
        refreshToken: state.refreshToken,
        expiresAt: state.expiresAt
      }));
    }

    function saveToken(data) {
      state.token = data.access_token;
      state.refreshToken = data.refresh_token || state.refreshToken;
      state.expiresAt = Date.now() + (data.expires_in - 60) * 1000;
      persistToken();
      renderAuth();
    }

    async function refreshAccessToken() {
      if (!state.refreshToken) throw new Error("Token expired. Connect Spotify again.");
      const body = new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: state.refreshToken,
        client_id: getClientId()
      });
      const data = await fetchAccounts(body);
      saveToken(data);
      log("Spotify token refreshed.");
    }

    async function spotifyFetch(path, options = {}) {
      if (!state.token) throw new Error("Connect Spotify first.");
      if (Date.now() > state.expiresAt) await refreshAccessToken();
      const response = await fetch(`https://api.spotify.com/v1${path}`, {
        ...options,
        headers: {
          "Authorization": `Bearer ${state.token}`,
          "Content-Type": "application/json",
          ...(options.headers || {})
        }
      });
      if (response.status === 401 && state.refreshToken) {
        await refreshAccessToken();
        return spotifyFetch(path, options);
      }
      if (response.status === 204) return null;
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        const message = data?.error?.message || response.statusText;
        if (/NO_ACTIVE_DEVICE|Player command failed/i.test(message)) {
          throw new Error("No active Spotify device found. Open Spotify on desktop/mobile, click Device Refresh, select the device, then try again.");
        }
        throw new SpotifyApiError(message, response, data);
      }
      return data;
    }

    async function playSpotify(options = { method: "PUT" }) {
      const deviceQuery = state.selectedDeviceId ? `?device_id=${encodeURIComponent(state.selectedDeviceId)}` : "";
      return spotifyFetch(`/me/player/play${deviceQuery}`, options);
    }

    async function preparePlaybackOrder() {
      const deviceQuery = state.selectedDeviceId ? `&device_id=${encodeURIComponent(state.selectedDeviceId)}` : "";
      try {
        await spotifyFetch(`/me/player/shuffle?state=false${deviceQuery}`, { method: "PUT" });
      } catch (error) {
        log(`Could not disable shuffle: ${error.message}`);
      }
      try {
        await spotifyFetch(`/me/player/repeat?state=off${deviceQuery}`, { method: "PUT" });
      } catch (error) {
        log(`Could not disable repeat: ${error.message}`);
      }
    }

    function getClientSecret() {
      if (!isLocalhost()) return "";
      return el.clientSecret.value.trim();
    }

    function restoreClientSecretPreference() {
      const saveSecret = localStorage.getItem("spotify_save_client_secret") === "true";
      el.saveClientSecret.checked = saveSecret;
      el.clientSecret.value = saveSecret ? localStorage.getItem("spotify_client_secret") || "" : "";
      if (!saveSecret) localStorage.removeItem("spotify_client_secret");
    }

    function persistClientSecretIfEnabled() {
      if (!el.saveClientSecret.checked) return;
      const secret = el.clientSecret.value.trim();
      if (secret) {
        localStorage.setItem("spotify_client_secret", secret);
      } else {
        localStorage.removeItem("spotify_client_secret");
      }
    }

    function updateClientSecretStorage() {
      if (el.saveClientSecret.checked) {
        localStorage.setItem("spotify_save_client_secret", "true");
        persistClientSecretIfEnabled();
      } else {
        clearSavedClientSecret();
      }
    }

    function clearSavedClientSecret() {
      localStorage.removeItem("spotify_save_client_secret");
      localStorage.removeItem("spotify_client_secret");
      el.saveClientSecret.checked = false;
      el.clientSecret.value = "";
    }

    async function fetchAccounts(body) {
      const headers = { "Content-Type": "application/x-www-form-urlencoded" };
      const secret = getClientSecret();
      if (secret) {
        const clientId = getClientId();
        headers["Authorization"] = `Basic ${btoa(`${clientId}:${secret}`)}`;
      }
      const response = await fetch("https://accounts.spotify.com/api/token", {
        method: "POST",
        headers,
        body
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error_description || data.error || "Spotify auth error");
      return data;
    }

    async function loadPlaylist() {
      try {
        state.playlistId = parsePlaylistId(el.playlistInput.value.trim());
        if (!state.playlistId) throw new Error("Paste a Spotify playlist URL or ID.");
        log(`Loading playlist ${state.playlistId}...`);
        const playlist = await spotifyFetch(`/playlists/${state.playlistId}?fields=name,images(url,width,height),tracks(total)`);
        state.playlistName = playlist.name || state.playlistId;
        state.playlistCoverUrl = pickPlaylistCover(playlist.images || []);
        state.tracks = await fetchAllTracks(state.playlistId);
        computeSplit();
        renderSplit();
        log(`Loaded ${state.tracks.length} tracks from ${state.playlistName}.`);
      } catch (error) {
        log(error.message);
      }
    }

    async function loadUserPlaylists() {
      try {
        log("Loading your Spotify playlists...");
        state.playlists = await fetchUserPlaylists();
        renderPlaylistOptions();
        log(`Loaded ${state.playlists.length} playlists. Choose one from the list, then load it.`);
      } catch (error) {
        log(error.message);
      }
    }

    async function loadDevices() {
      try {
        log("Loading Spotify devices...");
        const data = await spotifyFetch("/me/player/devices");
        state.devices = (data.devices || []).filter(device => device && device.id);
        if (!state.devices.some(device => device.id === state.selectedDeviceId)) {
          const active = state.devices.find(device => device.is_active);
          state.selectedDeviceId = active?.id || "";
        }
        persistSelectedDevice();
        renderDeviceOptions();
        log(state.devices.length ? `Loaded ${state.devices.length} Spotify devices.` : "No Spotify devices found. Open Spotify on desktop/mobile, then refresh devices.");
      } catch (error) {
        log(error.message);
      }
    }

    async function fetchUserPlaylists() {
      const playlists = [];
      let url = "/me/playlists?limit=50";
      while (url) {
        const page = await spotifyFetch(url);
        for (const playlist of page.items || []) {
          if (!playlist || !playlist.id) continue;
          playlists.push({
            id: playlist.id,
            name: playlist.name || playlist.id,
            coverUrl: pickPlaylistCover(playlist.images || []),
            owner: playlist.owner?.display_name || "unknown owner",
            tracks: playlist.tracks?.total ?? 0,
            public: playlist.public
          });
        }
        url = page.next ? page.next.replace("https://api.spotify.com/v1", "") : "";
      }
      return playlists;
    }

    function selectUserPlaylist() {
      const selected = state.playlists.find(playlist => playlist.id === el.playlistSelect.value);
      if (!selected) return;
      state.playlistId = selected.id;
      state.playlistName = selected.name;
      state.playlistCoverUrl = selected.coverUrl || "";
      el.playlistInput.value = selected.id;
      el.playlistTitle.textContent = selected.name;
      log(`Selected playlist: ${selected.name}. Click Load playlist to fetch tracks.`);
    }

    function selectDevice() {
      state.selectedDeviceId = el.deviceSelect.value;
      persistSelectedDevice();
      const selected = state.devices.find(device => device.id === state.selectedDeviceId);
      log(selected ? `Selected Spotify device: ${selected.name}.` : "Using Spotify default active device.");
    }

    function persistSelectedDevice() {
      if (state.selectedDeviceId) {
        localStorage.setItem("spotify_device_id", state.selectedDeviceId);
      } else {
        localStorage.removeItem("spotify_device_id");
      }
    }

    function resetDevices() {
      state.devices = [];
      state.selectedDeviceId = "";
      persistSelectedDevice();
      renderDeviceOptions();
    }

    async function fetchAllTracks(playlistId) {
      const tracks = [];
      let url = `/playlists/${playlistId}/tracks?limit=100&fields=items(track(id,uri,name,duration_ms,artists(name),is_local)),next,total`;
      while (url) {
        const page = await spotifyFetch(url);
        for (const item of page.items || []) {
          if (!item.track || item.track.is_local || !item.track.uri) continue;
          tracks.push({
            id: item.track.id,
            uri: item.track.uri,
            name: item.track.name,
            artists: (item.track.artists || []).map(artist => artist.name).join(", "),
            duration_ms: item.track.duration_ms
          });
        }
        url = page.next ? page.next.replace("https://api.spotify.com/v1", "") : "";
      }
      return tracks;
    }

    function computeSplit() {
      const halfMs = state.tapeMinutes * 60 * 1000 / 2;
      const { split } = splitTracksForSide(state.tracks, halfMs);
      state.splitIndex = split;
      state.sideAElapsedBeforePause = 0;
      state.spotifySideElapsedMs = 0;
      state.lastSideProgressMs = 0;
      state.lastProgressUpdatedAt = 0;
      stopTimer();
    }

    async function applyToSpotify() {
      try {
        if (!state.tracks.length) throw new Error("Load a playlist first.");
        const uris = [...sideA(), ...sideB()].map(track => track.uri);
        await spotifyFetch(`/playlists/${state.playlistId}/tracks`, {
          method: "PUT",
          body: JSON.stringify({ uris: uris.slice(0, 100) })
        });
        for (let i = 100; i < uris.length; i += 100) {
          await spotifyFetch(`/playlists/${state.playlistId}/tracks`, {
            method: "POST",
            body: JSON.stringify({ uris: uris.slice(i, i + 100) })
          });
        }
        log("Playlist order synced to Spotify.");
      } catch (error) {
        log(error.message);
      }
    }

    async function startSideA() {
      let resuming = false;
      try {
        if (!sideA().length) throw new Error("Side A has no tracks.");
        resuming = state.recordMode === "paused" && state.activeRecordSide === "A";
        el.flipBanner.classList.remove("show");
        state.recordMode = "cue_a";
        state.activeRecordSide = "A";
        if (!resuming) {
          state.sideAElapsedBeforePause = 0;
          state.spotifySideElapsedMs = 0;
          state.lastSideProgressMs = 0;
        }
        state.autoPauseDone = false;
        await runRecordCue("A");
        state.recordMode = "recording_a";
        state.lastProgressUpdatedAt = Date.now();
        state.sideAStartedAt = Date.now();
      el.currentTrack.textContent = state.dryRun
        ? (resuming ? "Dry Run: resuming Side A timer." : "Dry Run: Side A timer started.")
        : (resuming ? "Resuming Side A..." : "Starting Side A from track 1...");
      if (!state.dryRun) {
        if (!resuming) await preparePlaybackOrder();
        await playSpotify(resuming ? { method: "PUT" } : buildSidePlaybackPayload(sideA(), 0, 0));
      }
      startTimer();
      if (!state.dryRun) startPollingPlayback();
      renderRecordMode();
      log(state.dryRun ? (resuming ? "Dry Run: resumed Side A." : "Dry Run: started Side A.") : (resuming ? "Resumed Side A." : "Started Side A."));
      } catch (error) {
        clearRecordCue();
        stopTimer();
        state.recordMode = resuming ? "paused" : "idle";
        state.activeRecordSide = resuming ? "A" : null;
        renderRecordMode("Start failed");
        log(error.message);
      }
    }

    async function startSideB() {
      let resuming = false;
      try {
        if (!sideB().length) throw new Error("Side B has no tracks.");
        resuming = state.recordMode === "paused" && state.activeRecordSide === "B";
        el.flipBanner.classList.remove("show");
        state.recordMode = "cue_b";
        state.activeRecordSide = "B";
        if (!resuming) {
          state.spotifySideElapsedMs = 0;
          state.sideAElapsedBeforePause = 0;
          state.lastSideProgressMs = 0;
        }
        state.autoPauseDone = false;
        await runRecordCue("B");
        state.recordMode = "recording_b";
        state.lastProgressUpdatedAt = Date.now();
        state.sideAStartedAt = Date.now();
      el.currentTrack.textContent = state.dryRun
        ? (resuming ? "Dry Run: resuming Side B timer." : "Dry Run: Side B timer started.")
        : (resuming ? "Resuming Side B..." : `Starting Side B from track ${state.splitIndex + 1}...`);
      if (!state.dryRun) {
        if (!resuming) await preparePlaybackOrder();
        await playSpotify(resuming ? { method: "PUT" } : buildSidePlaybackPayload(sideB(), 0, 0));
      }
      startTimer();
      if (!state.dryRun) startPollingPlayback();
      renderRecordMode();
      log(state.dryRun ? (resuming ? "Dry Run: resumed Side B." : "Dry Run: started Side B.") : (resuming ? "Resumed Side B." : "Started Side B."));
      } catch (error) {
        clearRecordCue();
        stopTimer();
        state.recordMode = resuming ? "paused" : "flip";
        state.activeRecordSide = resuming ? "B" : "A";
        renderRecordMode("Start failed");
        log(error.message);
      }
    }

    function runRecordCue(side) {
      clearRecordCue();
      let remaining = getRecordCueSeconds();
      showRecordCue(side, remaining);
      log(`Cue Side ${side}: press record now. ${state.dryRun ? "Dry Run timer" : "Spotify"} starts in ${remaining}s.`);
      return new Promise(resolve => {
        state.cueTimerId = setInterval(() => {
          remaining -= 1;
          if (remaining <= 0) {
            clearRecordCue();
            resolve();
            return;
          }
          showRecordCue(side, remaining);
        }, 1000);
      });
    }

    function showRecordCue(side, remaining) {
      const target = state.dryRun ? "DRY RUN TIMER" : "SPOTIFY";
      el.recordCue.textContent = `PRESS RECORD NOW - SIDE ${side} - ${getCuePhaseText(remaining, target)}`;
      el.recordCue.classList.add("show");
      const currentSide = side === "B" ? sideB() : sideA();
      renderFinishTime(Math.max(0, duration(currentSide) - getProjectedRecordElapsed()));
      renderRecordMode(getCueMonitorText(remaining));
    }

    function getRecordCueSeconds() {
      return RECORD_CUE_SECONDS + state.calibration.leadInSeconds + state.calibration.motorLatencySeconds;
    }

    function getCuePhaseText(remaining, target) {
      const leadIn = state.calibration.leadInSeconds;
      const motor = state.calibration.motorLatencySeconds;
      if (leadIn && remaining > RECORD_CUE_SECONDS + motor) return `WAITING FOR LEAD-IN - ${remaining}s`;
      if (motor && remaining > RECORD_CUE_SECONDS) return `WAITING FOR MOTOR - ${remaining}s`;
      return `${target} STARTS IN ${remaining}`;
    }

    function getCueMonitorText(remaining) {
      const leadIn = state.calibration.leadInSeconds;
      const motor = state.calibration.motorLatencySeconds;
      if (leadIn && remaining > RECORD_CUE_SECONDS + motor) return "Waiting for lead-in";
      if (motor && remaining > RECORD_CUE_SECONDS) return "Waiting for motor";
      return `${state.dryRun ? "Timer" : "Spotify"} starts in ${remaining}s`;
    }

    function clearRecordCue() {
      if (state.cueTimerId) clearInterval(state.cueTimerId);
      state.cueTimerId = null;
      el.recordCue.classList.remove("show");
    }

    function buildSidePlaybackPayload(tracks, position, positionMs = 0) {
      return {
        method: "PUT",
        body: JSON.stringify({
          uris: tracks.map(track => track.uri),
          offset: { position },
          position_ms: positionMs
        })
      };
    }

    async function pausePlayback() {
      try {
        if (!state.dryRun) await spotifyFetch("/me/player/pause", { method: "PUT" });
        if (state.sideAStartedAt) {
          state.sideAElapsedBeforePause += Date.now() - state.sideAStartedAt;
          state.sideAStartedAt = 0;
        }
        state.lastSideProgressMs = getProjectedRecordElapsed();
        state.lastProgressUpdatedAt = Date.now();
        state.recordMode = "paused";
        stopTimer();
        renderRecordMode();
        if (!state.dryRun) schedulePlaybackPoll(getPlaybackPollDelay());
        log(state.dryRun ? "Dry Run paused." : "Playback paused.");
      } catch (error) {
        log(error.message);
      }
    }

    async function abortRecording() {
      try {
        clearRecordCue();
        stopTimer();
        stopPollingPlayback();
        if (state.token && !state.dryRun) {
          try {
            await spotifyFetch("/me/player/pause", { method: "PUT" });
          } catch (error) {
            log(`Abort pause warning: ${error.message}`);
          }
        }
        state.recordMode = "idle";
        state.activeRecordSide = null;
        state.autoPauseDone = false;
        state.sideAStartedAt = 0;
        state.sideAElapsedBeforePause = 0;
        state.spotifySideElapsedMs = 0;
        state.lastSideProgressMs = 0;
        state.lastProgressUpdatedAt = 0;
        el.flipBanner.classList.remove("show");
        el.recordCue.classList.remove("show");
        el.currentTrack.textContent = "Recording aborted.";
        el.playProgress.style.width = "0%";
        el.tapeProgress.style.width = "0%";
        el.countdown.textContent = formatTime(duration(sideA()));
        el.countdownLabel.textContent = "left on Side A";
        el.finishTime.textContent = state.tracks.length ? `Side A done ca. ${formatClockTime(new Date(Date.now() + duration(sideA())))}` : "Finish time pending";
        renderRecordMode("Aborted");
        log(state.dryRun ? "Dry Run aborted." : "Recording aborted.");
        pushSharedStatus(true);
      } catch (error) {
        log(error.message);
      }
    }

    function startTimer() {
      if (state.timerId) clearInterval(state.timerId);
      state.timerId = null;
      el.pauseBtn.disabled = false;
      state.timerId = setInterval(updateTimer, 250);
      updateTimer();
    }

    function stopTimer() {
      if (state.timerId) clearInterval(state.timerId);
      state.timerId = null;
      state.sideAStartedAt = 0;
      updateTimer();
    }

    async function updateTimer() {
      const currentSide = state.activeRecordSide === "B" ? sideB() : sideA();
      const total = duration(currentSide);
      const elapsed = getProjectedRecordElapsed();
      state.lastSideProgressMs = Math.max(state.lastSideProgressMs, elapsed);
      state.lastProgressUpdatedAt = Date.now();
      const remaining = Math.max(0, total - elapsed);
      el.countdown.textContent = formatTime(remaining);
      el.countdownLabel.textContent = `left on Side ${state.activeRecordSide || "A"}`;
      renderFinishTime(remaining);
      el.playProgress.style.width = total ? `${Math.min(100, elapsed / total * 100)}%` : "0%";
      el.tapeProgress.style.width = total ? `${Math.min(100, elapsed / total * 100)}%` : "0%";
      if (state.recordMode === "recording_a" && total && remaining <= 0 && !state.autoPauseDone) {
        await completeSideA();
      } else if (state.recordMode === "recording_b" && total && remaining <= 0 && !state.autoPauseDone) {
        await completeSideB();
      }
      renderRecordMode();
    }

    function renderFinishTime(remainingMs) {
      const activeSide = state.activeRecordSide || "A";
      const cueing = state.recordMode === "cue_a" || state.recordMode === "cue_b";
      const recording = state.recordMode === "recording_a" || state.recordMode === "recording_b";
      const paused = state.recordMode === "paused";
      const playable = cueing || recording || paused;
      if (!playable || !duration(activeSide === "B" ? sideB() : sideA())) {
        el.finishTime.textContent = "Finish time pending";
        return;
      }
      const cueExtraMs = cueing ? getCueRemainingMs() : 0;
      const finishAt = new Date(Date.now() + remainingMs + cueExtraMs);
      const prefix = paused ? "After resume" : `Side ${activeSide} done`;
      el.finishTime.textContent = `${prefix} ca. ${formatClockTime(finishAt)}`;
    }

    function getCueRemainingMs() {
      const match = el.recordCue.textContent.match(/(?:IN|-)\s+(\d+)s?/i);
      return match ? Number(match[1]) * 1000 : 0;
    }

    function getSharedStatusPayload() {
      return {
        updatedAt: new Date().toISOString(),
        playlistName: state.playlistName || "",
        playlistId: state.playlistId || "",
        tapeMinutes: state.tapeMinutes,
        totalTime: el.totalTime.textContent,
        trackCount: el.trackCount.textContent,
        splitPoint: el.splitPoint.textContent,
        recordMode: el.recordModeStatus.textContent,
        activeSide: el.recordSide.textContent,
        monitor: el.recordMonitor.textContent,
        countdown: el.countdown.textContent,
        countdownLabel: el.countdownLabel.textContent,
        finishTime: el.finishTime.textContent,
        currentTrack: el.currentTrack.textContent,
        dryRun: state.dryRun,
        playProgress: el.playProgress.style.width || "0%",
        tapeProgress: el.tapeProgress.style.width || "0%",
        sideATime: el.sideATime.textContent,
        sideBTime: el.sideBTime.textContent,
        sideAFill: el.sideAFill.style.width || "0%",
        sideBFill: el.sideBFill.style.width || "0%",
        flip: el.flipBanner.classList.contains("show"),
        cue: el.recordCue.classList.contains("show") ? el.recordCue.textContent : "",
        lastLog: el.log.textContent.split("\n").slice(0, 8)
      };
    }

    function pushSharedStatus(force = false) {
      if (location.protocol === "file:") return;
      if (!state.statusApiAvailable) return;
      if (!force && Date.now() - state.lastStatusPushAt < 1000) return;
      state.lastStatusPushAt = Date.now();
      fetch("/api/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(getSharedStatusPayload())
      }).catch(() => {});
    }

    async function startSharedStatusPolling() {
      if (location.protocol === "file:") return;
      state.statusApiAvailable = await detectStatusApi();
      if (!state.statusApiAvailable) return;
      if (state.statusPollId) clearInterval(state.statusPollId);
      state.statusPollId = setInterval(fetchSharedStatus, 2000);
      fetchSharedStatus();
    }

    async function detectStatusApi() {
      try {
        const response = await fetch("/api/health", { cache: "no-store" });
        if (!response.ok) return false;
        const health = await response.json().catch(() => null);
        return health?.statusApi === true;
      } catch {
        return false;
      }
    }

    async function fetchSharedStatus() {
      try {
        const response = await fetch("/api/status", { cache: "no-store" });
        if (!response.ok) return;
        const remote = await response.json();
        if (!remote || !remote.updatedAt) return;
        if (state.token) return;
        renderSharedStatus(remote);
      } catch {
        // Static servers do not provide the optional status API.
      }
    }

    function renderSharedStatus(remote) {
      el.playlistTitle.textContent = remote.playlistName || "Remote status";
      el.totalTime.textContent = remote.totalTime || "00:00";
      el.trackCount.textContent = remote.trackCount || "0";
      el.splitPoint.textContent = remote.splitPoint || "-";
      el.recordModeStatus.textContent = remote.recordMode || "Idle";
      el.recordSide.textContent = remote.activeSide || "-";
      el.recordMonitor.textContent = remote.monitor || "Remote";
      el.countdown.textContent = remote.countdown || "00:00";
      el.countdownLabel.textContent = remote.countdownLabel || "remote side status";
      el.finishTime.textContent = remote.finishTime || "Finish time pending";
      el.currentTrack.textContent = remote.currentTrack || "Waiting for remote status.";
      el.playProgress.style.width = remote.playProgress || "0%";
      el.tapeProgress.style.width = remote.tapeProgress || "0%";
      el.sideATime.textContent = remote.sideATime || "00:00 / 00:00";
      el.sideBTime.textContent = remote.sideBTime || "00:00 / 00:00";
      el.sideAFill.style.width = remote.sideAFill || "0%";
      el.sideBFill.style.width = remote.sideBFill || "0%";
      el.flipBanner.classList.toggle("show", Boolean(remote.flip));
      el.recordCue.classList.toggle("show", Boolean(remote.cue));
      if (remote.cue) el.recordCue.textContent = remote.cue;
      if (Array.isArray(remote.lastLog) && remote.lastLog.length) {
        el.log.textContent = remote.lastLog.join("\n");
      }
    }

    function startPollingPlayback() {
      stopPollingPlayback();
      schedulePlaybackPoll(0);
    }

    function stopPollingPlayback() {
      if (state.pollingId) clearTimeout(state.pollingId);
      state.pollingId = null;
    }

    function schedulePlaybackPoll(delayMs = getPlaybackPollDelay()) {
      stopPollingPlayback();
      state.pollingDelayMs = delayMs;
      state.pollingId = setTimeout(readPlaybackState, delayMs);
    }

    function getPlaybackPollDelay(reason) {
      if (reason === "rate_limit") return Math.max(1000, state.pollingPausedUntil - Date.now());
      if (state.recordMode === "recording_a" || state.recordMode === "recording_b") return 2000;
      if (state.recordMode === "flip" || state.recordMode === "paused") return 8000;
      return 10000;
    }

    async function readPlaybackState() {
      try {
        const data = await spotifyFetch("/me/player");
        if (!data || !data.item) {
          el.currentTrack.textContent = "No active playback. Open Spotify first if playback commands fail.";
          renderRecordMode("No device");
          schedulePlaybackPoll(10000);
          return;
        }
        const remain = Math.max(0, data.item.duration_ms - data.progress_ms);
        el.currentTrack.innerHTML = `<b>${escapeHtml(data.item.name)}</b>${escapeHtml((data.item.artists || []).map(a => a.name).join(", "))} · ${formatTime(remain)} remaining`;
        await syncRecordProgressFromSpotify(data);
      } catch (error) {
        if (error instanceof SpotifyApiError && error.status === 429) {
          const retryMs = Math.max(1000, (error.retryAfter || 5) * 1000);
          state.pollingPausedUntil = Date.now() + retryMs;
          renderRecordMode(`Rate limited ${Math.ceil(retryMs / 1000)}s`);
          if (Date.now() - state.lastRateLimitLogAt > 30000) {
            log(`Spotify rate limit hit. Retrying monitor in ${Math.ceil(retryMs / 1000)}s.`);
            state.lastRateLimitLogAt = Date.now();
          }
          schedulePlaybackPoll(retryMs);
          return;
        }
        el.currentTrack.textContent = error.message;
        renderRecordMode("Monitor error");
        schedulePlaybackPoll(10000);
      }
    }

    async function syncRecordProgressFromSpotify(playback) {
      const tracks = state.activeRecordSide === "B" ? sideB() : sideA();
      if (!tracks.length || !playback.item?.uri) {
        renderRecordMode("Waiting");
        schedulePlaybackPoll(10000);
        return;
      }
      await correctUnexpectedPlaybackTrack(tracks, playback);
      const elapsed = getSpotifySideElapsed(tracks, playback.item.uri, playback.progress_ms || 0);
      if (elapsed === null) {
        renderRecordMode("Outside side");
        schedulePlaybackPoll(8000);
        return;
      }
      const localElapsed = getLocalRecordElapsed();
      const driftMs = elapsed - localElapsed;
      if (driftMs > -2000 && driftMs < 10000) {
        state.spotifySideElapsedMs = elapsed;
      }
      if (elapsed > state.lastSideProgressMs && driftMs > -2000 && driftMs < 10000) {
        state.lastSideProgressMs = elapsed;
        state.lastProgressUpdatedAt = Date.now();
      }
      const effectiveElapsed = getProjectedRecordElapsed();
      if (state.recordMode === "recording_a" && effectiveElapsed >= duration(sideA()) - 750 && !state.autoPauseDone) {
        completeSideA();
        return;
      } else if (state.recordMode === "recording_b" && effectiveElapsed >= duration(sideB()) - 750 && !state.autoPauseDone) {
        completeSideB();
        return;
      }
      renderRecordMode(playback.is_playing ? "Monitoring" : "Paused");
      updateTimer();
      schedulePlaybackPoll(getPlaybackPollDelay());
    }

    async function correctUnexpectedPlaybackTrack(tracks, playback) {
      const isRecording = state.recordMode === "recording_a" || state.recordMode === "recording_b";
      if (!isRecording || !playback.is_playing) return;
      const expected = getExpectedTrackAtElapsed(tracks, getLocalRecordElapsed());
      if (!expected || playback.item.uri === expected.track.uri) return;
      if (Date.now() - state.lastPlaybackCorrectionAt < 8000) return;
      state.lastPlaybackCorrectionAt = Date.now();
      const side = state.activeRecordSide || "A";
      const positionMs = Math.max(0, Math.min(expected.positionMs, expected.track.duration_ms - 1000));
      log(`Correcting Spotify to Side ${side} track #${expected.index + 1}: ${expected.track.name}.`);
      await playSpotify(buildSidePlaybackPayload(tracks, expected.index, positionMs));
    }

    function getSpotifySideElapsed(tracks, uri, progressMs) {
      const candidates = [];
      let running = 0;
      for (const track of tracks) {
        if (track.uri === uri) candidates.push(running + progressMs);
        running += track.duration_ms;
      }
      if (!candidates.length) return null;
      const floor = Math.max(0, state.lastSideProgressMs - 5000);
      const anchor = Math.max(getLocalRecordElapsed(), floor);
      const forward = candidates.filter(value => value >= floor);
      const selected = (forward.length ? forward : candidates)
        .sort((a, b) => Math.abs(a - anchor) - Math.abs(b - anchor))[0];
      return Math.max(floor, selected);
    }

    function getLocalRecordElapsed() {
      return state.sideAElapsedBeforePause + (state.sideAStartedAt ? Date.now() - state.sideAStartedAt : 0);
    }

    function getProjectedRecordElapsed() {
      const localElapsed = getLocalRecordElapsed();
      if (!state.spotifySideElapsedMs) return localElapsed;
      const driftMs = state.spotifySideElapsedMs - localElapsed;
      if (driftMs > 0 && driftMs < 10000) return state.spotifySideElapsedMs;
      return localElapsed;
    }

    async function completeSideA() {
      if (state.autoPauseDone) return;
      state.autoPauseDone = true;
      stopTimer();
      try {
        if (!state.dryRun) await spotifyFetch("/me/player/pause", { method: "PUT" });
        log(state.dryRun ? "Dry Run: Side A complete." : "Record Mode: Side A complete. Spotify paused automatically.");
      } catch (error) {
        log(error.message);
      }
      state.recordMode = "flip";
      state.activeRecordSide = "A";
      el.flipBanner.classList.add("show");
      el.startB.disabled = !sideB().length;
      renderRecordMode("Flip now");
      if (!state.dryRun) schedulePlaybackPoll(getPlaybackPollDelay());
    }

    async function completeSideB() {
      if (state.autoPauseDone) return;
      state.autoPauseDone = true;
      stopTimer();
      try {
        if (!state.dryRun) await spotifyFetch("/me/player/pause", { method: "PUT" });
        log(state.dryRun ? "Dry Run: Side B complete." : "Record Mode: Side B complete. Spotify paused automatically.");
      } catch (error) {
        log(error.message);
      }
      state.recordMode = "idle";
      state.activeRecordSide = null;
      renderRecordMode("Complete");
      if (!state.dryRun) schedulePlaybackPoll(getPlaybackPollDelay());
    }

    function renderRecordMode(monitorText) {
      const labels = {
        idle: "Idle",
        cue_a: "Cue",
        cue_b: "Cue",
        recording_a: "Recording",
        recording_b: "Recording",
        paused: "Paused",
        flip: "Flip cassette"
      };
      el.recordModeStatus.textContent = state.dryRun ? `Dry Run - ${labels[state.recordMode] || "Idle"}` : labels[state.recordMode] || "Idle";
      el.recordSide.textContent = state.activeRecordSide || "-";
      const defaultMonitor = {
        idle: "Waiting",
        cue_a: "Record now",
        cue_b: "Record now",
        paused: "Paused",
        flip: "Flip now",
        recording_a: "Monitoring",
        recording_b: "Monitoring"
      };
      el.recordMonitor.textContent = monitorText || defaultMonitor[state.recordMode] || "Waiting";
      el.recordModePanel.classList.toggle("recording", state.recordMode === "recording_a" || state.recordMode === "recording_b");
      el.recordModePanel.classList.toggle("cue-ready", state.recordMode === "cue_a" || state.recordMode === "cue_b");
      el.recordModePanel.classList.toggle("flip-ready", state.recordMode === "flip");

      // Synchronize play button labels and states
      const a = sideA();
      const b = sideB();
      const pausedA = state.recordMode === "paused" && state.activeRecordSide === "A";
      const pausedB = state.recordMode === "paused" && state.activeRecordSide === "B";
      const recording = state.recordMode === "recording_a" || state.recordMode === "recording_b";
      const cueing = state.recordMode === "cue_a" || state.recordMode === "cue_b";
      const abortable = cueing || recording || state.recordMode === "paused" || state.recordMode === "flip";
      el.startA.textContent = pausedA ? "Resume Side A" : "Start Side A";
      el.startB.textContent = pausedB ? "Resume Side B" : "Start Side B";
      const needsToken = !state.dryRun;
      el.startA.disabled = cueing || !a.length || (needsToken && !state.token) || !(state.recordMode === "idle" || pausedA);
      el.startB.disabled = cueing || !b.length || (needsToken && !state.token) || !(state.recordMode === "flip" || pausedB);
      el.pauseBtn.disabled = cueing || (needsToken && !state.token) || !recording;
      el.abortBtn.disabled = !abortable;
      updateDeckChecklistState();
      pushSharedStatus();
    }

    function restoreDeckChecklist() {
      try {
        const saved = JSON.parse(localStorage.getItem("deck_checklist") || "null");
        if (!saved || typeof saved !== "object") return;
        state.deckChecklistDone = Array.isArray(saved.done) ? saved.done.map(Boolean) : [];
        state.skipDeckChecklist = Boolean(saved.skip);
      } catch {
        localStorage.removeItem("deck_checklist");
      }
    }

    function renderDeckChecklist() {
      el.skipDeckChecklist.checked = Boolean(state.skipDeckChecklist);
      el.deckChecklistItems.innerHTML = DECK_CHECKLIST_ITEMS.map((item, index) => {
        const checked = state.deckChecklistDone?.[index] ? " checked" : "";
        return `<label class="deck-check"><input type="checkbox" value="${index}"${checked}><span>${escapeHtml(item)}</span></label>`;
      }).join("");
      updateDeckChecklistState();
    }

    function updateDeckChecklist() {
      state.skipDeckChecklist = el.skipDeckChecklist.checked;
      state.deckChecklistDone = [...el.deckChecklistItems.querySelectorAll("input")].map(input => input.checked);
      localStorage.setItem("deck_checklist", JSON.stringify({
        done: state.deckChecklistDone,
        skip: state.skipDeckChecklist
      }));
      updateDeckChecklistState();
    }

    function updateDeckChecklistState() {
      if (!el.deckChecklistItems) return;
      const total = DECK_CHECKLIST_ITEMS.length;
      const done = [...el.deckChecklistItems.querySelectorAll("input")].filter(input => input.checked).length;
      const skipped = el.skipDeckChecklist.checked;
      el.deckChecklist.classList.toggle("incomplete", !skipped && done < total);
      el.deckChecklist.classList.toggle("skipped", skipped);
      el.deckChecklistStatus.textContent = skipped ? "Skipped" : `${done}/${total} ready`;
    }

    function restoreDryRun() {
      state.dryRun = localStorage.getItem("dry_run_mode") === "true";
    }

    function renderDryRun() {
      el.dryRunToggle.checked = state.dryRun;
      renderRecordMode();
    }

    function updateDryRun() {
      state.dryRun = el.dryRunToggle.checked;
      localStorage.setItem("dry_run_mode", String(state.dryRun));
      if (state.dryRun) stopPollingPlayback();
      renderRecordMode();
      log(state.dryRun ? "Dry Run enabled. Spotify playback commands will be skipped." : "Dry Run disabled. Spotify playback commands are active.");
    }

    function restoreCalibration() {
      try {
        const saved = JSON.parse(localStorage.getItem("recording_calibration") || "null");
        if (!saved || typeof saved !== "object") return;
        state.calibration = normalizeCalibration(saved);
      } catch {
        localStorage.removeItem("recording_calibration");
      }
    }

    function renderCalibration() {
      el.leadInDelay.value = state.calibration.leadInSeconds;
      el.motorLatency.value = state.calibration.motorLatencySeconds;
      el.safetyMargin.value = state.calibration.safetyMarginSeconds;
    }

    function updateCalibration() {
      state.calibration = normalizeCalibration({
        leadInSeconds: el.leadInDelay.value,
        motorLatencySeconds: el.motorLatency.value,
        safetyMarginSeconds: el.safetyMargin.value
      });
      localStorage.setItem("recording_calibration", JSON.stringify(state.calibration));
      renderCalibration();
      renderSplit();
      log(`Recording calibration saved: lead-in ${state.calibration.leadInSeconds}s, motor ${state.calibration.motorLatencySeconds}s, safety ${state.calibration.safetyMarginSeconds}s.`);
    }

    function normalizeCalibration(value) {
      return {
        leadInSeconds: clampSeconds(value.leadInSeconds, 0, 120),
        motorLatencySeconds: clampSeconds(value.motorLatencySeconds, 0, 30),
        safetyMarginSeconds: clampSeconds(value.safetyMarginSeconds, 0, 300)
      };
    }

    function clampSeconds(value, min, max) {
      const number = Number(value);
      if (!Number.isFinite(number)) return min;
      return Math.min(max, Math.max(min, Math.round(number)));
    }

    function setTapeLength(minutes) {
      state.tapeMinutes = minutes;
      el.tapeLabel.textContent = `C${minutes}`;
      computeSplit();
      renderSplit();
    }

    function renderTapeOptions() {
      const formats = getAvailableTapeFormats();
      if (!formats.includes(state.tapeMinutes)) {
        state.tapeMinutes = formats.includes(90) ? 90 : formats[0];
        el.tapeLabel.textContent = `C${state.tapeMinutes}`;
      }
      el.tapeSelect.innerHTML = formats.map(minutes => {
        const selected = minutes === state.tapeMinutes ? " selected" : "";
        return `<option value="${minutes}"${selected}>C${minutes} - ${formatLongTime(minutes * 60 * 1000)} total / ${formatLongTime(minutes * 30 * 1000)} per side</option>`;
      }).join("");
    }

    function renderTapeInventory() {
      const available = new Set(getAvailableTapeFormats());
      el.tapeInventory.innerHTML = TAPE_FORMATS.map(minutes => {
        const checked = available.has(minutes) ? " checked" : "";
        return `<label class="tape-check"><input type="checkbox" value="${minutes}"${checked}>C${minutes}</label>`;
      }).join("");
    }

    function updateAvailableTapeFormats() {
      const checked = [...el.tapeInventory.querySelectorAll("input:checked")].map(input => Number(input.value));
      state.availableTapeFormats = checked.length ? checked : [state.tapeMinutes];
      localStorage.setItem("available_tape_formats", JSON.stringify(state.availableTapeFormats));
      renderTapeOptions();
      computeSplit();
      renderSplit();
      renderTapeInventory();
    }

    function restoreTapeInventory() {
      try {
        const saved = JSON.parse(localStorage.getItem("available_tape_formats") || "null");
        if (Array.isArray(saved)) {
          const valid = saved.map(Number).filter(minutes => TAPE_FORMATS.includes(minutes));
          if (valid.length) state.availableTapeFormats = valid;
        }
      } catch {
        localStorage.removeItem("available_tape_formats");
      }
    }

    function getAvailableTapeFormats() {
      return [...new Set(state.availableTapeFormats)]
        .filter(minutes => TAPE_FORMATS.includes(minutes))
        .sort((a, b) => a - b);
    }

    function renderSplit() {
      const a = sideA();
      const b = sideB();
      const halfMs = state.tapeMinutes * 60 * 1000 / 2;
      const tapeMs = state.tapeMinutes * 60 * 1000;
      const totalMs = duration(state.tracks);
      const aMs = duration(a);
      const bMs = duration(b);

      el.playlistTitle.textContent = state.playlistName || "No playlist loaded";
      el.totalTime.textContent = formatLongTime(totalMs);
      el.trackCount.textContent = String(state.tracks.length);
      el.splitPoint.textContent = state.splitIndex ? `#${state.splitIndex}` : "-";
      el.sideATime.textContent = `${formatTime(aMs)} / ${formatTime(halfMs)}`;
      el.sideBTime.textContent = `${formatTime(bMs)} / ${formatTime(halfMs)}`;
      el.sideAFill.style.width = `${Math.min(100, aMs / halfMs * 100 || 0)}%`;
      el.sideBFill.style.width = `${Math.min(100, bMs / halfMs * 100 || 0)}%`;
      el.sideACount.textContent = `${a.length} tracks`;
      el.sideBCount.textContent = `${b.length} tracks`;
      el.countdown.textContent = formatTime(aMs);
      el.finishTime.textContent = state.tracks.length ? `Side A done ca. ${formatClockTime(new Date(Date.now() + aMs))}` : "Finish time pending";
      renderTapeRecommendation(totalMs);
      el.applyBtn.disabled = !state.tracks.length || !state.token;
      el.pauseBtn.disabled = !state.token;
      el.loadPlaylistsBtn.disabled = !state.token;
      el.loadDevicesBtn.disabled = !state.token;
      el.playlistSelect.disabled = !state.token || !state.playlists.length;
      el.deviceSelect.disabled = !state.token || !state.devices.length;
      renderRecordMode();
      renderTracks(el.sideAList, a, 0);
      renderTracks(el.sideBList, b, state.splitIndex);
      renderJCard(a, b, aMs, bMs, totalMs);
      renderWarnings(totalMs, tapeMs, halfMs);
      pushSharedStatus(true);
    }

    function renderJCard(a, b, aMs, bMs, totalMs) {
      const title = state.playlistName || "No playlist loaded";
      const cover = state.playlistCoverUrl
        ? `<img src="${escapeHtml(state.playlistCoverUrl)}" alt="">`
        : `<span>No cover loaded</span>`;
      const { html: cardHtml, densityClass } = renderJCardMarkup({
        title,
        coverHtml: cover,
        tapeMinutes: state.tapeMinutes,
        tracks: state.tracks,
        sideA: a,
        sideB: b,
        sideAMs: aMs,
        sideBMs: bMs,
        totalMs,
        splitIndex: state.splitIndex,
        escapeHtml
      });
      el.printJCardBtn.disabled = !state.tracks.length;
      el.jCardPreview.className = `jcard-print${densityClass}`;
      el.jCardPrint.className = `jcard-print${densityClass}`;
      el.jCardPreview.innerHTML = cardHtml;
      el.jCardPrint.innerHTML = cardHtml;
    }

    function renderTapeRecommendation(totalMs) {
      if (!state.tracks.length) {
        el.tapeRecommendation.innerHTML = `<b>Tape recommendation pending</b><span>Load a playlist to compare the cassette formats you marked as available.</span>`;
        return;
      }

      const availableFormats = getAvailableTapeFormats();
      const fits = availableFormats.map(minutes => ({ minutes, ...analyzeTapeFit(minutes) }));
      const cleanFit = fits.find(format => totalMs <= format.minutes * 60 * 1000 && format.sideBFits);
      const totalOnlyFit = fits.find(format => totalMs <= format.minutes * 60 * 1000);
      let recommendation;
      let reason;

      if (cleanFit) {
        const blankMs = cleanFit.minutes * 60 * 1000 - totalMs;
        recommendation = `Use C${cleanFit.minutes}`;
        reason = `Total ${formatLongTime(totalMs)} fits cleanly on C${cleanFit.minutes}; about ${formatLongTime(blankMs)} blank tape remains.`;
      } else if (totalOnlyFit) {
        recommendation = `Use C${totalOnlyFit.minutes}, but rebalance manually`;
        reason = `Total ${formatLongTime(totalMs)} fits C${totalOnlyFit.minutes}, but keeping original order makes one side exceed ${formatLongTime(totalOnlyFit.minutes * 30 * 1000)}.`;
      } else {
        const longest = availableFormats[availableFormats.length - 1];
        recommendation = `Too long for C${longest}`;
        reason = `Total ${formatLongTime(totalMs)} exceeds your largest selected tape, C${longest}. Select a longer tape or remove about ${formatLongTime(totalMs - longest * 60 * 1000)}.`;
      }

      el.tapeRecommendation.innerHTML = `<b>${escapeHtml(recommendation)}</b><span>${escapeHtml(reason)}</span>`;
    }

    function analyzeTapeFit(minutes) {
      return analyzeTapeFitForTracks(state.tracks, minutes);
    }

    function renderPlaylistOptions() {
      if (!state.token) {
        el.playlistSelect.innerHTML = `<option value="">Connect Spotify, then load playlists</option>`;
        el.playlistSelect.disabled = true;
        return;
      }
      if (!state.playlists.length) {
        el.playlistSelect.innerHTML = `<option value="">No playlists loaded yet</option>`;
        el.playlistSelect.disabled = true;
        return;
      }
      el.playlistSelect.innerHTML = `<option value="">Choose a playlist...</option>` + state.playlists.map(playlist => {
        const visibility = playlist.public ? "public" : "private";
        const label = `${playlist.name} - ${playlist.tracks} tracks - ${visibility}`;
        return `<option value="${escapeHtml(playlist.id)}">${escapeHtml(label)}</option>`;
      }).join("");
      el.playlistSelect.disabled = false;
    }

    function renderDeviceOptions() {
      if (!state.token) {
        el.deviceSelect.innerHTML = `<option value="">Connect Spotify, then refresh devices</option>`;
        el.deviceSelect.disabled = true;
        el.loadDevicesBtn.disabled = true;
        return;
      }
      el.loadDevicesBtn.disabled = false;
      if (!state.devices.length) {
        el.deviceSelect.innerHTML = `<option value="">Default active device</option>`;
        el.deviceSelect.disabled = true;
        return;
      }
      el.deviceSelect.innerHTML = `<option value="">Default active device</option>` + state.devices.map(device => {
        const tags = [
          device.type || "Device",
          device.is_active ? "active" : "",
          device.is_restricted ? "restricted" : ""
        ].filter(Boolean).join(" - ");
        const label = `${device.name || device.id} (${tags})`;
        return `<option value="${escapeHtml(device.id)}">${escapeHtml(label)}</option>`;
      }).join("");
      el.deviceSelect.value = state.devices.some(device => device.id === state.selectedDeviceId) ? state.selectedDeviceId : "";
      el.deviceSelect.disabled = false;
    }

    function renderTracks(container, tracks, offset) {
      if (!tracks.length) {
        container.innerHTML = `<p class="small">Load a playlist to calculate this side.</p>`;
        return;
      }
      let running = 0;
      container.innerHTML = tracks.map((track, index) => {
        const startsAt = running;
        running += track.duration_ms;
        return `<div class="track">
          <span class="idx">${String(offset + index + 1).padStart(2, "0")}</span>
          <span><span class="name">${escapeHtml(track.name)}</span><span class="artist">${escapeHtml(track.artists)} · ${formatTime(startsAt)}</span></span>
          <span class="dur">${formatTime(track.duration_ms)}</span>
        </div>`;
      }).join("");
    }

    function renderWarnings(totalMs, tapeMs, halfMs) {
      const messages = [];
      if (state.tracks.length && totalMs < tapeMs) {
        messages.push(`Playlist total is shorter than C${state.tapeMinutes}; recording will have ${formatTime(tapeMs - totalMs)} blank tape.`);
      }
      if (state.tracks.length && totalMs > tapeMs) {
        let running = 0;
        const overflow = [];
        for (const track of state.tracks) {
          running += track.duration_ms;
          if (running > tapeMs) overflow.push(track.name);
        }
        messages.push(`Playlist exceeds C${state.tapeMinutes}; songs that will not fit include: ${overflow.slice(0, 5).join(", ")}${overflow.length > 5 ? "..." : ""}`);
      }
      if (duration(sideB()) > halfMs) {
        messages.push(`Side B exceeds ${formatTime(halfMs)}. Extra tracks remain listed so original order is preserved.`);
      }
      const safetyMs = state.calibration.safetyMarginSeconds * 1000;
      if (state.tracks.length && safetyMs) {
        if (halfMs - duration(sideA()) < safetyMs) messages.push(`Side A has less than the configured ${state.calibration.safetyMarginSeconds}s safety margin remaining.`);
        if (duration(sideB()) && halfMs - duration(sideB()) < safetyMs) messages.push(`Side B has less than the configured ${state.calibration.safetyMarginSeconds}s safety margin remaining.`);
      }
      el.warnings.textContent = messages.join("\n");
    }

    function renderAuth() {
      const connected = Boolean(state.token);
      el.authDot.classList.toggle("ok", connected);
      el.authStatus.textContent = connected ? "Connected" : "Disconnected";
      el.connectBtn.textContent = connected ? "Reconnect Spotify" : "Connect Spotify";
      if (!connected) state.playlists = [];
      if (!connected) state.devices = [];
      renderPlaylistOptions();
      renderDeviceOptions();
      renderSplit();
    }

    function sideA() {
      return state.tracks.slice(0, state.splitIndex);
    }

    function sideB() {
      return state.tracks.slice(state.splitIndex);
    }

    function formatClockTime(date) {
      return new Intl.DateTimeFormat(undefined, {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
      }).format(date);
    }

    function getClientId() {
      return el.clientId.value.trim() || localStorage.getItem("spotify_client_id") || DEFAULT_SPOTIFY_CLIENT_ID;
    }

    function getAppBaseUrl() {
      if (location.protocol === "file:") return "http://127.0.0.1:8787/";
      const path = location.pathname.replace(/(?:callback\/?|index\.html)?$/, "");
      return `${location.origin}${path.endsWith("/") ? path : `${path}/`}`;
    }

    function warnIfFileProtocol() {
      if (location.protocol !== "file:") return;
      log("Run python -m http.server 8787 --bind 127.0.0.1, then open http://127.0.0.1:8787. Spotify OAuth will not complete from file://.");
    }

    function escapeHtml(value) {
      return String(value || "").replace(/[&<>"']/g, char => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
      }[char]));
    }

    function log(message) {
      const stamp = new Date().toLocaleTimeString();
      el.log.textContent = `${stamp} ${message}\n${el.log.textContent}`.trim();
      pushSharedStatus(true);
    }
