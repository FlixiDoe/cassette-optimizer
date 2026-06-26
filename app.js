    import { TAPE_CONFIG_VERSION } from "./export.js";
    import { migrateImportedConfig } from "./config-migration.js";
    import { cleanJCardTrackTitle, renderJCardMarkup } from "./jcard.js";
    import { validateRecordingSide, summarizePreflightIssues } from "./recording-preflight.js";
    import { RECORD_CUE_SECONDS, getExpectedTrackAtElapsed } from "./recording.js";
    import { SpotifyApiError, base64Url, parsePlaylistId, pickPlaylistCover, randomBytes, sha256Base64Url } from "./spotify.js";
    import { TAPE_FORMATS, analyzeTapeFitForTracks, duration, formatLongTime, formatTime, splitTracksForSide, splitTracksIntoTapes, splitTracksIntoTapesByFormats } from "./tape.js";

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
      "Spotify quality: Lossless, auto-adjust off, crossfade 0, normalize off",
      "Spotify EQ and system sound enhancements off",
      "Spotify output device matches Windows output device",
      "Exclusive mode and Force volume enabled for the Spotify output device",
      "Windows output volume set to 100%",
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
      tapeInventory: { 60: 1, 90: 1 },
      project: null,
      projectDirty: false,
      tapeLayouts: [],
      selectedTapeIndex: 0,
      slackMarginSeconds: 0,
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
      lastPlaybackCommandAt: 0,
      lastStatusPushAt: 0,
      statusPollId: null,
      statusApiAvailable: false,
      lastImportMissingUriCount: 0,
      importError: "",
      remoteStatusSeen: false,
      playbackRecoveryMessage: "",
      playbackStatus: {
        deviceActive: false,
        deviceName: "",
        deviceId: "",
        expectedTrackPlaying: false,
        playbackInSync: false,
        driftMs: null,
        isPlaying: false
      },
      deckChecklistDone: [],
      skipDeckChecklist: false,
      dryRun: false,
      audioContext: null,
      levelToneNode: null,
      levelToneGain: null,
      jCardThemeCoverUrl: "",
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
      document.body.setAttribute("data-host-mode", "lan-monitor");
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
      el.exportConfigBtn.addEventListener("click", exportTapeConfig);
      el.importConfigBtn.addEventListener("click", () => {
        if (blockIfRecordingLocked("Import Config")) return;
        el.importConfigFile.click();
      });
      el.importConfigFile.addEventListener("change", importTapeConfig);
      el.moveSplitEarlier.addEventListener("click", () => moveManualSplit(-1));
      el.moveSplitLater.addEventListener("click", () => moveManualSplit(1));
      el.lockSplitBtn.addEventListener("click", lockManualSplitFromSelect);
      el.resetSplitBtn.addEventListener("click", resetAutomaticSplit);
      el.loadPlaylistsBtn.addEventListener("click", loadUserPlaylists);
      el.playlistSelect.addEventListener("change", selectUserPlaylist);
      el.loadDevicesBtn.addEventListener("click", loadDevices);
      el.deviceSelect.addEventListener("change", selectDevice);
      el.applyBtn.addEventListener("click", applyToSpotify);
      el.startA.addEventListener("click", startSideA);
      el.startB.addEventListener("click", startSideB);
      el.pauseBtn.addEventListener("click", pausePlayback);
      el.abortBtn.addEventListener("click", abortRecording);
      el.printJCardBtn.addEventListener("click", () => printJCards("selected"));
      el.printAllJCardsBtn.addEventListener("click", () => printJCards("all"));
      el.jCardOverrides.addEventListener("input", updateJCardOverride);
      el.tapeSelect.addEventListener("change", () => setTapeLength(Number(el.tapeSelect.value)));
      el.slackMargin.addEventListener("change", updateSlackMargin);
      el.slackMargin.addEventListener("input", updateSlackMargin);
      el.tapePlanSelect.addEventListener("change", selectTapeLayout);
      el.tapeFormatList.addEventListener("change", updatePerTapeFormat);
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
      el.startLevelToneBtn.addEventListener("click", startLevelTone);
      el.stopLevelToneBtn.addEventListener("click", stopLevelTone);
      window.addEventListener("beforeunload", persistToken);
      startSharedStatusPolling();
      restoreTapeInventory();
      restoreDeckChecklist();
      restoreDryRun();
      restoreCalibration();
      renderTapeOptions();
      renderTapeInventory();
      renderSlackMargin();
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
      if (!state.refreshToken) {
        setPlaybackRecovery("Spotify login expired. Reconnect Spotify, then refresh devices before recording.");
        throw new Error("Token expired. Connect Spotify again.");
      }
      const body = new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: state.refreshToken,
        client_id: getClientId()
      });
      try {
        const data = await fetchAccounts(body);
        saveToken(data);
        setPlaybackRecovery("");
        log("Spotify token refreshed.");
      } catch (error) {
        setPlaybackRecovery("Spotify login expired. Reconnect Spotify, then refresh devices before recording.");
        throw error;
      }
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
          setPlaybackRecovery("Device asleep. Open Spotify on your target device and play any song to wake it up, then retry.");
          throw new Error("No active Spotify device found. Open Spotify on desktop/mobile, click Device Refresh, select the device, then try again.");
        }
        if (response.status === 401) {
          setPlaybackRecovery("Spotify login expired. Reconnect Spotify, then retry recording.");
        }
        if (response.status === 429) {
          const retryAfter = Number(response.headers.get("Retry-After") || 5);
          setPlaybackRecovery(`Spotify is rate limiting playback checks. Waiting ${retryAfter}s before retrying automatically.`);
        }
        throw new SpotifyApiError(message, response, data);
      }
      return data;
    }

    async function playSpotify(options = { method: "PUT" }) {
      const deviceQuery = state.selectedDeviceId ? `?device_id=${encodeURIComponent(state.selectedDeviceId)}` : "";
      const result = await spotifyFetch(`/me/player/play${deviceQuery}`, options);
      state.lastPlaybackCommandAt = Date.now();
      return result;
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
        if (blockIfRecordingLocked("Load playlist")) return;
        if (!(await confirmReplaceDirtyProject())) return;
        const playlistId = parsePlaylistId(el.playlistInput.value.trim());
        if (!playlistId) throw new Error("Paste a Spotify playlist URL or ID.");
        log(`Loading playlist ${playlistId}...`);
        const playlist = await spotifyFetch(`/playlists/${playlistId}?fields=name,images(url,width,height),tracks(total)`);
        const playlistName = playlist.name || playlistId;
        const coverUrl = pickPlaylistCover(playlist.images || []);
        const tracks = await fetchAllTracks(playlistId);
        if (!tracks.length) throw new Error("Playlist has no usable Spotify tracks.");
        state.importError = "";
        setProject(createMixtapeProject({
          projectTitle: playlistName,
          playlistId,
          playlistName,
          coverUrl,
          tracks,
          tapeMinutes: state.tapeMinutes,
          selectedTapeIndex: 0
        }));
        renderSplit();
        log(`Loaded ${tracks.length} tracks from ${playlistName}.`);
      } catch (error) {
        log(error.message);
        renderEmptyStates();
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
      if (blockIfRecordingLocked("Playlist selection")) {
        renderPlaylistOptions();
        return;
      }
      const selected = state.playlists.find(playlist => playlist.id === el.playlistSelect.value);
      if (!selected) return;
      state.playlistId = selected.id;
      state.playlistName = selected.name;
      state.playlistCoverUrl = selected.coverUrl || "";
      el.playlistInput.value = selected.id;
      el.playlistTitle.textContent = selected.name;
      log(`Selected playlist: ${selected.name}. Click Load playlist to fetch tracks.`);
    }

    function createMixtapeProject({ projectTitle, playlistId, playlistName, coverUrl, tracks, tapeMinutes, selectedTapeIndex = 0 }) {
      const now = new Date().toISOString();
      const project = {
        configVersion: TAPE_CONFIG_VERSION,
        projectTitle: projectTitle || playlistName || playlistId || "Untitled mixtape",
        sourcePlaylistId: playlistId || "",
        sourcePlaylistName: playlistName || "",
        coverUrl: coverUrl || "",
        sourceTracks: [...tracks],
        selectedTapeIndex,
        tapes: [],
        splitMode: "automatic",
        slackMarginSeconds: state.slackMarginSeconds,
        jCardOverrides: {},
        calibration: { ...state.calibration },
        createdAt: now,
        updatedAt: now
      };
      project.tapes = buildProjectTapes(project, tapeMinutes, [tapeMinutes]);
      project.selectedTapeIndex = clampTapeIndex(selectedTapeIndex, project.tapes.length);
      return project;
    }

    function buildProjectTapes(project, fallbackTapeMinutes, tapeFormats = []) {
      const formats = tapeFormats.length ? tapeFormats : [fallbackTapeMinutes];
      return splitTracksIntoTapesByFormats(project.sourceTracks, formats, fallbackTapeMinutes, getSlackMarginMs()).map(layout => ({
        ...layout,
        tapeNumber: layout.number,
        tapeTitle: project.sourceTracks.length > layout.sideA.length + layout.sideB.length || layout.number > 1
          ? `${project.projectTitle} - Vol. ${layout.number}`
          : project.projectTitle,
        tapeFormat: layout.tapeMinutes,
        sideLengthMs: layout.sideLengthMs,
        sideA: [...layout.sideA],
        sideB: [...layout.sideB],
        jCard: {
          title: "",
          notes: ""
        }
      }));
    }

    function setProject(project) {
      state.project = project;
      syncStateFromProject();
      resetRecordingProgress();
      state.projectDirty = false;
    }

    function syncStateFromProject() {
      if (!state.project) return;
      state.project.updatedAt = new Date().toISOString();
      state.playlistId = state.project.sourcePlaylistId;
      state.playlistName = state.project.sourcePlaylistName || state.project.projectTitle;
      state.playlistCoverUrl = state.project.coverUrl;
      state.tracks = [...state.project.sourceTracks];
      state.selectedTapeIndex = clampTapeIndex(state.project.selectedTapeIndex, state.project.tapes.length);
      state.project.selectedTapeIndex = state.selectedTapeIndex;
      state.tapeLayouts = state.project.tapes;
      state.splitIndex = selectedTapeLayout()?.sideBStartIndex || 0;
      state.project.calibration = { ...state.calibration };
      state.slackMarginSeconds = clampSeconds(state.project.slackMarginSeconds ?? state.slackMarginSeconds, 0, 120);
      state.project.slackMarginSeconds = state.slackMarginSeconds;
      state.project.jCardOverrides = state.project.jCardOverrides || {};
    }

    function clampTapeIndex(index, tapeCount) {
      if (!tapeCount) return 0;
      const number = Number(index);
      return Number.isFinite(number) ? Math.max(0, Math.min(number, tapeCount - 1)) : 0;
    }

    function selectDevice() {
      state.selectedDeviceId = el.deviceSelect.value;
      persistSelectedDevice();
      const selected = state.devices.find(device => device.id === state.selectedDeviceId);
      setPlaybackRecovery("");
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
      if (state.project) {
        const existingTapes = state.project.tapes || [];
        const formats = existingTapes.map(tape => tape.tapeFormat || tape.tapeMinutes || state.tapeMinutes);
        const manualSplits = existingTapes.map(tape => ({
          splitMode: tape.splitMode,
          manualSplitIndex: tape.manualSplitIndex,
          jCard: tape.jCard,
          tapeTitle: tape.tapeTitle
        }));
        state.project.tapes = buildProjectTapes(state.project, state.tapeMinutes, formats);
        state.project.tapes.forEach((tape, index) => {
          if (manualSplits[index]?.jCard) tape.jCard = manualSplits[index].jCard;
          if (manualSplits[index]?.tapeTitle) tape.tapeTitle = manualSplits[index].tapeTitle;
          if (manualSplits[index]?.splitMode === "manual") {
            applyManualSplitToLayout(tape, manualSplits[index].manualSplitIndex);
          }
        });
        state.project.splitMode = state.project.tapes.some(tape => tape.splitMode === "manual") ? "manual" : "automatic";
        state.project.selectedTapeIndex = clampTapeIndex(state.selectedTapeIndex, state.project.tapes.length);
        syncStateFromProject();
      } else {
        const halfMs = state.tapeMinutes * 60 * 1000 / 2 + getSlackMarginMs();
        state.tapeLayouts = splitTracksIntoTapesByFormats(state.tracks, [state.tapeMinutes], state.tapeMinutes, getSlackMarginMs());
        state.selectedTapeIndex = clampTapeIndex(state.selectedTapeIndex, state.tapeLayouts.length);
        state.splitIndex = selectedTapeLayout()?.sideBStartIndex || splitTracksForSide(state.tracks, halfMs).split;
      }
      state.sideAElapsedBeforePause = 0;
      state.spotifySideElapsedMs = 0;
      state.lastSideProgressMs = 0;
      state.lastProgressUpdatedAt = 0;
      stopTimer();
    }

    async function applyToSpotify() {
      try {
        if (blockIfRecordingLocked("Apply to Spotify")) return;
        if (!projectTracks().length) throw new Error("Load a playlist first.");
        const confirmed = await confirmPlaylistReorder();
        if (!confirmed) return;
        const uris = plannedRecordingTracks().map(track => track.uri);
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
        log("Playlist order synced to Spotify from the full multi-tape plan.");
      } catch (error) {
        log(error.message);
      }
    }

    function confirmPlaylistReorder() {
      return new Promise(resolve => {
        const existing = document.querySelector(".confirm-overlay");
        if (existing) existing.remove();
        const overlay = document.createElement("div");
        overlay.className = "confirm-overlay";
        overlay.innerHTML = `
          <div class="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="applyConfirmTitle">
            <h3 id="applyConfirmTitle">Apply cassette order to Spotify?</h3>
            <p>This will replace the remote playlist sequence with the current full multi-tape plan.</p>
            <div class="confirm-actions">
              <button type="button" data-confirm-action="cancel">Cancel</button>
              <button type="button" data-confirm-action="backup">Export Backup</button>
              <button type="button" class="warn" data-confirm-action="continue">Continue Anyway</button>
            </div>
          </div>
        `;
        document.body.append(overlay);
        const finish = value => {
          overlay.remove();
          resolve(value);
        };
        overlay.addEventListener("click", event => {
          if (event.target === overlay) finish(false);
          const action = event.target?.dataset?.confirmAction;
          if (action === "cancel") finish(false);
          if (action === "backup") {
            exportTapeConfig();
            log("Backup exported. Spotify playlist order was not changed.");
            finish(false);
          }
          if (action === "continue") finish(true);
        });
        overlay.querySelector("[data-confirm-action='cancel']").focus();
      });
    }

    function confirmReplaceDirtyProject() {
      if (!state.project || !state.projectDirty) return Promise.resolve(true);
      return new Promise(resolve => {
        const existing = document.querySelector(".confirm-overlay");
        if (existing) existing.remove();
        const overlay = document.createElement("div");
        overlay.className = "confirm-overlay";
        overlay.innerHTML = `
          <div class="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="replaceConfirmTitle">
            <h3 id="replaceConfirmTitle">Replace unsaved cassette project?</h3>
            <p>The current plan has local changes. Export a backup before replacing it, or continue and discard those edits.</p>
            <div class="confirm-actions">
              <button type="button" data-confirm-action="cancel">Cancel</button>
              <button type="button" data-confirm-action="backup">Export Backup</button>
              <button type="button" class="warn" data-confirm-action="replace">Replace Anyway</button>
            </div>
          </div>
        `;
        document.body.append(overlay);
        const finish = value => {
          overlay.remove();
          resolve(value);
        };
        overlay.addEventListener("click", event => {
          if (event.target === overlay) finish(false);
          const action = event.target?.dataset?.confirmAction;
          if (action === "cancel") finish(false);
          if (action === "backup") {
            exportTapeConfig();
            log("Backup exported. Current project was not replaced.");
            finish(false);
          }
          if (action === "replace") finish(true);
        });
        overlay.querySelector("[data-confirm-action='cancel']").focus();
      });
    }

    function markProjectDirty() {
      if (state.project) state.projectDirty = true;
    }

    async function startSideA() {
      let resuming = false;
      try {
        if (!sideA().length) throw new Error("Side A has no tracks.");
        resuming = state.recordMode === "paused" && state.activeRecordSide === "A";
        runRecordingPreflight("A", sideA());
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
        runRecordingPreflight("B", sideB());
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
        : (resuming ? "Resuming Side B..." : `Starting Side B from track ${sideBStartNumber()}...`);
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

    function runRecordingPreflight(side, tracks) {
      const result = validateRecordingSide({
        sideName: side,
        tracks,
        dryRun: state.dryRun,
        token: state.token,
        deviceReady: isSpotifyDeviceReady(),
        checklistReady: isAudioChecklistConfirmed(),
        checklistSkipped: state.skipDeckChecklist,
        sideLengthMs: selectedSideLengthMs()
      });
      if (!result.ok) {
        const message = summarizePreflightIssues(result);
        const blocking = result.issues.filter(issue => issue.severity === "blocking").map(issue => issue.message).join("\n");
        el.warnings.textContent = blocking || message;
        const firstBlock = result.issues.find(issue => issue.severity === "blocking") || result.issues[0];
        log(`Preflight blocked Side ${side}: ${firstBlock.message}`);
        throw new Error(message);
      }
      const warnings = result.issues.filter(issue => issue.severity === "warning");
      if (warnings.length) {
        el.warnings.textContent = warnings.map(issue => issue.message).join("\n");
        log(`Preflight warning Side ${side}: ${warnings[0].message}`);
      }
    }

    function isSpotifyDeviceReady() {
      if (state.dryRun) return true;
      if (state.selectedDeviceId) return true;
      if (state.playbackStatus.deviceActive || state.playbackStatus.deviceName) return true;
      return state.devices.some(device => device.is_active);
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
      if (leadIn && remaining > RECORD_CUE_SECONDS + motor) return `ADVANCING PAST LEADER TAPE - ${remaining}s`;
      if (motor && remaining > RECORD_CUE_SECONDS) return `WAITING FOR MOTOR - ${remaining}s`;
      return `${target} STARTS IN ${remaining}`;
    }

    function getCueMonitorText(remaining) {
      const leadIn = state.calibration.leadInSeconds;
      const motor = state.calibration.motorLatencySeconds;
      if (leadIn && remaining > RECORD_CUE_SECONDS + motor) return "Advancing past leader tape";
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
        el.finishTime.textContent = projectTracks().length ? `Side A done ca. ${formatClockTime(new Date(Date.now() + duration(sideA())))}` : "Finish time pending";
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
      updateReelVisual(elapsed, total);
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
        tapeMinutes: selectedTapeMinutes(),
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
      state.remoteStatusSeen = false;
      renderEmptyStates();
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
        state.remoteStatusSeen = true;
        renderSharedStatus(remote);
        renderEmptyStates();
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
          if (state.recordMode === "recording_a" || state.recordMode === "recording_b" || Date.now() - state.lastPlaybackCommandAt < 12000) {
            setPlaybackRecovery("Playback command was sent, but Spotify still reports idle. Wake the target device, then pause and resume this side.");
          }
          state.playbackStatus = {
            ...state.playbackStatus,
            deviceActive: Boolean(data?.device?.is_active),
            deviceName: data?.device?.name || "",
            deviceId: data?.device?.id || "",
            expectedTrackPlaying: false,
            playbackInSync: false,
            driftMs: null,
            isPlaying: false
          };
          el.currentTrack.textContent = "No active playback. Open Spotify first if playback commands fail.";
          renderRecordMode("No device");
          schedulePlaybackPoll(10000);
          return;
        }
        state.playbackStatus = {
          ...state.playbackStatus,
          deviceActive: Boolean(data.device?.is_active),
          deviceName: data.device?.name || "",
          deviceId: data.device?.id || "",
          isPlaying: Boolean(data.is_playing)
        };
        if (state.selectedDeviceId && data.device?.id && data.device.id !== state.selectedDeviceId) {
          const selected = state.devices.find(device => device.id === state.selectedDeviceId);
          setPlaybackRecovery(`Spotify is playing on ${data.device.name || "another device"} instead of ${selected?.name || "the selected target"}. Select the active device or switch Spotify output before recording.`);
        } else if (state.playbackRecoveryMessage && data.is_playing) {
          setPlaybackRecovery("");
        }
        const remain = Math.max(0, data.item.duration_ms - data.progress_ms);
        el.currentTrack.innerHTML = `<b>${escapeHtml(data.item.name)}</b>${escapeHtml((data.item.artists || []).map(a => a.name).join(", "))} · ${formatTime(remain)} remaining`;
        await syncRecordProgressFromSpotify(data);
      } catch (error) {
        if (error instanceof SpotifyApiError && error.status === 429) {
          const retryMs = Math.max(1000, (error.retryAfter || 5) * 1000);
          state.pollingPausedUntil = Date.now() + retryMs;
          setPlaybackRecovery(`Spotify is rate limiting playback checks. Waiting ${Math.ceil(retryMs / 1000)}s before retrying automatically.`);
          renderRecordMode(`Rate limited ${Math.ceil(retryMs / 1000)}s`);
          if (Date.now() - state.lastRateLimitLogAt > 30000) {
            log(`Spotify rate limit hit. Retrying monitor in ${Math.ceil(retryMs / 1000)}s.`);
            state.lastRateLimitLogAt = Date.now();
          }
          schedulePlaybackPoll(retryMs);
          return;
        }
        el.currentTrack.textContent = error.message;
        state.playbackStatus = {
          ...state.playbackStatus,
          deviceActive: false,
          deviceId: "",
          expectedTrackPlaying: false,
          playbackInSync: false,
          driftMs: null,
          isPlaying: false
        };
        renderRecordMode("Monitor error");
        schedulePlaybackPoll(10000);
      }
    }

    function setPlaybackRecovery(message) {
      state.playbackRecoveryMessage = message || "";
      renderSpotifyStatusPanel();
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
        state.playbackStatus.expectedTrackPlaying = false;
        state.playbackStatus.playbackInSync = false;
        state.playbackStatus.driftMs = null;
        renderRecordMode("Outside side");
        schedulePlaybackPoll(8000);
        return;
      }
      const localElapsed = getLocalRecordElapsed();
      const driftMs = elapsed - localElapsed;
      const expected = getExpectedTrackAtElapsed(tracks, localElapsed);
      state.playbackStatus.expectedTrackPlaying = Boolean(expected && playback.item.uri === expected.track.uri);
      state.playbackStatus.playbackInSync = Math.abs(driftMs) <= 5000;
      state.playbackStatus.driftMs = driftMs;
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
      el.cassetteVisual.classList.toggle("recording", state.recordMode === "recording_a" || state.recordMode === "recording_b");

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
      renderRecordingLockState();
      updateDeckChecklistState();
      renderSpotifyStatusPanel();
      pushSharedStatus();
    }

    function isRecordingLockActive() {
      return ["cue_a", "cue_b", "recording_a", "recording_b", "paused", "flip"].includes(state.recordMode);
    }

    function blockIfRecordingLocked(action) {
      if (!isRecordingLockActive()) return false;
      log(`${action} is locked while recording is active. Abort or finish the current recording first.`);
      renderRecordingLockState();
      return true;
    }

    function renderRecordingLockState() {
      const locked = isRecordingLockActive();
      if (locked) {
        document.body.setAttribute("data-recording-state", "active");
      } else {
        document.body.removeAttribute("data-recording-state");
      }
      const lockedControls = getRecordingLockedControls();
      lockedControls.forEach(control => {
        if (locked) {
          if (!control.dataset.recordingLockStored) {
            control.dataset.recordingLockWasDisabled = String(control.disabled);
            control.dataset.recordingLockStored = "true";
          }
          control.disabled = true;
        } else if (control.dataset.recordingLockStored) {
          control.disabled = control.dataset.recordingLockWasDisabled === "true";
          delete control.dataset.recordingLockWasDisabled;
          delete control.dataset.recordingLockStored;
        }
      });
    }

    function getRecordingLockedControls() {
      return [
        el.tapeSelect,
        el.slackMargin,
        el.tapePlanSelect,
        el.tapeInventory,
        el.moveSplitEarlier,
        el.moveSplitLater,
        el.lockSplitBtn,
        el.resetSplitBtn,
        el.manualSplitTrack,
        el.importConfigBtn,
        el.importConfigFile,
        el.loadBtn,
        el.applyBtn,
        el.playlistSelect,
        ...el.tapeFormatList.querySelectorAll("select"),
        ...el.tapeInventory.querySelectorAll("input")
      ].filter(Boolean);
    }

    function updateReelVisual(elapsedMs, totalMs) {
      if (!el.cassetteVisual) return;
      const progress = totalMs ? Math.max(0, Math.min(1, elapsedMs / totalMs)) : 0;
      const leftScale = state.activeRecordSide === "B" ? .72 + progress * .28 : 1 - progress * .28;
      const rightScale = state.activeRecordSide === "B" ? 1 - progress * .28 : .72 + progress * .28;
      el.cassetteVisual.style.setProperty("--left-reel-scale", leftScale.toFixed(3));
      el.cassetteVisual.style.setProperty("--right-reel-scale", rightScale.toFixed(3));
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
      renderSpotifyStatusPanel();
    }

    function renderSpotifyStatusPanel() {
      if (!el.spotifyStatusItems) return;
      const checklistReady = isAudioChecklistConfirmed();
      const selectedDevice = state.devices.find(device => device.id === state.selectedDeviceId);
      const activeSelectedDevice = selectedDevice ? selectedDevice.is_active : state.playbackStatus.deviceActive;
      const statuses = [
        {
          label: "Spotify connected",
          ok: Boolean(state.token),
          value: state.token ? "Ready" : "Reconnect"
        },
        {
          label: "Device selected",
          ok: Boolean(state.selectedDeviceId || state.playbackStatus.deviceName || state.dryRun),
          warn: state.dryRun,
          value: state.dryRun ? "Dry Run" : selectedDevice?.name || state.playbackStatus.deviceName || "Missing"
        },
        {
          label: "Device active",
          ok: Boolean(activeSelectedDevice || state.dryRun),
          warn: state.dryRun,
          value: state.dryRun ? "Skipped" : activeSelectedDevice ? "Active" : "Open Spotify"
        },
        {
          label: "Expected track playing",
          ok: Boolean(state.playbackStatus.expectedTrackPlaying || state.dryRun || state.recordMode === "idle"),
          warn: state.recordMode === "idle",
          value: state.dryRun ? "Dry Run" : state.recordMode === "idle" ? "Idle" : state.playbackStatus.expectedTrackPlaying ? "Yes" : "No"
        },
        {
          label: "Playback in sync",
          ok: Boolean(state.playbackStatus.playbackInSync || state.dryRun || state.recordMode === "idle"),
          warn: state.recordMode === "idle",
          value: state.dryRun ? "Dry Run" : state.recordMode === "idle" ? "Idle" : state.playbackStatus.playbackInSync ? formatDrift(state.playbackStatus.driftMs) : "Check"
        },
        {
          label: "Dry Run",
          ok: state.dryRun,
          warn: !state.dryRun,
          value: state.dryRun ? "Enabled" : "Disabled"
        },
        {
          label: "Audio checklist",
          ok: checklistReady,
          value: checklistReady ? "Confirmed" : "Review"
        }
      ];
      el.spotifyStatusItems.innerHTML = statuses.map(item => {
        const className = item.ok ? "ok" : item.warn ? "warn" : "bad";
        return `<div class="status-chip ${className}"><span>${escapeHtml(item.label)}</span><b>${escapeHtml(item.value)}</b></div>`;
      }).join("");
      const warnings = [];
      if (!state.dryRun && !state.token) warnings.push("Connect Spotify before recording.");
      if (!state.dryRun && !activeSelectedDevice) warnings.push("Select and activate a Spotify device.");
      if (!checklistReady) warnings.push("Confirm the audio quality checklist before recording.");
      if (state.playbackRecoveryMessage) warnings.push(state.playbackRecoveryMessage);
      el.spotifyStatusWarning.textContent = warnings.join(" ");
    }

    function isAudioChecklistConfirmed() {
      if (state.skipDeckChecklist) return true;
      const total = DECK_CHECKLIST_ITEMS.length;
      const done = state.deckChecklistDone.filter(Boolean).length;
      return done >= total;
    }

    function formatDrift(driftMs) {
      if (!Number.isFinite(driftMs)) return "In sync";
      const seconds = Math.round(driftMs / 1000);
      if (!seconds) return "In sync";
      return `${seconds > 0 ? "+" : ""}${seconds}s`;
    }

    function restoreDryRun() {
      state.dryRun = localStorage.getItem("dry_run_mode") === "true";
    }

    function renderDryRun() {
      el.dryRunToggle.checked = state.dryRun;
      renderRecordMode();
    }

    function updateDryRun() {
      if (blockIfRecordingLocked("Dry Run mode")) {
        renderDryRun();
        return;
      }
      state.dryRun = el.dryRunToggle.checked;
      localStorage.setItem("dry_run_mode", String(state.dryRun));
      if (state.dryRun) stopPollingPlayback();
      renderRecordMode();
      log(state.dryRun ? "Dry Run enabled. Spotify playback commands will be skipped." : "Dry Run disabled. Spotify playback commands are active.");
    }

    async function startLevelTone() {
      const warning = "This plays a continuous calibration signal through your selected system output. Turn deck input gain down first, then raise it slowly.";
      if (!window.confirm(warning)) return;
      stopLevelTone();
      const context = state.audioContext || new AudioContext();
      state.audioContext = context;
      if (context.state === "suspended") await context.resume();
      const gain = context.createGain();
      gain.gain.value = dbToGain(Number(el.levelToneLevel.value));
      const source = el.levelToneType.value === "pink"
        ? createPinkNoiseSource(context)
        : createToneOscillator(context, Number(el.levelToneType.value));
      source.connect(gain).connect(context.destination);
      source.start();
      state.levelToneNode = source;
      state.levelToneGain = gain;
      el.startLevelToneBtn.disabled = true;
      el.stopLevelToneBtn.disabled = false;
      log(`Level check started: ${getLevelToneLabel()} at ${el.levelToneLevel.value} dBFS.`);
    }

    function stopLevelTone() {
      if (state.levelToneNode) {
        try {
          state.levelToneNode.stop();
        } catch {
          // Source may already have stopped.
        }
        state.levelToneNode.disconnect();
      }
      state.levelToneGain?.disconnect();
      state.levelToneNode = null;
      state.levelToneGain = null;
      if (el.startLevelToneBtn) el.startLevelToneBtn.disabled = false;
      if (el.stopLevelToneBtn) el.stopLevelToneBtn.disabled = true;
    }

    function createToneOscillator(context, frequency) {
      const oscillator = context.createOscillator();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      return oscillator;
    }

    function createPinkNoiseSource(context) {
      const length = context.sampleRate * 2;
      const buffer = context.createBuffer(1, length, context.sampleRate);
      const output = buffer.getChannelData(0);
      let b0 = 0;
      let b1 = 0;
      let b2 = 0;
      for (let i = 0; i < length; i += 1) {
        const white = Math.random() * 2 - 1;
        b0 = 0.99765 * b0 + white * 0.099046;
        b1 = 0.963 * b1 + white * 0.2965164;
        b2 = 0.57 * b2 + white * 1.0526913;
        output[i] = (b0 + b1 + b2 + white * 0.1848) * 0.12;
      }
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      return source;
    }

    function dbToGain(db) {
      return Math.pow(10, db / 20);
    }

    function getLevelToneLabel() {
      if (el.levelToneType.value === "pink") return "pink noise";
      return `${el.levelToneType.value} Hz`;
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
      if (state.project) state.project.calibration = { ...state.calibration };
      markProjectDirty();
      localStorage.setItem("recording_calibration", JSON.stringify(state.calibration));
      renderCalibration();
      renderSplit();
      log(`Recording calibration saved: leader tape ${state.calibration.leadInSeconds}s, motor ${state.calibration.motorLatencySeconds}s, safety ${state.calibration.safetyMarginSeconds}s.`);
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
      if (blockIfRecordingLocked("Tape format")) {
        el.tapeSelect.value = String(state.tapeMinutes);
        return;
      }
      state.tapeMinutes = minutes;
      el.tapeLabel.textContent = `C${minutes}`;
      if (state.project && state.project.tapes.length <= 1 && state.project.tapes[0]) {
        state.project.tapes[0].tapeFormat = minutes;
      }
      markProjectDirty();
      computeSplit();
      renderSplit();
    }

    function renderSlackMargin() {
      el.slackMargin.value = state.slackMarginSeconds;
    }

    function updateSlackMargin() {
      if (blockIfRecordingLocked("Tape Slack Margin")) {
        renderSlackMargin();
        return;
      }
      state.slackMarginSeconds = clampSeconds(el.slackMargin.value, 0, 120);
      if (state.project) state.project.slackMarginSeconds = state.slackMarginSeconds;
      markProjectDirty();
      computeSplit();
      renderSlackMargin();
      renderSplit();
      log(`Tape slack margin set to ${state.slackMarginSeconds}s.`);
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
      el.tapeInventory.innerHTML = TAPE_FORMATS.map(minutes => {
        const quantity = state.tapeInventory[minutes] || 0;
        return `<label class="tape-check tape-quantity"><span>C${minutes}</span><input type="number" min="0" max="99" step="1" value="${quantity}" data-tape-inventory-minutes="${minutes}" aria-label="C${minutes} quantity"></label>`;
      }).join("");
    }

    function updateAvailableTapeFormats() {
      if (blockIfRecordingLocked("Tape inventory")) {
        renderTapeInventory();
        return;
      }
      state.tapeInventory = normalizeTapeInventory(Object.fromEntries(
        [...el.tapeInventory.querySelectorAll("[data-tape-inventory-minutes]")].map(input => [input.dataset.tapeInventoryMinutes, input.value])
      ), [state.tapeMinutes]);
      state.availableTapeFormats = getAvailableTapeFormats();
      markProjectDirty();
      localStorage.setItem("tape_inventory", JSON.stringify(state.tapeInventory));
      renderTapeOptions();
      computeSplit();
      renderSplit();
      renderTapeInventory();
    }

    function restoreTapeInventory() {
      try {
        const savedInventory = JSON.parse(localStorage.getItem("tape_inventory") || "null");
        const savedFormats = JSON.parse(localStorage.getItem("available_tape_formats") || "null");
        state.tapeInventory = normalizeTapeInventory(savedInventory, savedFormats || state.availableTapeFormats);
        state.availableTapeFormats = getAvailableTapeFormats();
      } catch {
        localStorage.removeItem("tape_inventory");
        localStorage.removeItem("available_tape_formats");
      }
    }

    function getAvailableTapeFormats() {
      return Object.entries(getTapeInventory())
        .filter(([, quantity]) => quantity > 0)
        .map(([minutes]) => Number(minutes))
        .sort((a, b) => a - b);
    }

    function getTapeInventory() {
      return normalizeTapeInventory(state.tapeInventory, state.availableTapeFormats);
    }

    function selectTapeLayout() {
      const index = Number(el.tapePlanSelect.value);
      state.selectedTapeIndex = clampTapeIndex(index, state.tapeLayouts.length);
      if (state.project) state.project.selectedTapeIndex = state.selectedTapeIndex;
      markProjectDirty();
      state.tapeMinutes = selectedTapeMinutes();
      resetRecordingProgress();
      renderSplit();
    }

    function updatePerTapeFormat(event) {
      if (blockIfRecordingLocked("Per-tape format")) {
        renderSplit();
        return;
      }
      const select = event.target.closest("[data-tape-format-index]");
      if (!select || !state.project) return;
      const index = Number(select.dataset.tapeFormatIndex);
      const minutes = Number(select.value);
      if (!Number.isInteger(index) || !TAPE_FORMATS.includes(minutes) || !state.project.tapes[index]) return;

      const beforeCount = state.project.tapes.length;
      state.project.tapes[index].tapeFormat = minutes;
      if (index === state.selectedTapeIndex) state.tapeMinutes = minutes;
      markProjectDirty();
      computeSplit();
      renderSplit();
      const afterCount = state.project.tapes.length;
      const countNote = beforeCount === afterCount ? "" : ` The project now uses ${afterCount} physical tapes.`;
      log(`Tape ${index + 1} format set to C${minutes}.${countNote}`);
    }

    function renderSplit() {
      const a = sideA();
      const b = sideB();
      const selectedLayout = selectedTapeLayout();
      const halfMs = selectedSideLengthMs();
      const tapeMs = selectedTapeMinutes() * 60 * 1000;
      const tracks = projectTracks();
      const totalMs = duration(tracks);
      const aMs = duration(a);
      const bMs = duration(b);

      el.playlistTitle.textContent = state.playlistName || "No playlist loaded";
      el.totalTime.textContent = formatLongTime(totalMs);
      el.trackCount.textContent = String(tracks.length);
      el.tapeLabel.textContent = `C${selectedTapeMinutes()}`;
      if ([...el.tapeSelect.options].some(option => Number(option.value) === selectedTapeMinutes())) {
        el.tapeSelect.value = String(selectedTapeMinutes());
      }
      el.splitPoint.textContent = selectedLayout ? `T${selectedLayout.tapeNumber || selectedLayout.number} #${selectedLayout.sideBStartIndex}` : "-";
      el.sideATime.textContent = `${formatTime(aMs)} / ${formatTime(halfMs)}`;
      el.sideBTime.textContent = `${formatTime(bMs)} / ${formatTime(halfMs)}`;
      el.sideABlank.textContent = `Remaining blank tape: ${formatTime(Math.max(0, halfMs - aMs))}`;
      el.sideBBlank.textContent = `Remaining blank tape: ${formatTime(Math.max(0, halfMs - bMs))}`;
      el.sideAFill.style.width = `${Math.min(100, aMs / halfMs * 100 || 0)}%`;
      el.sideBFill.style.width = `${Math.min(100, bMs / halfMs * 100 || 0)}%`;
      el.sideACount.textContent = `${a.length} tracks`;
      el.sideBCount.textContent = `${b.length} tracks`;
      el.countdown.textContent = formatTime(aMs);
      el.finishTime.textContent = tracks.length ? `Side A done ca. ${formatClockTime(new Date(Date.now() + aMs))}` : "Finish time pending";
      renderTapeRecommendation(totalMs);
      el.applyBtn.disabled = !tracks.length || !state.token;
      el.exportConfigBtn.disabled = !state.project || !tracks.length;
      el.pauseBtn.disabled = !state.token;
      el.loadPlaylistsBtn.disabled = !state.token;
      el.loadDevicesBtn.disabled = !state.token;
      el.playlistSelect.disabled = !state.token || !state.playlists.length;
      el.deviceSelect.disabled = !state.token || !state.devices.length;
      renderRecordMode();
      renderTapePlanSelector(totalMs);
      renderSplitExplanation(a, halfMs);
      renderManualSplitControls(a, b, halfMs);
      renderTracks(el.sideAList, a, selectedLayout?.sideAStartIndex || 0);
      renderTracks(el.sideBList, b, selectedLayout?.sideBStartIndex || 0);
      renderJCard(a, b, aMs, bMs, totalMs);
      renderWarnings(totalMs, tapeMs, halfMs);
      renderEmptyStates();
      pushSharedStatus(true);
    }

    function renderJCard(a, b, aMs, bMs, totalMs, renderOverrides = true) {
      updateJCardThemeFromCover();
      const cover = state.playlistCoverUrl
        ? `<img src="${escapeHtml(state.playlistCoverUrl)}" alt="">`
        : `<span>No cover loaded</span>`;
      const selectedLayout = selectedTapeLayout();
      const title = getVolumeTitle(selectedLayout);
      const { html: cardHtml, densityClass } = renderJCardMarkup({
        title,
        coverHtml: cover,
        tapeMinutes: selectedTapeMinutes(),
        tracks: [...a, ...b],
        sideA: a,
        sideB: b,
        sideAMs: aMs,
        sideBMs: bMs,
        totalMs: aMs + bMs,
        splitIndex: selectedLayout?.sideBStartIndex || 0,
        escapeHtml,
        titleOverrides: state.project?.jCardOverrides || {}
      });
      el.printJCardBtn.disabled = !projectTracks().length;
      el.printAllJCardsBtn.disabled = !projectTracks().length;
      el.jCardPreview.className = `jcard-print${densityClass}`;
      el.jCardPreview.innerHTML = cardHtml;
      if (renderOverrides) renderJCardOverrides([...a, ...b]);
      renderJCardPrint("selected");
    }

    function renderJCardOverrides(tracks) {
      if (!tracks.length) {
        el.jCardOverrides.innerHTML = "";
        return;
      }
      const overrides = state.project?.jCardOverrides || {};
      el.jCardOverrides.innerHTML = `
        <h3>J-Card title overrides</h3>
        <div class="jcard-override-grid">
          ${tracks.map(track => {
            const key = getTrackKey(track);
            const cleaned = cleanJCardTrackTitle(track.name);
            const value = overrides[key] || "";
            return `<label>
              <span>${escapeHtml(cleaned)}</span>
              <input data-jcard-override-key="${escapeHtml(key)}" value="${escapeHtml(value)}" placeholder="${escapeHtml(cleaned)}">
            </label>`;
          }).join("")}
        </div>
      `;
    }

    function updateJCardOverride(event) {
      const input = event.target.closest("[data-jcard-override-key]");
      if (!input || !state.project) return;
      const key = input.dataset.jcardOverrideKey;
      state.project.jCardOverrides = state.project.jCardOverrides || {};
      const value = input.value.trim();
      if (value) {
        state.project.jCardOverrides[key] = value;
      } else {
        delete state.project.jCardOverrides[key];
      }
      markProjectDirty();
      renderJCard(sideA(), sideB(), duration(sideA()), duration(sideB()), duration(sideA()) + duration(sideB()), false);
    }

    function renderTapeRecommendation(totalMs) {
      if (!projectTracks().length) {
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
        const tapesNeeded = Math.max(1, Math.ceil(totalMs / (longest * 60 * 1000)));
        recommendation = `Use ${tapesNeeded}x C${longest}`;
        reason = `Total ${formatLongTime(totalMs)} exceeds one C${longest}, so the playlist is split across ${state.tapeLayouts.length || tapesNeeded} physical tapes while preserving order.`;
      }

      el.tapeRecommendation.innerHTML = `<b>${escapeHtml(recommendation)}</b><span>${escapeHtml(reason)}</span>`;
    }

    function renderSplitExplanation(sideATracks, sideLengthMs) {
      const layout = selectedTapeLayout();
      if (!projectTracks().length || !layout) {
        el.splitExplanation.innerHTML = `<b>Why this split?</b><span>Load a playlist to see the split decision.</span>`;
        return;
      }

      const sideAMs = duration(sideATracks);
      const remainingMs = Math.max(0, sideLengthMs - sideAMs);
      const nextTrack = projectTracks()[layout.sideBStartIndex];
      const mode = layout.splitMode === "manual" || state.project?.splitMode === "manual" ? "Manual split is locked here." : "Side A is filled until the next track would exceed the selected side length.";
      const nextText = nextTrack
        ? `Next track: ${nextTrack.name} (${formatTime(nextTrack.duration_ms)}) does not fit in the remaining ${formatTime(remainingMs)}.`
        : `No next track remains; Side A has ${formatTime(remainingMs)} free.`;
      el.splitExplanation.innerHTML = `<b>Why this split?</b><span>${escapeHtml(mode)} Side length is ${formatTime(sideLengthMs)}; Side A has ${formatTime(remainingMs)} left. ${escapeHtml(nextText)} Original playlist order is preserved and no tracks are cut.</span>`;
    }

    function renderManualSplitControls(a, b, sideLengthMs) {
      const layout = selectedTapeLayout();
      const hasProject = Boolean(state.project && layout && projectTracks().length);
      const locked = isRecordingLockActive();
      const mode = layout?.splitMode === "manual" ? "Manual" : "Automatic";
      el.splitModeStatus.textContent = mode;
      el.moveSplitEarlier.disabled = locked || !hasProject || layout.sideBStartIndex <= layout.sideAStartIndex + 1;
      el.moveSplitLater.disabled = locked || !hasProject || !canMoveSplitLater(layout);
      el.lockSplitBtn.disabled = locked || !hasProject;
      el.resetSplitBtn.disabled = locked || !hasProject || layout.splitMode !== "manual";
      el.manualSplitTrack.disabled = locked || !hasProject;
      if (!hasProject) {
        el.manualSplitTrack.innerHTML = `<option value="">Load a playlist first</option>`;
        el.manualSplitWarning.textContent = "";
        return;
      }

      const tapeTracks = [...a, ...b];
      el.manualSplitTrack.innerHTML = tapeTracks.map((track, index) => {
        const absoluteIndex = layout.sideAStartIndex + index + 1;
        const selected = absoluteIndex === layout.sideBStartIndex ? " selected" : "";
        return `<option value="${absoluteIndex}"${selected}>After ${String(absoluteIndex).padStart(2, "0")} - ${escapeHtml(track.name)}</option>`;
      }).join("");

      const warnings = [];
      if (duration(a) > sideLengthMs) warnings.push(`Manual split exceeds Side A length ${formatTime(sideLengthMs)}.`);
      if (duration(b) > sideLengthMs) warnings.push(`Side B exceeds ${formatTime(sideLengthMs)} after this split.`);
      el.manualSplitWarning.textContent = warnings.join(" ");
    }

    function moveManualSplit(delta) {
      if (blockIfRecordingLocked("Manual split")) return;
      const layout = selectedTapeLayout();
      if (!layout) return;
      setManualSplit(layout.sideBStartIndex + delta);
    }

    function lockManualSplitFromSelect() {
      if (blockIfRecordingLocked("Manual split")) return;
      setManualSplit(Number(el.manualSplitTrack.value));
    }

    function setManualSplit(splitIndex) {
      const layout = selectedTapeLayout();
      if (!state.project || !layout) return;
      const result = applyManualSplitToLayout(layout, splitIndex);
      if (!result.ok) {
        renderManualSplitControls(sideA(), sideB(), selectedSideLengthMs());
        log(result.message);
        return;
      }
      markProjectDirty();
      state.project.splitMode = "manual";
      state.project.tapes[state.selectedTapeIndex] = layout;
      syncStateFromProject();
      resetRecordingProgress();
      renderSplit();
      log(result.ok ? `Manual split locked after track ${splitIndex}.` : result.message);
    }

    function resetAutomaticSplit() {
      if (blockIfRecordingLocked("Manual split reset")) return;
      const layout = selectedTapeLayout();
      if (!state.project || !layout) return;
      layout.splitMode = "automatic";
      layout.manualSplitIndex = null;
      markProjectDirty();
      computeSplit();
      renderSplit();
      log("Manual split reset to automatic.");
    }

    function canMoveSplitLater(layout) {
      const nextSplit = layout.sideBStartIndex + 1;
      const nextSideA = projectTracks().slice(layout.sideAStartIndex, nextSplit);
      return nextSplit <= layout.sideBEndIndex && duration(nextSideA) <= selectedSideLengthMs();
    }

    function applyManualSplitToLayout(layout, splitIndex) {
      const start = layout.sideAStartIndex;
      const end = layout.sideBEndIndex;
      const nextSplit = Math.max(start + 1, Math.min(Number(splitIndex) || layout.sideBStartIndex, end));
      const nextSideA = projectTracks().slice(start, nextSplit);
      if (duration(nextSideA) > layout.sideLengthMs) {
        return { ok: false, message: `Manual split exceeds Side A length ${formatTime(layout.sideLengthMs)}.` };
      }
      layout.splitMode = "manual";
      layout.manualSplitIndex = nextSplit;
      layout.sideBStartIndex = nextSplit;
      layout.sideAEndIndex = nextSplit;
      layout.sideA = nextSideA;
      layout.sideB = projectTracks().slice(nextSplit, end);
      return { ok: true, message: "" };
    }

    function exportTapeConfig() {
      try {
        if (!state.project) throw new Error("Load or import a project before exporting.");
        syncStateFromProject();
        const exportedAt = new Date().toISOString();
        const payload = {
          app: "cassette-optimizer",
          configVersion: TAPE_CONFIG_VERSION,
          exportedAt,
          projectTitle: state.project.projectTitle,
          playlistId: state.project.sourcePlaylistId,
          playlistName: state.project.sourcePlaylistName,
          playlistCoverUrl: state.project.coverUrl,
          selectedTapeIndex: state.project.selectedTapeIndex,
          selectedTapeMinutes: selectedTapeMinutes(),
          availableTapeFormats: getAvailableTapeFormats(),
          tapeInventory: getTapeInventory(),
          splitMode: state.project.splitMode || "automatic",
          slackMarginSeconds: state.slackMarginSeconds,
          jCardOverrides: state.project.jCardOverrides || {},
          calibration: { ...state.calibration },
          timestamps: {
            createdAt: state.project.createdAt,
            updatedAt: state.project.updatedAt,
            exportedAt
          },
          tracks: state.project.sourceTracks.map(serializeTrack),
          tapes: state.project.tapes.map(serializeTape)
        };
        downloadJson(payload, `${slugify(payload.projectTitle || "cassette-config")}.cassette.json`);
        state.projectDirty = false;
        log("Tape config exported as JSON.");
      } catch (error) {
        log(error.message);
      }
    }

    async function importTapeConfig(event) {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file) return;
      try {
        if (blockIfRecordingLocked("Import Config")) return;
        if (!(await confirmReplaceDirtyProject())) return;
        const text = await file.text();
        const payload = migrateImportedConfig(JSON.parse(text));
        const project = normalizeImportedConfig(payload);
        state.importError = "";
        state.lastImportMissingUriCount = countMissingTrackUris(project);
        state.tapeInventory = normalizeTapeInventory(payload.tapeInventory, payload.availableTapeFormats || [project.tapes[0]?.tapeFormat || state.tapeMinutes]);
        state.availableTapeFormats = getAvailableTapeFormats();
        state.calibration = normalizeCalibration(payload.calibration || project.calibration || {});
        state.slackMarginSeconds = clampSeconds(project.slackMarginSeconds ?? payload.slackMarginSeconds ?? 0, 0, 120);
        project.slackMarginSeconds = state.slackMarginSeconds;
        localStorage.setItem("tape_inventory", JSON.stringify(state.tapeInventory));
        localStorage.setItem("recording_calibration", JSON.stringify(state.calibration));
        state.tapeMinutes = project.tapes[project.selectedTapeIndex]?.tapeFormat || state.availableTapeFormats[0] || 90;
        setProject(project);
        resetRecordingProgress();
        renderTapeOptions();
        renderTapeInventory();
        renderSlackMargin();
        renderCalibration();
        renderSplit();
        const uriWarning = state.lastImportMissingUriCount ? ` ${state.lastImportMissingUriCount} imported tracks are missing Spotify URIs.` : "";
        log(`${state.token ? "Tape config imported. Refresh Spotify devices before recording." : "Tape config imported without Spotify data. Connect Spotify before playback control."}${uriWarning}`);
      } catch (error) {
        state.importError = error.message;
        log(`Import failed: ${error.message}`);
        renderEmptyStates();
      }
    }

    function normalizeImportedConfig(payload) {
      if (!payload || typeof payload !== "object") throw new Error("Invalid config file.");
      const rawTracks = Array.isArray(payload.tracks) ? payload.tracks : payload.sourceTracks;
      const sourceTracks = normalizeTracks(rawTracks);
      const rawTapes = Array.isArray(payload.tapes) ? payload.tapes : [];
      if (!sourceTracks.length && !rawTapes.length) throw new Error("Imported config has no tracks.");
      const now = new Date().toISOString();
      const project = {
        configVersion: Number(payload.configVersion) || TAPE_CONFIG_VERSION,
        projectTitle: String(payload.projectTitle || payload.playlistName || "Imported mixtape"),
        sourcePlaylistId: String(payload.playlistId || payload.sourcePlaylistId || ""),
        sourcePlaylistName: String(payload.playlistName || payload.sourcePlaylistName || payload.projectTitle || ""),
        coverUrl: String(payload.playlistCoverUrl || payload.coverUrl || ""),
        sourceTracks,
        selectedTapeIndex: 0,
        tapes: [],
        splitMode: payload.splitMode === "manual" ? "manual" : "automatic",
        slackMarginSeconds: clampSeconds(payload.slackMarginSeconds ?? 0, 0, 120),
        jCardOverrides: payload.jCardOverrides && typeof payload.jCardOverrides === "object" && !Array.isArray(payload.jCardOverrides) ? payload.jCardOverrides : {},
        calibration: normalizeCalibration(payload.calibration || {}),
        createdAt: payload.timestamps?.createdAt || payload.createdAt || now,
        updatedAt: now,
        importedAt: now
      };
      project.tapes = rawTapes.length
        ? rawTapes.map((tape, index) => normalizeImportedTape(tape, index, sourceTracks, project.slackMarginSeconds))
        : buildProjectTapes(project, Number(payload.selectedTapeMinutes) || state.tapeMinutes, [Number(payload.selectedTapeMinutes) || state.tapeMinutes]);
      project.selectedTapeIndex = clampTapeIndex(payload.selectedTapeIndex, project.tapes.length);
      return project;
    }

    function normalizeImportedTape(tape, index, sourceTracks, slackMarginSeconds = 0) {
      const tapeFormat = TAPE_FORMATS.includes(Number(tape.tapeFormat || tape.tapeMinutes)) ? Number(tape.tapeFormat || tape.tapeMinutes) : state.tapeMinutes;
      const sideA = normalizeTracks(tape.sideA || []);
      const sideB = normalizeTracks(tape.sideB || []);
      const sideAStartIndex = Number.isInteger(tape.sideAStartIndex) ? tape.sideAStartIndex : findTrackOffset(sourceTracks, sideA[0]);
      const sideBStartIndex = Number.isInteger(tape.sideBStartIndex) ? tape.sideBStartIndex : sideAStartIndex + sideA.length;
      return {
        number: Number(tape.number || tape.tapeNumber) || index + 1,
        tapeNumber: Number(tape.tapeNumber || tape.number) || index + 1,
        tapeTitle: String(tape.tapeTitle || ""),
        tapeMinutes: tapeFormat,
        tapeFormat,
        sideLengthMs: tapeFormat * 30 * 1000 + slackMarginSeconds * 1000,
        sideAStartIndex,
        sideAEndIndex: Number.isInteger(tape.sideAEndIndex) ? tape.sideAEndIndex : sideAStartIndex + sideA.length,
        sideBStartIndex,
        sideBEndIndex: Number.isInteger(tape.sideBEndIndex) ? tape.sideBEndIndex : sideBStartIndex + sideB.length,
        sideA,
        sideB,
        jCard: {
          title: String(tape.jCard?.title || ""),
          notes: String(tape.jCard?.notes || "")
        },
        splitMode: tape.splitMode === "manual" ? "manual" : "automatic",
        manualSplitIndex: Number.isInteger(tape.manualSplitIndex) ? tape.manualSplitIndex : null
      };
    }

    function normalizeTracks(tracks) {
      if (!Array.isArray(tracks)) return [];
      return tracks
        .filter(track => track && typeof track === "object")
        .map(track => ({
          id: String(track.id || track.uri || ""),
          uri: String(track.uri || ""),
          name: String(track.name || "Unknown track"),
          artists: Array.isArray(track.artists) ? track.artists.join(", ") : String(track.artists || "Unknown artist"),
          duration_ms: Math.max(0, Number(track.duration_ms || track.durationMs || 0)),
          is_local: Boolean(track.is_local)
        }))
        .filter(track => track.name && track.duration_ms);
    }

    function serializeTape(tape) {
      return {
        number: tape.number,
        tapeNumber: tape.tapeNumber || tape.number,
        tapeTitle: tape.tapeTitle || "",
        tapeMinutes: tape.tapeMinutes,
        tapeFormat: tape.tapeFormat || tape.tapeMinutes,
        sideLengthMs: tape.sideLengthMs,
        sideAStartIndex: tape.sideAStartIndex,
        sideAEndIndex: tape.sideAEndIndex,
        sideBStartIndex: tape.sideBStartIndex,
        sideBEndIndex: tape.sideBEndIndex,
        splitMode: tape.splitMode || state.project?.splitMode || "automatic",
        manualSplitIndex: tape.manualSplitIndex ?? null,
        sideA: (tape.sideA || []).map(serializeTrack),
        sideB: (tape.sideB || []).map(serializeTrack),
        jCard: {
          title: tape.jCard?.title || "",
          notes: tape.jCard?.notes || ""
        }
      };
    }

    function serializeTrack(track) {
      return {
        id: track.id || "",
        uri: track.uri || "",
        name: track.name || "",
        artists: track.artists || "",
        duration_ms: track.duration_ms || 0,
        is_local: Boolean(track.is_local)
      };
    }

    function normalizeTapeFormats(values, fallback) {
      const formats = (Array.isArray(values) ? values : fallback)
        .map(Number)
        .filter(minutes => TAPE_FORMATS.includes(minutes));
      return [...new Set(formats.length ? formats : [90])].sort((a, b) => a - b);
    }

    function normalizeTapeInventory(value, fallbackFormats = [90]) {
      const inventory = {};
      if (value && typeof value === "object" && !Array.isArray(value)) {
        for (const [minutes, quantity] of Object.entries(value)) {
          const format = Number(minutes);
          if (TAPE_FORMATS.includes(format)) inventory[format] = Math.max(0, Math.min(99, Math.round(Number(quantity) || 0)));
        }
      } else {
        for (const minutes of normalizeTapeFormats(value, fallbackFormats)) {
          inventory[minutes] = Math.max(1, inventory[minutes] || 1);
        }
      }
      if (!Object.values(inventory).some(quantity => quantity > 0)) {
        for (const minutes of normalizeTapeFormats(fallbackFormats, [90])) inventory[minutes] = 1;
      }
      return inventory;
    }

    function findTrackOffset(tracks, track) {
      if (!track) return 0;
      const index = tracks.findIndex(candidate => candidate.uri && candidate.uri === track.uri);
      return index >= 0 ? index : 0;
    }

    function downloadJson(payload, filename) {
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    }

    function slugify(value) {
      return String(value || "cassette-config")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 64) || "cassette-config";
    }

    function analyzeTapeFit(minutes) {
      return analyzeTapeFitForTracks(projectTracks(), minutes);
    }

    function renderTapePlanSelector(totalMs) {
      if (!projectTracks().length || !state.tapeLayouts.length) {
        el.tapePlanSelect.innerHTML = `<option value="0">Load a playlist first</option>`;
        el.tapePlanSelect.disabled = true;
        el.tapeFormatList.hidden = true;
        el.tapeFormatList.innerHTML = "";
        el.tapePlanSummary.textContent = "The selected tape controls the visible sides, recording controls, and J-Card preview.";
        return;
      }

      el.tapePlanSelect.disabled = false;
      el.tapePlanSelect.innerHTML = state.tapeLayouts.map((layout, index) => {
        const aMs = duration(layout.sideA);
        const bMs = duration(layout.sideB);
        const label = `Tape ${layout.tapeNumber || layout.number} - C${layout.tapeFormat || layout.tapeMinutes} - ${layout.sideA.length + layout.sideB.length} tracks - A ${formatLongTime(aMs)} / B ${formatLongTime(bMs)}`;
        const selected = index === state.selectedTapeIndex ? " selected" : "";
        return `<option value="${index}"${selected}>${escapeHtml(label)}</option>`;
      }).join("");
      renderPerTapeFormatControls();
      const tapeWord = state.tapeLayouts.length === 1 ? "tape" : "tapes";
      const formatNote = state.tapeLayouts.length > 1 ? " Each physical tape can use its own format." : "";
      el.tapePlanSummary.textContent = `${formatLongTime(totalMs)} is planned as ${state.tapeLayouts.length} ${tapeWord}. Recording controls and preview follow the selected tape; Print All outputs every J-Card.${formatNote}`;
    }

    function renderPerTapeFormatControls() {
      if (!state.project || state.tapeLayouts.length <= 1) {
        el.tapeFormatList.hidden = true;
        el.tapeFormatList.innerHTML = "";
        return;
      }

      el.tapeFormatList.hidden = false;
      el.tapeFormatList.innerHTML = state.tapeLayouts.map((layout, index) => {
        const selectedMinutes = layout.tapeFormat || layout.tapeMinutes || state.tapeMinutes;
        const inventory = getTapeInventory();
        const usedByOtherTapes = countTapeFormats(index);
        const availableFormats = TAPE_FORMATS.filter(minutes => {
          const remaining = (inventory[minutes] || 0) - (usedByOtherTapes[minutes] || 0);
          return minutes === selectedMinutes || remaining > 0;
        });
        const sideLength = selectedMinutes * 30 * 1000;
        const runtime = duration(layout.sideA) + duration(layout.sideB);
        const options = availableFormats.map(minutes => {
          const selected = minutes === selectedMinutes ? " selected" : "";
          return `<option value="${minutes}"${selected}>C${minutes} - ${formatLongTime(minutes * 60 * 1000)} total / ${formatLongTime(minutes * 30 * 1000)} per side</option>`;
        }).join("");
        return `<label class="tape-format-row">
          <span>Tape ${layout.tapeNumber || layout.number}</span>
          <select data-tape-format-index="${index}">${options}</select>
          <em>${formatLongTime(runtime)} planned / ${formatLongTime(sideLength * 2)} capacity</em>
        </label>`;
      }).join("");
    }

    function countTapeFormats(exceptIndex = -1) {
      const counts = {};
      for (const [index, layout] of state.tapeLayouts.entries()) {
        if (index === exceptIndex) continue;
        const minutes = layout.tapeFormat || layout.tapeMinutes || state.tapeMinutes;
        counts[minutes] = (counts[minutes] || 0) + 1;
      }
      return counts;
    }

    function printJCards(mode) {
      renderJCardPrint(mode);
      window.print();
      renderJCardPrint("selected");
    }

    function renderJCardPrint(mode) {
      const layouts = mode === "all" ? state.tapeLayouts : [selectedTapeLayout()].filter(Boolean);
      if (!layouts.length) {
        el.jCardPrint.className = "jcard-print";
        el.jCardPrint.innerHTML = "";
        return;
      }

      el.jCardPrint.className = "jcard-print-stack";
      el.jCardPrint.innerHTML = layouts.map(layout => {
        const card = renderJCardForLayout(layout);
        return `<div class="print-jcard-page"><div class="jcard-print${card.densityClass}">${card.html}</div></div>`;
      }).join("");
    }

    function renderJCardForLayout(layout) {
      const cover = state.playlistCoverUrl
        ? `<img src="${escapeHtml(state.playlistCoverUrl)}" alt="">`
        : `<span>No cover loaded</span>`;
      return renderJCardMarkup({
        title: getVolumeTitle(layout),
        coverHtml: cover,
        tapeMinutes: layout.tapeFormat || layout.tapeMinutes,
        tracks: [...layout.sideA, ...layout.sideB],
        sideA: layout.sideA,
        sideB: layout.sideB,
        sideAMs: duration(layout.sideA),
        sideBMs: duration(layout.sideB),
        totalMs: duration(layout.sideA) + duration(layout.sideB),
        splitIndex: layout.sideBStartIndex,
        escapeHtml,
        titleOverrides: state.project?.jCardOverrides || {}
      });
    }

    function getTrackKey(track) {
      return track.uri || track.id || `${track.name}-${track.duration_ms}`;
    }

    function updateJCardThemeFromCover() {
      const coverUrl = state.playlistCoverUrl || "";
      if (coverUrl === state.jCardThemeCoverUrl) return;
      state.jCardThemeCoverUrl = coverUrl;
      if (!coverUrl) {
        applyJCardTheme(null);
        return;
      }
      extractDominantCoverColor(coverUrl)
        .then(color => {
          if (state.jCardThemeCoverUrl === coverUrl) applyJCardTheme(color);
        })
        .catch(() => applyJCardTheme(null));
    }

    function extractDominantCoverColor(url) {
      return new Promise((resolve, reject) => {
        const image = new Image();
        image.crossOrigin = "anonymous";
        image.onload = () => {
          try {
            const size = 48;
            const canvas = document.createElement("canvas");
            canvas.width = size;
            canvas.height = size;
            const context = canvas.getContext("2d", { willReadFrequently: true });
            context.drawImage(image, 0, 0, size, size);
            const data = context.getImageData(0, 0, size, size).data;
            let r = 0;
            let g = 0;
            let b = 0;
            let count = 0;
            for (let i = 0; i < data.length; i += 16) {
              const alpha = data[i + 3];
              if (alpha < 180) continue;
              const max = Math.max(data[i], data[i + 1], data[i + 2]);
              const min = Math.min(data[i], data[i + 1], data[i + 2]);
              if (max - min < 16 && max > 220) continue;
              r += data[i];
              g += data[i + 1];
              b += data[i + 2];
              count += 1;
            }
            if (!count) {
              reject(new Error("No usable cover color."));
              return;
            }
            resolve({
              r: Math.round(r / count),
              g: Math.round(g / count),
              b: Math.round(b / count)
            });
          } catch (error) {
            reject(error);
          }
        };
        image.onerror = reject;
        image.src = url;
      });
    }

    function applyJCardTheme(color) {
      const root = document.documentElement;
      if (!color) {
        root.style.removeProperty("--jcard-accent");
        root.style.removeProperty("--jcard-front");
        root.style.removeProperty("--jcard-back");
        root.style.removeProperty("--jcard-paper");
        return;
      }
      root.style.setProperty("--jcard-accent", `rgb(${color.r}, ${color.g}, ${color.b})`);
      root.style.setProperty("--jcard-front", mixColor(color, { r: 235, g: 228, b: 210 }, .22));
      root.style.setProperty("--jcard-back", mixColor(color, { r: 251, g: 250, b: 243 }, .1));
      root.style.setProperty("--jcard-paper", mixColor(color, { r: 247, g: 244, b: 232 }, .08));
    }

    function mixColor(color, base, amount) {
      const r = Math.round(base.r * (1 - amount) + color.r * amount);
      const g = Math.round(base.g * (1 - amount) + color.g * amount);
      const b = Math.round(base.b * (1 - amount) + color.b * amount);
      return `rgb(${r}, ${g}, ${b})`;
    }

    function getVolumeTitle(layout) {
      const baseTitle = state.project?.projectTitle || state.playlistName || "No playlist loaded";
      if (layout?.jCard?.title) return layout.jCard.title;
      if (layout?.tapeTitle) return layout.tapeTitle;
      if (!layout || state.tapeLayouts.length <= 1) return baseTitle;
      return `${baseTitle} - Vol. ${layout.tapeNumber || layout.number}`;
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
        renderEmptyStates();
        return;
      }
      el.loadDevicesBtn.disabled = false;
      if (!state.devices.length) {
        el.deviceSelect.innerHTML = `<option value="">Default active device</option>`;
        el.deviceSelect.disabled = true;
        renderEmptyStates();
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
      renderEmptyStates();
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
      const selectedTotalMs = duration(sideA()) + duration(sideB());
      const tracks = projectTracks();
      const selectedLayout = selectedTapeLayout();
      const missingUris = countMissingTrackUris(state.project || { sourceTracks: tracks, tapes: state.tapeLayouts });
      const checklistReady = isAudioChecklistConfirmed();
      const officialSideLengthMs = selectedTapeMinutes() * 30 * 1000;
      const usesSlack = state.slackMarginSeconds > 0 && (duration(sideA()) > officialSideLengthMs || duration(sideB()) > officialSideLengthMs);
      if (usesSlack) {
        messages.push("Uses unofficial extra tape length. Real cassette may still run out.");
      }
      for (const track of tracks) {
        if (track.duration_ms > halfMs) {
          messages.push(`Track "${track.name}" is longer than one side (${formatTime(track.duration_ms)} > ${formatTime(halfMs)}).`);
          break;
        }
      }
      if (tracks.length && totalMs > tapeMs && state.tapeLayouts.length <= 1) {
        messages.push(`Playlist is longer than selected C${selectedTapeMinutes()} (${formatLongTime(totalMs)} > ${formatLongTime(tapeMs)}).`);
      }
      if (tracks.length && state.tapeLayouts.length <= 1 && totalMs < tapeMs) {
        messages.push(`Playlist total is shorter than C${selectedTapeMinutes()}; recording will have ${formatTime(tapeMs - totalMs)} blank tape.`);
      }
      if (tracks.length && state.tapeLayouts.length > 1) {
        messages.push(`Playlist exceeds one C${selectedTapeMinutes()}; it is split across ${state.tapeLayouts.length} physical tapes with original order preserved.`);
      }
      const inventory = getTapeInventory();
      const usedFormats = countTapeFormats();
      for (const [minutes, used] of Object.entries(usedFormats)) {
        const available = inventory[minutes] || 0;
        if (used > available) {
          messages.push(`Inventory only has ${available}x C${minutes}, but the current plan needs ${used}.`);
        }
      }
      if (state.token && !state.dryRun && !state.selectedDeviceId && !state.playbackStatus.deviceName) {
        messages.push("Spotify device missing. Refresh devices, select one, and make sure Spotify is open.");
      }
      if (missingUris) {
        messages.push(`${missingUris} track${missingUris === 1 ? " is" : "s are"} missing Spotify URI data; Spotify playback/order sync may skip them.`);
      }
      if (tracks.length > 44) {
        messages.push("Print layout may need two pages because the tracklist is long.");
      }
      if (!isLocalhost() && (localStorage.getItem("spotify_client_secret") || el.clientSecret.value.trim())) {
        messages.push("Client Secret is configured while not on localhost. Remove it before using LAN or public hosting.");
      }
      if (selectedLayout?.splitMode === "manual" && duration(sideA()) > halfMs) {
        messages.push(`Manual split exceeds Side A length ${formatTime(halfMs)}.`);
      }
      if (!checklistReady) {
        messages.push("Audio quality checklist has not been confirmed before recording.");
      }
      if (tracks.length && selectedTotalMs < tapeMs) {
        messages.push(`Selected tape ${selectedTapeLayout()?.tapeNumber || selectedTapeLayout()?.number || 1} has ${formatTime(tapeMs - selectedTotalMs)} blank tape.`);
      }
      if (duration(sideB()) > halfMs) {
        messages.push(`Side B exceeds ${formatTime(halfMs)}. Extra tracks remain listed so original order is preserved.`);
      }
      for (const layout of state.tapeLayouts) {
        const sideLength = layout.sideLengthMs || (layout.tapeFormat || layout.tapeMinutes) * 30 * 1000;
        const sideAOverflow = duration(layout.sideA) > sideLength;
        const sideBOverflow = duration(layout.sideB) > sideLength;
        if (sideAOverflow || sideBOverflow) {
          const sides = [sideAOverflow ? "A" : "", sideBOverflow ? "B" : ""].filter(Boolean).join("/");
          messages.push(`Tape ${layout.tapeNumber || layout.number} C${layout.tapeFormat || layout.tapeMinutes} cannot fit Side ${sides} without exceeding ${formatTime(sideLength)}.`);
          if (layout !== selectedLayout) {
            messages.push(`A later tape overflows after the current format plan; review Tape ${layout.tapeNumber || layout.number}.`);
          }
        }
      }
      const safetyMs = state.calibration.safetyMarginSeconds * 1000;
      if (tracks.length && safetyMs) {
        if (halfMs - duration(sideA()) < safetyMs) messages.push(`Side A has less than the configured ${state.calibration.safetyMarginSeconds}s safety margin remaining.`);
        if (duration(sideB()) && halfMs - duration(sideB()) < safetyMs) messages.push(`Side B has less than the configured ${state.calibration.safetyMarginSeconds}s safety margin remaining.`);
      }
      el.warnings.textContent = messages.join("\n");
    }

    function countMissingTrackUris(project) {
      const tracks = [
        ...(project?.sourceTracks || []),
        ...(project?.tapes || []).flatMap(tape => [...(tape.sideA || []), ...(tape.sideB || [])])
      ];
      const seen = new Set();
      let count = 0;
      for (const track of tracks) {
        const key = track.uri || `${track.name}-${track.duration_ms}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (!track.uri) count += 1;
      }
      return count;
    }

    function renderEmptyStates() {
      if (!el.inputEmptyState) return;
      const tracks = projectTracks();
      const inputMessages = [];
      const splitMessages = [];
      const playbackMessages = [];

      if (state.importError) {
        inputMessages.push(["Imported config is invalid", state.importError]);
      } else if (!tracks.length) {
        inputMessages.push(["No playlist loaded", state.token ? "Paste a playlist URL or choose one from your Spotify playlists, then load it." : "Connect Spotify or import a saved cassette config."]);
      }

      if (!tracks.length) {
        splitMessages.push(["No usable tracks", "The split view will update after a playlist or config with playable track durations is loaded."]);
      } else if (!sideA().length && !sideB().length) {
        splitMessages.push(["Playlist has no usable tracks", "Spotify local files or unavailable items were skipped."]);
      }

      if (!state.token && !state.dryRun) {
        playbackMessages.push(["Spotify not connected", "Connect Spotify before controlling playback, or enable Dry Run to test timing only."]);
      } else if (state.token && !state.devices.length && !state.selectedDeviceId && !state.playbackStatus.deviceName) {
        playbackMessages.push(["No active device", "Open Spotify on the target device, then refresh devices."]);
      }

      if (!state.token && state.statusApiAvailable && !state.remoteStatusSeen) {
        playbackMessages.push(["LAN monitor waiting", "No active host status has been received yet. Start or refresh the localhost recorder view."]);
      }

      renderEmptyState(el.inputEmptyState, inputMessages);
      renderEmptyState(el.splitEmptyState, splitMessages);
      renderEmptyState(el.playbackEmptyState, playbackMessages);
    }

    function renderEmptyState(container, messages) {
      container.classList.toggle("show", Boolean(messages.length));
      container.innerHTML = messages.map(([title, body]) => `<b>${escapeHtml(title)}</b><span>${escapeHtml(body)}</span>`).join("");
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
      renderEmptyStates();
    }

    function sideA() {
      return selectedTapeLayout()?.sideA || projectTracks().slice(0, state.splitIndex);
    }

    function sideB() {
      return selectedTapeLayout()?.sideB || projectTracks().slice(state.splitIndex);
    }

    function sideBStartNumber() {
      const layout = selectedTapeLayout();
      return layout ? layout.sideBStartIndex + 1 : state.splitIndex + 1;
    }

    function selectedTapeLayout() {
      return state.project?.tapes[state.selectedTapeIndex] || state.tapeLayouts[state.selectedTapeIndex] || null;
    }

    function projectTracks() {
      return state.project?.sourceTracks || state.tracks;
    }

    function selectedTapeMinutes() {
      const layout = selectedTapeLayout();
      return layout?.tapeFormat || layout?.tapeMinutes || state.tapeMinutes;
    }

    function selectedSideLengthMs() {
      const layout = selectedTapeLayout();
      return layout?.sideLengthMs || selectedTapeMinutes() * 60 * 1000 / 2;
    }

    function getSlackMarginMs() {
      return clampSeconds(state.slackMarginSeconds, 0, 120) * 1000;
    }

    function plannedRecordingTracks() {
      if (!state.tapeLayouts.length) return [...sideA(), ...sideB()];
      return state.tapeLayouts.flatMap(layout => [...layout.sideA, ...layout.sideB]);
    }

    function resetRecordingProgress() {
      state.splitIndex = selectedTapeLayout()?.sideBStartIndex || 0;
      state.sideAElapsedBeforePause = 0;
      state.spotifySideElapsedMs = 0;
      state.lastSideProgressMs = 0;
      state.lastProgressUpdatedAt = 0;
      state.recordMode = "idle";
      state.activeRecordSide = null;
      state.autoPauseDone = false;
      stopTimer();
      stopPollingPlayback();
      el.flipBanner.classList.remove("show");
      el.recordCue.classList.remove("show");
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
