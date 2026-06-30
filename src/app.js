    import { TAPE_CONFIG_VERSION } from "./export.js";
    import { migrateImportedConfig } from "./config-migration.js";
    import { cleanJCardTrackTitle, renderJCardMarkup } from "./jcard.js";
    import { validateRecordingSide, summarizePreflightIssues } from "./recording-preflight.js";
    import { RECORD_CUE_SECONDS, getExpectedTrackAtElapsed } from "./recording.js";
    import { SpotifyApiError, base64Url, parsePlaylistId, pickPlaylistCover, randomBytes, sha256Base64Url } from "./spotify.js";
    import { SpotifyAccountsError, buildTokenState, clearSpotifyAuthStorage, clearSpotifyPkceStorage, expireSpotifySession, isInvalidGrantError } from "./spotify-auth.js";
    import { TAPE_FORMATS, analyzeTapeFitForTracks, duration, formatLongTime, formatTime, splitTracksForSide, splitTracksIntoTapes, splitTracksIntoTapesByFormats } from "./tape.js";

    const DEFAULT_SPOTIFY_CLIENT_ID = "";
    const APP_BASE_URL = getAppBaseUrl();
    const REDIRECT_URI = `${APP_BASE_URL}callback`;
    const REQUIRED_SCOPES = [
      "playlist-read-private",
      "playlist-read-collaborative",
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
      "Spotify output device matches the system output device",
      "Exclusive, fixed-volume, or direct hardware output enabled where available",
      "System output volume set to 100%",
      "Notifications muted",
      "Deck is in record/pause"
    ];
    const DECK_CHECKLIST_SPOTIFY_DEVICE_INDEX = DECK_CHECKLIST_ITEMS.indexOf("Spotify device selected");
    const SPOTIFY_PROGRESS_DRIFT_TOLERANCE_MS = 5000;
    // `deckProfiles` stores the user's saved deck timing presets, while `activeDeckId` stores only the selected deck id so profile edits can replace the array without losing selection intent.
    const DECK_PROFILES_KEY = "deckProfiles";
    const ACTIVE_DECK_ID_KEY = "activeDeckId";
    // `cassetteProfiles` stores measured cassette presets, while `activeCassetteId` stores only the selected cassette id so tape selection can change without rewriting profile data.
    const CASSETTE_PROFILES_KEY = "cassetteProfiles";
    const ACTIVE_CASSETTE_ID_KEY = "activeCassetteId";
    // `tapeCollection` stores owned physical cassette entries linked to cassette profiles, while legacy `tape_inventory` keeps unprofiled C-length quantities.
    const TAPE_COLLECTION_KEY = "tapeCollection";
    const state = {
      token: null,
      refreshToken: null,
      expiresAt: 0,
      authorizedAt: null,
      playlistId: "",
      playlistName: "",
      playlistCoverUrl: "",
      tracks: [],
      pendingDeckProfiles: null,
      pendingCassetteProfiles: null,
      pendingCalibration: null,
      timingUpdateTimerId: null,
      pendingTimingMessage: "",
      playlists: [],
      devices: [],
      selectedDeviceId: localStorage.getItem("spotify_device_id") || "",
      tapeMinutes: 90,
      availableTapeFormats: [60, 90],
      tapeInventory: {},
      tapeCollection: [],
      project: null,
      projectDirty: false,
      pendingConfirmClose: null,
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
      timerRunning: false,
      cueTimerId: null,
      recordCueFinish: null,
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
      rateLimit: {
        active: false,
        secondsRemaining: 0,
        retryAfterSeconds: 0,
        timerId: null,
        bufferedCall: null,
        error: ""
      },
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
      dryRunLog: [],
      dryRun429Simulated: false,
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
      initializeDeckProfiles();
      initializeCassetteProfiles();
      el.clientId.value = localStorage.getItem("spotify_client_id") || DEFAULT_SPOTIFY_CLIENT_ID;
      restoreClientSecretPreference();
      applyHostMode();
      restoreToken();
      handleCallback();
      bindEvents();
      renderProfileControls();
      renderAuth();
      renderSplit();
      renderRecordMode();
      warnIfFileProtocol();
    }

    /**
     * Loads saved deck profiles from localStorage.
     *
     * Steps:
     * 1. Read the `deckProfiles` JSON array from durable browser storage.
     * 2. Return an empty list when the key is missing so first-run setup can seed defaults.
     * 3. Parse the saved JSON and return it only when it is an array.
     * 4. Return an empty list if parsing fails or storage contains a non-array value.
     *
     * @returns {Array<object>} Saved deck profiles, or an empty array when storage is missing or invalid.
     * @throws {Error} Does not throw; malformed localStorage data is handled as an empty profile list.
     *
     * Side effects: Reads `deckProfiles` from `localStorage`.
     */
    function loadDeckProfiles() {
      if (Array.isArray(state.pendingDeckProfiles)) return state.pendingDeckProfiles;
      // Reading the profiles array separately from the active id keeps selection stable when the profiles list is edited.
      const saved = localStorage.getItem(DECK_PROFILES_KEY);
      if (saved === null) return [];
      try {
        const profiles = JSON.parse(saved);
        return Array.isArray(profiles) ? profiles : [];
      } catch {
        // If localStorage contains malformed JSON (e.g. from a failed write), return [] rather than throwing — the UI treats this as first run and re-populates defaults.
        return [];
      }
    }

    /**
     * Saves deck profiles to localStorage.
     *
     * Steps:
     * 1. Accept the caller-provided profile array.
     * 2. Serialize the array as JSON.
     * 3. Write it to the `deckProfiles` durable storage key.
     *
     * @param {Array<object>} profiles - Deck profile objects to persist.
     * @returns {void}
     * @throws {DOMException} May throw if localStorage writes are blocked or quota is exceeded.
     *
     * Side effects: Writes `deckProfiles` in `localStorage`.
     */
    function saveDeckProfiles(profiles, { defer = false } = {}) {
      if (defer) {
        state.pendingDeckProfiles = Array.isArray(profiles) ? profiles : [];
        return;
      }
      state.pendingDeckProfiles = null;
      // Persist the complete profile list as one JSON array so imports and edits can replace profiles atomically.
      localStorage.setItem(DECK_PROFILES_KEY, JSON.stringify(Array.isArray(profiles) ? profiles : []));
    }

    /**
     * Gets the active deck profile.
     *
     * Steps:
     * 1. Load the saved deck profiles.
     * 2. Read `activeDeckId` from durable browser storage.
     * 3. Return the matching profile when the selected id exists.
     * 4. Fall back to the first saved profile when the active id is missing or stale.
     *
     * @returns {object|null} Active deck profile, first available profile, or null when no profiles exist.
     * @throws {Error} Does not throw; missing profile state returns null.
     *
     * Side effects: Reads `deckProfiles` and `activeDeckId` from `localStorage`.
     */
    function getActiveDeck() {
      const profiles = loadDeckProfiles();
      if (!profiles.length) return null;
      // The selected id is separate from the profile list so selecting a deck does not rewrite the saved profiles.
      const activeId = localStorage.getItem(ACTIVE_DECK_ID_KEY);
      return profiles.find(profile => profile.id === activeId) || profiles[0] || null;
    }

    /**
     * Sets the active deck profile id.
     *
     * Steps:
     * 1. Receive the id selected by the caller.
     * 2. Store the id separately from the profile array.
     * 3. Leave profile data unchanged.
     *
     * @param {string} id - Deck profile id to mark as active.
     * @returns {void}
     * @throws {DOMException} May throw if localStorage writes are blocked.
     *
     * Side effects: Writes `activeDeckId` in `localStorage`.
     */
    function setActiveDeck(id) {
      // Store only the active id here because the full deck profile object already lives in `deckProfiles`.
      localStorage.setItem(ACTIVE_DECK_ID_KEY, String(id || ""));
    }

    function initializeDeckProfiles() {
      if (localStorage.getItem(DECK_PROFILES_KEY) !== null) return;
      saveDeckProfiles([]);
      setActiveDeck("");
    }

    /**
     * Loads saved cassette profiles from localStorage.
     *
     * Steps:
     * 1. Read the `cassetteProfiles` JSON array from durable browser storage.
     * 2. Return an empty list when the key is missing so first-run setup can seed defaults.
     * 3. Parse the saved JSON and return it only when it is an array.
     * 4. Return an empty list if parsing fails or storage contains a non-array value.
     *
     * @returns {Array<object>} Saved cassette profiles, or an empty array when storage is missing or invalid.
     * @throws {Error} Does not throw; malformed localStorage data is handled as an empty profile list.
     *
     * Side effects: Reads `cassetteProfiles` from `localStorage`.
     */
    function loadCassetteProfiles() {
      if (Array.isArray(state.pendingCassetteProfiles)) return state.pendingCassetteProfiles;
      // Reading the profiles array separately from the active id keeps selection stable when cassette profiles are edited or imported.
      const saved = localStorage.getItem(CASSETTE_PROFILES_KEY);
      if (saved === null) return [];
      try {
        const profiles = JSON.parse(saved);
        return Array.isArray(profiles) ? profiles : [];
      } catch {
        // If localStorage contains malformed JSON (e.g. from a failed write), return [] rather than throwing — the UI treats this as first run and re-populates defaults.
        return [];
      }
    }

    /**
     * Saves cassette profiles to localStorage.
     *
     * Steps:
     * 1. Accept the caller-provided profile array.
     * 2. Serialize the array as JSON.
     * 3. Write it to the `cassetteProfiles` durable storage key.
     *
     * @param {Array<object>} profiles - Cassette profile objects to persist.
     * @returns {void}
     * @throws {DOMException} May throw if localStorage writes are blocked or quota is exceeded.
     *
     * Side effects: Writes `cassetteProfiles` in `localStorage`.
     */
    function saveCassetteProfiles(profiles, { defer = false } = {}) {
      if (defer) {
        state.pendingCassetteProfiles = Array.isArray(profiles) ? profiles : [];
        return;
      }
      state.pendingCassetteProfiles = null;
      // Persist the complete cassette profile list as one JSON array so imports and edits can replace profiles atomically.
      localStorage.setItem(CASSETTE_PROFILES_KEY, JSON.stringify(Array.isArray(profiles) ? profiles : []));
    }

    /**
     * Gets the active cassette profile.
     *
     * Steps:
     * 1. Load the saved cassette profiles.
     * 2. Read `activeCassetteId` from durable browser storage.
     * 3. Return the matching profile when the selected id exists.
     * 4. Fall back to the first saved profile when the active id is missing or stale.
     *
     * @returns {object|null} Active cassette profile, first available profile, or null when no profiles exist.
     * @throws {Error} Does not throw; missing profile state returns null.
     *
     * Side effects: Reads `cassetteProfiles` and `activeCassetteId` from `localStorage`.
     */
    function getActiveCassette() {
      const profiles = loadCassetteProfiles();
      if (!profiles.length) return null;
      // The selected id is separate from the profile list so selecting a cassette does not rewrite measured profile fields.
      const activeId = localStorage.getItem(ACTIVE_CASSETTE_ID_KEY);
      return profiles.find(profile => profile.id === activeId) || profiles[0] || null;
    }

    /**
     * Sets the active cassette profile id.
     *
     * Steps:
     * 1. Receive the id selected by the caller.
     * 2. Store the id separately from the profile array.
     * 3. Leave cassette profile data unchanged.
     *
     * @param {string} id - Cassette profile id to mark as active.
     * @returns {void}
     * @throws {DOMException} May throw if localStorage writes are blocked.
     *
     * Side effects: Writes `activeCassetteId` in `localStorage`.
     */
    function setActiveCassette(id) {
      // Store only the active id here because the full cassette profile object already lives in `cassetteProfiles`.
      localStorage.setItem(ACTIVE_CASSETTE_ID_KEY, String(id || ""));
    }

    function initializeCassetteProfiles() {
      if (localStorage.getItem(CASSETTE_PROFILES_KEY) !== null) return;
      saveCassetteProfiles([]);
      setActiveCassette("");
    }

    function renderProfileControls() {
      renderDeckProfileControls();
      renderCassetteProfileControls();
      renderCalibration();
      renderSlackMargin();
    }

    function renderDeckProfileControls() {
      const profiles = loadDeckProfiles();
      const active = getActiveDeck();
      el.deckProfileSelect.innerHTML = profiles.length
        ? profiles.map(profile => `<option value="${escapeHtml(profile.id)}">${escapeHtml(profile.name || profile.id)}</option>`).join("")
        : `<option value="">No deck profiles</option>`;
      el.deckProfileSelect.value = active?.id || "";
      el.deckProfileName.value = active?.name || "";
      el.deckManufacturer.value = active?.manufacturer || "";
      el.deckModel.value = active?.model || "";
      el.deckAutoRecordingLevel.value = active?.autoRecordingLevel ?? "";
      el.deckDolbyNR.checked = Boolean(active?.dolbyNR);
      el.deckTypeIISupport.checked = Boolean(active?.typeIISupport);
      el.deckTypeIVSupport.checked = Boolean(active?.typeIVSupport);
      el.deckNotes.value = active?.notes || "";
      el.saveDeckProfileBtn.disabled = !active;
      el.deleteDeckProfileBtn.disabled = !active;
      el.deleteAllDeckProfilesBtn.disabled = !profiles.length;
      el.exportDeckProfileBtn.disabled = !active;
    }

    function renderCassetteProfileControls() {
      const profiles = loadCassetteProfiles();
      const active = getActiveCassette();
      el.cassetteProfileSelect.innerHTML = profiles.length
        ? profiles.map(profile => `<option value="${escapeHtml(profile.id)}">${escapeHtml(profile.name || profile.id)}</option>`).join("")
        : `<option value="">No cassette profiles</option>`;
      el.cassetteProfileSelect.value = active?.id || "";
      el.cassetteProfileName.value = active?.name || "";
      el.cassetteManufacturer.value = active?.manufacturer || "";
      el.cassetteModel.value = active?.model || "";
      el.cassetteProfileType.value = active?.type === "II" ? "II" : "I";
      el.cassetteProfileLength.value = active?.lengthMinutes || "";
      el.cassetteYear.value = active?.year ?? "";
      const condition = active?.condition || {};
      el.cassetteConditionNew.checked = Boolean(condition.new);
      el.cassetteConditionUsed.checked = Boolean(condition.used);
      el.cassetteConditionTestTape.checked = Boolean(condition.testTape);
      el.cassetteLeaderLength.value = active?.leaderLength ?? "";
      el.cassetteSlackMargin.value = active?.slackMargin ?? "";
      el.saveCassetteProfileBtn.disabled = !active;
      el.deleteCassetteProfileBtn.disabled = !active;
      el.deleteAllCassetteProfilesBtn.disabled = !profiles.length;
      el.exportCassetteProfileBtn.disabled = !active;
    }

    function selectDeckProfile() {
      setActiveDeck(el.deckProfileSelect.value);
      renderProfileControls();
      recomputeTimingDependentViews("Deck profile selected.");
    }

    function selectCassetteProfile() {
      setActiveCassette(el.cassetteProfileSelect.value);
      const active = getActiveCassette();
      if (active?.lengthMinutes) setTapeLengthFromProfile(active.lengthMinutes);
      renderProfileControls();
      recomputeTimingDependentViews("Cassette profile selected.");
    }

    function addDeckProfile() {
      const profiles = loadDeckProfiles();
      const profile = createBlankDeckProfile(profiles);
      saveDeckProfiles([...profiles, profile]);
      setActiveDeck(profile.id);
      renderProfileControls();
      recomputeTimingDependentViews("Deck profile created.");
    }

    function deleteActiveDeckProfile() {
      const active = getActiveDeck();
      if (!active) return;
      if (!confirm(`Delete deck profile "${active.name || active.id}"?`)) return;
      const profiles = loadDeckProfiles().filter(profile => profile.id !== active.id);
      saveDeckProfiles(profiles);
      setActiveDeck(profiles[0]?.id || "");
      renderProfileControls();
      recomputeTimingDependentViews("Deck profile deleted.");
    }

    function deleteAllDeckProfiles() {
      const profiles = loadDeckProfiles();
      if (!profiles.length) return;
      if (!confirm(`Delete all ${profiles.length} deck profiles?`)) return;
      saveDeckProfiles([]);
      setActiveDeck("");
      renderProfileControls();
      recomputeTimingDependentViews("All deck profiles deleted.");
    }

    function addCassetteProfile() {
      const profiles = loadCassetteProfiles();
      const profile = createBlankCassetteProfile(profiles);
      saveCassetteProfiles([...profiles, profile]);
      setActiveCassette(profile.id);
      renderProfileControls();
      recomputeTimingDependentViews("Cassette profile created.");
    }

    function deleteActiveCassetteProfile() {
      const active = getActiveCassette();
      if (!active) return;
      if (!confirm(`Delete cassette profile "${active.name || active.id}"? Owned copies for this model will also be removed.`)) return;
      const profiles = loadCassetteProfiles().filter(profile => profile.id !== active.id);
      saveCassetteProfiles(profiles);
      setActiveCassette(profiles[0]?.id || "");
      removeTapeCollectionItemsForProfiles(new Set([active.id]));
      clearTapeCassetteProfileReferences(new Set([active.id]));
      renderProfileControls();
      recomputeTimingDependentViews("Cassette profile deleted.");
    }

    function deleteAllCassetteProfiles() {
      const profiles = loadCassetteProfiles();
      if (!profiles.length) return;
      if (!confirm(`Delete all ${profiles.length} cassette profiles? Owned cassette copies and per-tape model selections will also be cleared.`)) return;
      const ids = new Set(profiles.map(profile => profile.id));
      saveCassetteProfiles([]);
      setActiveCassette("");
      removeTapeCollectionItemsForProfiles(ids);
      clearTapeCassetteProfileReferences(ids);
      renderProfileControls();
      recomputeTimingDependentViews("All cassette profiles deleted.");
    }

    function updateDeckProfile(event) {
      const active = getActiveDeck();
      if (!active) return;
      const profiles = loadDeckProfiles();
      const defer = event?.type === "input";
      const updated = {
        ...active,
        name: el.deckProfileName.value.trim() || active.name,
        manufacturer: el.deckManufacturer.value.trim(),
        model: el.deckModel.value.trim(),
        leaderTapeDelay: clampNumber(el.leadInDelay.value, 0, 120),
        motorLatency: clampNumber(el.motorLatency.value, 0, 30),
        safetyMargin: clampSeconds(el.safetyMargin.value, 0, 300),
        defaultSlackMargin: clampSeconds(el.slackMargin.value, 0, 120),
        autoRecordingLevel: optionalNumber(el.deckAutoRecordingLevel.value, 0, 100),
        dolbyNR: el.deckDolbyNR.checked,
        typeIISupport: el.deckTypeIISupport.checked,
        typeIVSupport: el.deckTypeIVSupport.checked,
        notes: el.deckNotes.value.trim()
      };
      updated.recordingDelayCalibration = buildRecordingDelayCalibration(updated);
      // Keep the edited deck profile visible to timing reads immediately; input events persist and render through a short batch.
      saveDeckProfiles(profiles.map(profile => profile.id === updated.id ? updated : profile), { defer });
      if (defer) {
        scheduleTimingDependentViews("Deck profile updated.");
        return;
      }
      renderDeckProfileControls();
      recomputeTimingDependentViews("Deck profile updated.");
    }

    function updateCassetteProfile(event) {
      const active = getActiveCassette();
      if (!active) return;
      const profiles = loadCassetteProfiles();
      const defer = event?.type === "input";
      const updated = {
        ...active,
        name: el.cassetteProfileName.value.trim() || active.name,
        manufacturer: el.cassetteManufacturer.value.trim(),
        model: el.cassetteModel.value.trim(),
        type: el.cassetteProfileType.value === "II" ? "II" : "I",
        lengthMinutes: Math.max(1, Math.min(180, Math.round(Number(el.cassetteProfileLength.value) || active.lengthMinutes || 90))),
        year: optionalYear(el.cassetteYear.value),
        condition: {
          new: el.cassetteConditionNew.checked,
          used: el.cassetteConditionUsed.checked,
          testTape: el.cassetteConditionTestTape.checked
        },
        leaderLength: optionalNumber(el.cassetteLeaderLength.value, 0, 120),
        slackMargin: optionalSeconds(el.cassetteSlackMargin.value, 0, 120)
      };
      // Keep cassette edits visible to timing reads immediately; input events persist and render through a short batch.
      saveCassetteProfiles(profiles.map(profile => profile.id === updated.id ? updated : profile), { defer });
      setTapeLengthFromProfile(updated.lengthMinutes);
      if (defer) {
        scheduleTimingDependentViews("Cassette profile updated.");
        return;
      }
      renderCassetteProfileControls();
      recomputeTimingDependentViews("Cassette profile updated.");
    }

    function setTapeLengthFromProfile(minutes) {
      state.tapeMinutes = TAPE_FORMATS.includes(Number(minutes)) ? Number(minutes) : state.tapeMinutes;
      if (state.project && state.project.tapes.length <= 1 && state.project.tapes[0]) {
        state.project.tapes[0].tapeFormat = state.tapeMinutes;
      }
    }

    function createBlankDeckProfile(profiles) {
      return {
        id: uniqueProfileId("deck_custom", profiles),
        name: `New deck ${profiles.length + 1}`,
        manufacturer: "",
        model: "",
        leaderTapeDelay: 0,
        motorLatency: 0,
        safetyMargin: 0,
        recordingDelayCalibration: {
          leaderTapeDelay: 0,
          motorLatency: 0,
          safetyMargin: 0
        },
        defaultSlackMargin: 0,
        autoRecordingLevel: null,
        dolbyNR: false,
        typeIISupport: false,
        typeIVSupport: false,
        notes: ""
      };
    }

    function createBlankCassetteProfile(profiles) {
      return {
        id: uniqueProfileId("tape_custom", profiles),
        name: `New cassette ${profiles.length + 1}`,
        manufacturer: "",
        model: "",
        type: "I",
        lengthMinutes: Number(state.tapeMinutes) || 90,
        year: null,
        condition: {
          new: false,
          used: false,
          testTape: false
        },
        slackMargin: null,
        leaderLength: null
      };
    }

    function recomputeTimingDependentViews(message) {
      if (state.project || state.tracks.length) computeSplit();
      renderTapeOptions();
      renderTapeInventory();
      renderSlackMargin();
      renderSplit();
      renderRecordMode();
      if (message) {
        el.profileStatus.textContent = message;
        log(message);
      }
    }

    function scheduleTimingDependentViews(message) {
      state.pendingTimingMessage = message || state.pendingTimingMessage;
      if (state.timingUpdateTimerId) clearTimeout(state.timingUpdateTimerId);
      state.timingUpdateTimerId = window.setTimeout(flushTimingDependentViews, 250);
    }

    function flushTimingDependentViews() {
      const hasPending = state.timingUpdateTimerId
        || Array.isArray(state.pendingDeckProfiles)
        || Array.isArray(state.pendingCassetteProfiles)
        || Boolean(state.pendingCalibration)
        || Boolean(state.pendingTimingMessage);
      if (!hasPending) return;
      if (state.timingUpdateTimerId) clearTimeout(state.timingUpdateTimerId);
      state.timingUpdateTimerId = null;
      if (Array.isArray(state.pendingDeckProfiles)) {
        const profiles = state.pendingDeckProfiles;
        state.pendingDeckProfiles = null;
        saveDeckProfiles(profiles);
      }
      if (Array.isArray(state.pendingCassetteProfiles)) {
        const profiles = state.pendingCassetteProfiles;
        state.pendingCassetteProfiles = null;
        saveCassetteProfiles(profiles);
      }
      if (state.pendingCalibration) {
        localStorage.setItem("recording_calibration", JSON.stringify(state.pendingCalibration));
        state.pendingCalibration = null;
      }
      const message = state.pendingTimingMessage;
      state.pendingTimingMessage = "";
      recomputeTimingDependentViews(message);
    }

    function uniqueProfileId(prefix, profiles) {
      const existing = new Set(profiles.map(profile => profile.id));
      let index = profiles.length + 1;
      let id = `${prefix}_${randomProfileIdSuffix()}`;
      while (existing.has(id)) {
        id = `${prefix}_${randomProfileIdSuffix()}_${index}`;
        index += 1;
      }
      return id;
    }

    function randomProfileIdSuffix() {
      return globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    }

    function optionalSeconds(value, min, max) {
      if (String(value).trim() === "") return null;
      return clampSeconds(value, min, max);
    }

    function optionalNumber(value, min, max) {
      if (String(value).trim() === "") return null;
      return clampNumber(value, min, max);
    }

    function optionalYear(value) {
      if (String(value).trim() === "") return null;
      const year = Math.round(Number(value));
      return Number.isFinite(year) ? Math.max(1900, Math.min(2100, year)) : null;
    }

    function addTapeCollectionItem(cassetteProfileId) {
      const profile = loadCassetteProfiles().find(candidate => candidate.id === cassetteProfileId);
      if (!profile) return;
      const item = {
        id: uniqueProfileId("owned_tape", state.tapeCollection),
        cassetteProfileId: profile.id,
        label: profile.name,
        addedAt: new Date().toISOString()
      };
      state.tapeCollection = [...state.tapeCollection, item];
      saveTapeCollection();
    }

    function removeTapeCollectionItem(cassetteProfileId) {
      const index = state.tapeCollection.findIndex(item => item.cassetteProfileId === cassetteProfileId);
      if (index < 0) return;
      state.tapeCollection = state.tapeCollection.filter((_, itemIndex) => itemIndex !== index);
      saveTapeCollection();
    }

    function removeTapeCollectionItemsForProfiles(profileIds) {
      const before = state.tapeCollection.length;
      state.tapeCollection = state.tapeCollection.filter(item => !profileIds.has(item.cassetteProfileId));
      if (state.tapeCollection.length !== before) saveTapeCollection();
    }

    function clearTapeCassetteProfileReferences(profileIds) {
      const tapes = state.project?.tapes || state.tapeLayouts || [];
      let changed = false;
      for (const tape of tapes) {
        if (!tape?.cassetteProfileId || !profileIds.has(tape.cassetteProfileId)) continue;
        tape.cassetteProfileId = "";
        changed = true;
      }
      if (changed) markProjectDirty();
    }

    function getCassetteProfileById(id) {
      return loadCassetteProfiles().find(profile => profile.id === id) || null;
    }

    function getProfiledTapeInventory() {
      const counts = {};
      for (const item of state.tapeCollection) {
        const profile = getCassetteProfileById(item.cassetteProfileId);
        if (!profile) continue;
        const minutes = Number(profile.lengthMinutes);
        if (!Number.isFinite(minutes)) continue;
        counts[minutes] = (counts[minutes] || 0) + 1;
      }
      return counts;
    }

    function saveTapeCollection() {
      // Persist physical cassette ownership separately from profile definitions so the same cassette model can have many owned copies.
      localStorage.setItem(TAPE_COLLECTION_KEY, JSON.stringify(state.tapeCollection));
    }

    function restoreTapeCollection() {
      try {
        const saved = JSON.parse(localStorage.getItem(TAPE_COLLECTION_KEY) || "[]");
        state.tapeCollection = Array.isArray(saved) ? saved.filter(item => item && typeof item === "object" && typeof item.cassetteProfileId === "string") : [];
        removeAutoMigratedTapeCollectionItems();
      } catch {
        localStorage.removeItem(TAPE_COLLECTION_KEY);
        state.tapeCollection = [];
      }
    }

    function removeAutoMigratedTapeCollectionItems() {
      const before = state.tapeCollection.length;
      state.tapeCollection = state.tapeCollection.filter(item => !/^owned_tape_\d+_\d+_/.test(item.id || ""));
      if (state.tapeCollection.length !== before) {
        // Remove entries created by the short-lived automatic profile-to-collection migration so defaults return to zero owned cassettes.
        saveTapeCollection();
      }
    }

    function isLocalhost() {
      return location.hostname === "127.0.0.1" || location.hostname === "localhost";
    }

    function isTailscaleControlHost() {
      return location.protocol === "https:" && location.hostname.endsWith(".ts.net");
    }

    function applyHostMode() {
      if (isLocalhost()) return;
      if (isTailscaleControlHost()) {
        document.body.setAttribute("data-host-mode", "tailscale-control");
        el.clientSecretAdvanced.hidden = true;
        el.lanNotice.hidden = false;
        el.lanNotice.innerHTML = `Tailscale control host &mdash; add <code>${escapeHtml(REDIRECT_URI)}</code> as a Spotify redirect URI.`;
        return;
      }
      document.body.setAttribute("data-host-mode", "lan-monitor");
      // Plain LAN/IP hosts are monitor-only. OAuth control is allowed on
      // localhost, or on private Tailscale HTTPS hosts configured in Spotify.
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
      el.deckProfileSelect.addEventListener("change", selectDeckProfile);
      el.deckProfileName.addEventListener("change", updateDeckProfile);
      el.deckManufacturer.addEventListener("change", updateDeckProfile);
      el.deckModel.addEventListener("change", updateDeckProfile);
      el.deckAutoRecordingLevel.addEventListener("change", updateDeckProfile);
      el.deckAutoRecordingLevel.addEventListener("input", updateDeckProfile);
      el.leadInDelay.addEventListener("change", updateCalibration);
      el.leadInDelay.addEventListener("input", updateCalibration);
      el.motorLatency.addEventListener("change", updateCalibration);
      el.motorLatency.addEventListener("input", updateCalibration);
      el.safetyMargin.addEventListener("change", updateCalibration);
      el.safetyMargin.addEventListener("input", updateCalibration);
      el.deckDolbyNR.addEventListener("change", updateDeckProfile);
      el.deckTypeIISupport.addEventListener("change", updateDeckProfile);
      el.deckTypeIVSupport.addEventListener("change", updateDeckProfile);
      el.deckNotes.addEventListener("change", updateDeckProfile);
      el.addDeckProfileBtn.addEventListener("click", addDeckProfile);
      el.saveDeckProfileBtn.addEventListener("click", updateDeckProfile);
      el.deleteDeckProfileBtn.addEventListener("click", deleteActiveDeckProfile);
      el.deleteAllDeckProfilesBtn.addEventListener("click", deleteAllDeckProfiles);
      el.exportDeckProfileBtn.addEventListener("click", exportActiveDeckProfile);
      el.importDeckProfileBtn.addEventListener("click", () => el.importDeckProfileFile.click());
      el.importDeckProfileFile.addEventListener("change", event => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (file) importSingleProfile(file, "deck");
      });
      el.cassetteProfileSelect.addEventListener("change", selectCassetteProfile);
      el.cassetteProfileName.addEventListener("change", updateCassetteProfile);
      el.cassetteManufacturer.addEventListener("change", updateCassetteProfile);
      el.cassetteModel.addEventListener("change", updateCassetteProfile);
      el.cassetteProfileType.addEventListener("change", updateCassetteProfile);
      el.cassetteProfileLength.addEventListener("change", updateCassetteProfile);
      el.cassetteYear.addEventListener("change", updateCassetteProfile);
      el.cassetteYear.addEventListener("input", updateCassetteProfile);
      el.cassetteConditionNew.addEventListener("change", updateCassetteProfile);
      el.cassetteConditionUsed.addEventListener("change", updateCassetteProfile);
      el.cassetteConditionTestTape.addEventListener("change", updateCassetteProfile);
      el.cassetteLeaderLength.addEventListener("change", updateCassetteProfile);
      el.cassetteLeaderLength.addEventListener("input", updateCassetteProfile);
      el.cassetteSlackMargin.addEventListener("change", updateCassetteProfile);
      el.cassetteSlackMargin.addEventListener("input", updateCassetteProfile);
      el.addCassetteProfileBtn.addEventListener("click", addCassetteProfile);
      el.saveCassetteProfileBtn.addEventListener("click", updateCassetteProfile);
      el.deleteCassetteProfileBtn.addEventListener("click", deleteActiveCassetteProfile);
      el.deleteAllCassetteProfilesBtn.addEventListener("click", deleteAllCassetteProfiles);
      el.exportCassetteProfileBtn.addEventListener("click", exportActiveCassetteProfile);
      el.importCassetteProfileBtn.addEventListener("click", () => el.importCassetteProfileFile.click());
      el.importCassetteProfileFile.addEventListener("change", event => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (file) importSingleProfile(file, "cassette");
      });
      el.exportProfilesBtn.addEventListener("click", exportProfiles);
      el.importProfilesBtn.addEventListener("click", () => el.importProfilesFile.click());
      el.exportProfileFolderBtn.addEventListener("click", exportProfileFolder);
      el.importProfileFolderBtn.addEventListener("click", importProfileFolder);
      el.importProfilesFile.addEventListener("change", event => {
        // The hidden file input is read only after the user chooses an export JSON file.
        const file = event.target.files?.[0];
        event.target.value = "";
        if (file) importProfiles(file);
      });
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
      el.tapeInventory.addEventListener("click", updateTapeCollectionFromButton);
      el.deckChecklist.addEventListener("change", updateDeckChecklist);
      el.skipDeckChecklist.addEventListener("change", updateDeckChecklist);
      el.dryRunToggle.addEventListener("change", updateDryRun);
      el.startLevelToneBtn.addEventListener("click", startLevelTone);
      el.stopLevelToneBtn.addEventListener("click", stopLevelTone);
      window.addEventListener("beforeunload", flushTimingDependentViews);
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

    /**
     * Starts the Spotify OAuth PKCE authorization flow.
     *
     * It validates that the app is running from an HTTP(S) origin, generates a
     * PKCE verifier/challenge pair, stores the one-time verifier and OAuth
     * state for the callback, persists the client ID for later sessions, and
     * redirects the browser to Spotify Accounts for consent.
     *
     * @returns {Promise<void>} Resolves only when validation stops the flow; otherwise navigation leaves the page.
     * @throws {Error} May reject if the PKCE SHA-256 challenge cannot be generated.
     *
     * Side effects: Writes `pkce_verifier` and `oauth_state` to `sessionStorage`, writes `spotify_client_id` to `localStorage`, logs validation failures, and changes `location.href`.
     */
    async function login() {
      // Read the client ID from the input first so the authorization URL uses the latest user-entered Spotify app ID.
      const clientId = getClientId();
      // Spotify OAuth cannot complete from `file://` because registered redirect URIs must be HTTP(S).
      if (location.protocol === "file:") {
        log("Open http://127.0.0.1:8787 instead. Spotify OAuth cannot complete from a file:// page.");
        return;
      }
      // Without a client ID Spotify cannot identify this app at `/authorize`.
      if (!clientId) return log("Add your Spotify Client ID first.");
      // The verifier is a high-entropy one-time secret that proves this browser initiated the login.
      const verifier = base64Url(randomBytes(64));
      // Spotify requires the S256 code challenge, which is SHA-256(verifier) encoded as base64url.
      const challenge = await sha256Base64Url(verifier);
      // OAuth state is a separate CSRF token that must round-trip unchanged through Spotify's redirect.
      const oauthState = base64Url(randomBytes(18));
      // `pkce_verifier` is session-only because it is valid for just this pending authorization-code exchange.
      sessionStorage.setItem("pkce_verifier", verifier);
      // `oauth_state` is session-only so a later callback must match the login attempt from this tab.
      sessionStorage.setItem("oauth_state", oauthState);
      // `spotify_client_id` is durable convenience storage so reloads keep the same configured Spotify app.
      localStorage.setItem("spotify_client_id", clientId);

      // Build the Spotify Accounts authorize URL with playlist scopes and player-control scopes used by recording.
      const params = new URLSearchParams({
        // Authorization-code flow returns `code`, which `handleCallback` exchanges for tokens.
        response_type: "code",
        client_id: clientId,
        // Playlist scopes load/reorder playlists; playback scopes read state and issue play/pause commands.
        scope: REQUIRED_SCOPES.join(" "),
        // This redirect URI must exactly match the URI registered in the Spotify developer dashboard.
        redirect_uri: REDIRECT_URI,
        // Spotify returns this value unchanged so the callback can reject forged or stale responses.
        state: oauthState,
        // `S256` tells Spotify the challenge is SHA-256 based rather than a plain verifier.
        code_challenge_method: "S256",
        // The challenge binds the later token exchange to the verifier stored above.
        code_challenge: challenge
      });
      // Redirecting shows Spotify login/consent and ends the current app execution context.
      location.href = `https://accounts.spotify.com/authorize?${params}`;
    }

    /**
     * Handles Spotify's OAuth callback and stores the initial token state.
     *
     * It detects callback loads, extracts the authorization code, validates the
     * returned state against the session-stored CSRF value, exchanges the code
     * and PKCE verifier at Spotify Accounts, saves the returned tokens with a
     * fresh `authorizedAt` timestamp, and removes one-time query parameters.
     *
     * @returns {Promise<void>} Resolves after the callback is ignored, rejected, stored, or logged as failed.
     * @throws {Error} Does not intentionally throw; token exchange errors are caught and logged.
     *
     * Side effects: Reads and clears `pkce_verifier` and `oauth_state`, fetches `POST https://accounts.spotify.com/api/token`, writes `spotify_token`, mutates history, and logs status.
     */
    async function handleCallback() {
      // Ignore normal app loads; only `/callback` or a callback query should attempt token exchange.
      if (!location.pathname.replace(/\/$/, "").endsWith("/callback") && !new URLSearchParams(location.search).has("callback")) return;
      // Spotify returns OAuth response fields in the query string.
      const params = new URLSearchParams(location.search);
      // `code` is the short-lived authorization code exchanged at `/api/token`.
      const code = params.get("code");
      // `state` must match the value generated before redirect.
      const callbackState = params.get("state");
      // `oauth_state` is the CSRF token written by `login`.
      const expectedState = sessionStorage.getItem("oauth_state");
      // `pkce_verifier` proves this browser initiated the authorization request.
      const verifier = sessionStorage.getItem("pkce_verifier");
      // Spotify can redirect without a code on cancellation or error; leave the app disconnected.
      if (!code) return;
      // A missing verifier or mismatched state means this callback cannot be trusted or completed.
      if (!verifier || callbackState !== expectedState) {
        log("OAuth callback rejected: state or verifier was missing.");
        return;
      }
      try {
        // Build the x-www-form-urlencoded body required by `POST https://accounts.spotify.com/api/token`.
        const body = new URLSearchParams({
          // `authorization_code` exchanges the callback code for access and refresh tokens.
          grant_type: "authorization_code",
          code,
          redirect_uri: REDIRECT_URI,
          client_id: getClientId(),
          // Spotify validates this against the S256 challenge sent to `/authorize`.
          code_verifier: verifier
        });
        // `fetchAccounts` calls Spotify Accounts and throws `SpotifyAccountsError` on non-2xx responses.
        const data = await fetchAccounts(body);
        // Initial authorization writes a fresh `authorizedAt`; refreshes preserve that timestamp.
        saveToken(data, { initialAuthorization: true });
        // The verifier and OAuth state are one-time callback material and should not survive a successful exchange.
        clearSpotifyPkceStorage(sessionStorage);
        // Remove the one-time OAuth query parameters from the address bar after the token has been stored.
        history.replaceState({}, "", new URL(APP_BASE_URL).pathname);
        log("Spotify connected.");
      } catch (error) {
        log(`OAuth failed: ${error.message}`);
      }
    }

    /**
     * Clears the Spotify session and resets auth-dependent UI.
     *
     * It removes in-memory token fields, clears durable token/device storage
     * plus transient PKCE storage, clears any saved localhost client secret,
     * resets device state, rerenders auth controls, and logs the logout.
     *
     * @returns {void}
     * @throws {DOMException} May throw if browser storage cleanup fails.
     *
     * Side effects: Mutates `state`, deletes Spotify auth keys from browser storage, updates DOM controls, and writes a log entry.
     */
    function logout() {
      // Clear the bearer token immediately so no further Spotify Web API calls can be authorized.
      state.token = null;
      // Clear the refresh token so the app cannot silently mint a new access token after logout.
      state.refreshToken = null;
      // Reset expiry so restored state cannot look valid.
      state.expiresAt = 0;
      // Reset the original authorization timestamp because the user has explicitly ended the session.
      state.authorizedAt = null;
      // Remove `spotify_token`, `spotify_device_id`, `pkce_verifier`, and `oauth_state`.
      clearSpotifyAuthStorage(localStorage, sessionStorage);
      clearSavedClientSecret();
      resetDevices();
      renderAuth();
      log("Token cleared.");
    }

    /**
     * Restores persisted Spotify token state from localStorage.
     *
     * It parses the `spotify_token` bundle saved by `persistToken`, merges valid
     * token fields into app state, and deletes corrupt storage so future page
     * loads start from a clean disconnected state.
     *
     * @returns {void}
     * @throws {Error} Does not throw; JSON parse failures are caught.
     *
     * Side effects: Reads and may delete `spotify_token`; mutates token fields on `state`.
     */
    function restoreToken() {
      try {
        // `spotify_token` stores `{ token, refreshToken, expiresAt, authorizedAt }`.
        const saved = JSON.parse(localStorage.getItem("spotify_token") || "null");
        // Merge only after parsing succeeds so partial storage writes cannot corrupt defaults.
        if (saved) Object.assign(state, saved);
      } catch {
        // Remove corrupt token storage so startup can continue without repeated parse failures.
        localStorage.removeItem("spotify_token");
      }
    }

    /**
     * Persists the current Spotify token fields to localStorage.
     *
     * The stored object intentionally contains only auth state so playlist,
     * tape, and recording fields are not restored as part of the Spotify
     * session on a later page load.
     *
     * @returns {void}
     * @throws {DOMException} May throw if localStorage writes are blocked.
     *
     * Side effects: Writes `spotify_token` in `localStorage`.
     */
    function persistToken() {
      // Do not create `spotify_token` while disconnected; logout and expiry remove it instead.
      if (!state.token) return;
      // Store the token bundle under `spotify_token` so startup can resume an unexpired session.
      localStorage.setItem("spotify_token", JSON.stringify({
        token: state.token,
        refreshToken: state.refreshToken,
        expiresAt: state.expiresAt,
        // `authorizedAt` records the original login time and is preserved across refreshes.
        authorizedAt: state.authorizedAt
      }));
    }

    /**
     * Applies a Spotify Accounts token response to app state.
     *
     * It delegates token derivation to `buildTokenState`, preserving refresh
     * tokens and authorization time across refreshes, persists the token bundle,
     * and rerenders controls that depend on connection status.
     *
     * @param {object} data - Spotify Accounts token response from authorization-code or refresh-token grants.
     * @param {object} [options={}] - Token-state options passed through to `buildTokenState`.
     * @returns {void}
     * @throws {DOMException} May throw if token persistence fails.
     *
     * Side effects: Mutates `state`, writes `spotify_token`, and rerenders authentication UI.
     */
    function saveToken(data, options = {}) {
      // `buildTokenState` computes expiry, preserves refresh token when Spotify omits it, and manages `authorizedAt`.
      Object.assign(state, buildTokenState(data, state, options));
      persistToken();
      renderAuth();
    }

    /**
     * Refreshes the Spotify access token using the stored refresh token.
     *
     * It posts a refresh-token grant to Spotify Accounts, stores the returned
     * access token while preserving `authorizedAt`, clears recovery text on
     * success, and handles terminal `invalid_grant` by expiring local session
     * state and starting PKCE re-login.
     *
     * @returns {Promise<void>} Resolves after a fresh token has been persisted.
     * @throws {Error|SpotifyAccountsError} Throws when no refresh token exists, refresh fails, or the session is terminally expired.
     *
     * Side effects: Fetches `POST https://accounts.spotify.com/api/token`, mutates token state, writes/removes auth storage, may call `login`, updates recovery UI, and logs status.
     */
    async function refreshAccessToken() {
      // A missing refresh token means this session cannot be renewed without a full PKCE login.
      if (!state.refreshToken) {
        setPlaybackRecovery("Spotify login expired. Reconnect Spotify, then refresh devices before recording.");
        throw new Error("Token expired. Connect Spotify again.");
      }
      // Build the x-www-form-urlencoded refresh-token grant required by Spotify Accounts.
      const body = new URLSearchParams({
        grant_type: "refresh_token",
        // Spotify may return HTTP 400 `invalid_grant` if this token expired, was revoked, or is otherwise unusable.
        refresh_token: state.refreshToken,
        client_id: getClientId()
      });
      try {
        // `fetchAccounts` wraps non-2xx token responses as `SpotifyAccountsError`.
        const data = await fetchAccounts(body);
        // Refresh responses usually omit `refresh_token`; `saveToken` preserves the previous token and `authorizedAt`.
        saveToken(data);
        setPlaybackRecovery("");
        log("Spotify token refreshed.");
      } catch (error) {
        // A 400 invalid_grant here is terminal; retrying the same refresh token cannot recover the session.
        if (isInvalidGrantError(error)) {
          // Clear state plus `spotify_token`, `spotify_device_id`, `pkce_verifier`, and `oauth_state`.
          const message = expireSpotifySession({ state, localStorage, sessionStorage });
          resetDevices();
          renderAuth();
          setPlaybackRecovery(message);
          log(message);
          // Re-login trigger: `login` creates a fresh PKCE verifier/challenge and redirects to Spotify consent.
          await login();
          // Stop the caller's current Spotify operation after the re-login redirect has been started.
          throw new Error(message);
        }
        setPlaybackRecovery("Spotify login expired. Reconnect Spotify, then refresh devices before recording.");
        throw error;
      }
    }

    /**
     * Calls the Spotify Web API with the current bearer token.
     *
     * It refreshes expired tokens before sending a request, retries once after
     * a 401 when a refresh token exists, returns `null` for successful 204
     * responses, converts player/device failures into recording guidance, and
     * throws `SpotifyApiError` for other non-2xx responses.
     *
     * @param {string} path - Spotify Web API path beginning with `/`.
     * @param {RequestInit} [options={}] - Fetch options such as method, body, and extra headers.
     * @returns {Promise<object|null>} Parsed JSON response, or `null` for HTTP 204 success.
     * @throws {Error|SpotifyApiError|SpotifyAccountsError} Throws when disconnected, refresh fails, no active device exists, or Spotify returns a non-2xx response.
     *
     * Side effects: May refresh and persist tokens, fetches `https://api.spotify.com/v1`, updates playback recovery messages, and may start PKCE re-login through `refreshAccessToken`.
     */
    async function spotifyFetch(path, options = {}) {
      const { retryAttempted = false, ...fetchOptions } = options;
      // All Spotify Web API calls require a bearer token obtained from Spotify Accounts.
      if (!state.token) throw new Error("Connect Spotify first.");
      // Refresh before the request if the locally stored expiry timestamp has passed.
      if (Date.now() > state.expiresAt) await refreshAccessToken();
      // Prefix app-relative API paths with the Spotify Web API origin.
      const response = await fetch(`https://api.spotify.com/v1${path}`, {
        ...fetchOptions,
        headers: {
          // `Authorization: Bearer` carries the access token for the scopes granted during PKCE login.
          "Authorization": `Bearer ${state.token}`,
          // JSON is used for playlist reorder payloads and Spotify player command payloads.
          "Content-Type": "application/json",
          ...(fetchOptions.headers || {})
        }
      });
      // A 401 from the Web API can mean the access token expired earlier than expected; refresh once and retry.
      if (response.status === 401 && state.refreshToken && !retryAttempted) {
        await refreshAccessToken();
        return spotifyFetch(path, { ...fetchOptions, retryAttempted: true });
      }
      // Spotify playback-control endpoints commonly return 204 No Content on success.
      if (response.status === 204) {
        if (state.rateLimit.active && !state.rateLimit.bufferedCall) clearRateLimitState();
        return null;
      }
      // Parse JSON if available; some Spotify error responses can be empty.
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        // Spotify Web API errors usually put the actionable reason in `error.message`.
        const message = data?.error?.message || response.statusText;
        // Player endpoints require an active Spotify Connect device and `user-modify-playback-state`.
        if (/NO_ACTIVE_DEVICE|Player command failed/i.test(message)) {
          setPlaybackRecovery("Device asleep. Open Spotify on your target device and play any song to wake it up, then retry.");
          throw new Error("No active Spotify device found. Open Spotify on desktop/mobile, click Device Refresh, select the device, then try again.");
        }
        // A second 401 after refresh means the user must reconnect before recording can continue.
        if (response.status === 401) {
          setPlaybackRecovery("Spotify login expired. Reconnect Spotify, then retry recording.");
        }
        // Spotify returned 429; read Retry-After with a 5 s fallback, exclude the token endpoint by keeping this logic inside the Web API wrapper, retry only once outside active recording, and buffer playback commands during active recording so tape countdowns keep running.
        if (response.status === 429) {
          return handleRateLimit(path, fetchOptions, response, data, { retryAttempted });
        }
        // Preserve response metadata for callers and tests that need status-specific handling.
        throw new SpotifyApiError(message, response, data);
      }
      if (state.rateLimit.active && !state.rateLimit.bufferedCall) clearRateLimitState();
      return data;
    }

    /**
     * Handles Spotify Web API rate limits for normal and recording flows.
     *
     * It reads Spotify's `Retry-After` header with a 5 second fallback, starts
     * the visible countdown banner, disables start/refresh controls while the
     * countdown runs, retries non-recording requests once after the wait, and
     * buffers active-recording playback commands so they can replay only if
     * the same recording side is still active. Requests to Spotify Accounts
     * token endpoints are excluded because those calls use `fetchAccounts()`,
     * not this Web API wrapper.
     *
     * @param {string} path - Spotify Web API path that received HTTP 429.
     * @param {RequestInit} options - Fetch options for the failed request.
     * @param {Response} response - Spotify 429 response containing optional `Retry-After`.
     * @param {object|null} data - Parsed Spotify error body, when available.
     * @param {object} [context={}] - Retry context.
     * @param {boolean} [context.retryAttempted=false] - Whether this request already used its one automatic non-recording retry.
     * @returns {Promise<object|null>} Retried response outside recording, buffered-command placeholder during recording, or rejection on final 429.
     * @throws {SpotifyApiError} Throws when a non-recording retry has already failed or a non-bufferable recording request is rate limited.
     *
     * Side effects: Mutates rate-limit state, starts/stops countdown timers, disables/re-enables controls, updates readiness and recording status, may replay a buffered Spotify command, and logs status.
     */
    async function handleRateLimit(path, options, response, data, { retryAttempted = false } = {}) {
      const retryAfterSeconds = Math.max(1, Number(response.headers.get("Retry-After") || 5) || 5);
      const error = new SpotifyApiError(data?.error?.message || response.statusText || "Spotify rate limit", response, data);
      const recording = isActiveRecordingSide();
      const bufferable = recording && isPlaybackCommand(path, options);
      startRateLimitCountdown(retryAfterSeconds, bufferable ? "recording" : "normal");
      if (bufferable) {
        const side = state.activeRecordSide;
        // Store the failed playback command and the side it belongs to; replay only while that side is still actively recording.
        state.rateLimit.bufferedCall = { path, options, side };
        setPlaybackRecovery(`Spotify rate limited - playback command will retry in ${retryAfterSeconds}s.`);
        el.recordMonitor.textContent = `⚠️ Spotify rate limited - playback command will retry in ${retryAfterSeconds}s`;
        log(`Spotify rate limit hit during Side ${side}. Playback command will retry in ${retryAfterSeconds}s.`);
        scheduleBufferedPlaybackReplay(retryAfterSeconds);
        return null;
      }
      if (recording) {
        state.rateLimit.error = "429 in progress";
        setPlaybackRecovery(`Spotify rate limited - monitoring will retry in ${retryAfterSeconds}s.`);
        throw error;
      }
      if (retryAttempted) {
        state.rateLimit.error = "Non-retryable rate limit";
        renderRateLimitState();
        throw error;
      }
      await wait(retryAfterSeconds * 1000);
      try {
        const result = await spotifyFetch(path, { ...options, retryAttempted: true });
        clearRateLimitState();
        return result;
      } catch (retryError) {
        state.rateLimit.error = retryError instanceof SpotifyApiError && retryError.status === 429 ? "Non-retryable rate limit" : state.rateLimit.error;
        renderRateLimitState();
        throw retryError;
      }
    }

    function startRateLimitCountdown(seconds, mode) {
      if (state.rateLimit.timerId) clearInterval(state.rateLimit.timerId);
      state.rateLimit.active = true;
      state.rateLimit.error = "";
      state.rateLimit.retryAfterSeconds = seconds;
      state.rateLimit.secondsRemaining = seconds;
      // The Retry-After countdown ticks once per second and re-enables Start/Refresh controls when the rate-limit state clears.
      state.rateLimit.timerId = setInterval(() => {
        state.rateLimit.secondsRemaining = Math.max(0, state.rateLimit.secondsRemaining - 1);
        if (state.rateLimit.secondsRemaining === 0) {
          finishRateLimitCountdown();
        }
        renderRateLimitState();
      }, 1000);
      setPlaybackRecovery(`Spotify rate limit reached - retrying in ${seconds}s.`);
      log(mode === "recording" ? `Spotify rate limit reached during recording. Retrying command in ${seconds}s.` : `Spotify rate limit reached. Retrying in ${seconds}s.`);
      renderRateLimitState();
    }

    function scheduleBufferedPlaybackReplay(seconds) {
      window.setTimeout(async () => {
        const buffered = state.rateLimit.bufferedCall;
        if (!buffered) return;
        state.rateLimit.bufferedCall = null;
        if (!isActiveRecordingSide() || state.activeRecordSide !== buffered.side) {
          // Discard buffered playback commands after the side ends so a late retry cannot disturb the next side or idle state.
          log("Discarded buffered Spotify command because the recording side ended.");
          clearRateLimitState();
          return;
        }
        try {
          // Replay the buffered playback command only while the original side is still active.
          await spotifyFetch(buffered.path, buffered.options);
          clearRateLimitState();
          log("Replayed buffered Spotify playback command after rate limit.");
        } catch (error) {
          finishRateLimitCountdown();
          state.rateLimit.error = error.message;
          renderRateLimitState();
          log(`Buffered Spotify command failed: ${error.message}`);
        }
      }, seconds * 1000);
    }

    function clearRateLimitState() {
      if (state.rateLimit.timerId) clearInterval(state.rateLimit.timerId);
      state.rateLimit.active = false;
      state.rateLimit.secondsRemaining = 0;
      state.rateLimit.retryAfterSeconds = 0;
      state.rateLimit.timerId = null;
      state.rateLimit.bufferedCall = null;
      state.rateLimit.error = "";
      setPlaybackRecovery("");
      renderRecordMode();
      renderRateLimitState();
    }

    function finishRateLimitCountdown() {
      if (state.rateLimit.timerId) clearInterval(state.rateLimit.timerId);
      state.rateLimit.active = false;
      state.rateLimit.secondsRemaining = 0;
      state.rateLimit.retryAfterSeconds = 0;
      state.rateLimit.timerId = null;
      renderRecordMode();
    }

    function renderRateLimitState() {
      if (!el.rateLimitBanner) return;
      const active = state.rateLimit.active;
      // The banner appears while Spotify's Retry-After countdown is active and disappears once retry/replay finishes or the request is discarded.
      el.rateLimitBanner.hidden = !active && !state.rateLimit.error;
      el.rateLimitBanner.textContent = active
        ? `Spotify rate limit reached - retrying in ${state.rateLimit.secondsRemaining} s`
        : state.rateLimit.error || "";
      [el.startA, el.startB, el.loadDevicesBtn, el.loadPlaylistsBtn].forEach(control => {
        if (!control) return;
        // Start and refresh controls stay disabled during the countdown so the app does not add more Spotify requests while waiting.
        if (active) control.disabled = true;
      });
      if (!active) {
        el.loadDevicesBtn.disabled = !state.token;
        el.loadPlaylistsBtn.disabled = !state.token;
      }
      renderReadiness();
    }

    function isActiveRecordingSide() {
      return state.recordMode === "recording_a" || state.recordMode === "recording_b";
    }

    function isPlaybackCommand(path, options = {}) {
      const method = String(options.method || "GET").toUpperCase();
      return method !== "GET" && path.startsWith("/me/player");
    }

    function wait(ms) {
      return new Promise(resolve => setTimeout(resolve, ms));
    }

    function simulateDryRunRateLimit() {
      const retryAfterSeconds = 5;
      simulateDryRunAction("Simulated Spotify 429 during Side A countdown; no Spotify endpoint was called.");
      startRateLimitCountdown(retryAfterSeconds, "normal");
      window.setTimeout(() => {
        if (state.rateLimit.active && state.dryRun) clearRateLimitState();
      }, retryAfterSeconds * 1000);
    }

    /**
     * Starts or resumes Spotify playback on the selected device.
     *
     * It optionally targets the selected Spotify Connect device, delegates the
     * actual `PUT /me/player/play` call through `spotifyFetch`, and records the
     * command timestamp so polling does not over-correct while Spotify catches
     * up.
     *
     * @param {RequestInit} [options={ method: "PUT" }] - Fetch options for `PUT /me/player/play`, including optional JSON body.
     * @returns {Promise<object|null>} Spotify response body, or `null` for normal 204 success.
     * @throws {Error|SpotifyApiError|SpotifyAccountsError} Throws when auth refresh fails or Spotify rejects playback.
     *
     * Side effects: Calls `PUT https://api.spotify.com/v1/me/player/play`, mutates `state.lastPlaybackCommandAt`, and may update recovery UI.
     */
    async function playSpotify(options = { method: "PUT" }) {
      // `device_id` routes playback to the selected Spotify Connect device when one is configured.
      const deviceQuery = state.selectedDeviceId ? `?device_id=${encodeURIComponent(state.selectedDeviceId)}` : "";
      // `PUT /me/player/play` requires `user-modify-playback-state`; body fields can include `uris`, `offset`, and `position_ms`.
      const result = await spotifyFetch(`/me/player/play${deviceQuery}`, options);
      // Polling uses this timestamp to avoid treating delayed Spotify state updates as immediate drift.
      state.lastPlaybackCommandAt = Date.now();
      return result;
    }

    /**
     * Normalizes Spotify playback order before recording.
     *
     * It disables shuffle and repeat so direct playback follows the cassette
     * plan exactly. Failures are logged but not fatal because some restricted
     * devices may reject one setting while still accepting direct URI playback.
     *
     * @returns {Promise<void>} Resolves after both playback-order attempts complete.
     * @throws {Error} Does not rethrow endpoint failures; individual failures are logged.
     *
     * Side effects: Calls Spotify player shuffle and repeat endpoints and writes log messages on failure.
     */
    async function preparePlaybackOrder() {
      // Spotify uses `&device_id=` here because `state=false` or `state=off` already starts the query string.
      const deviceQuery = state.selectedDeviceId ? `&device_id=${encodeURIComponent(state.selectedDeviceId)}` : "";
      try {
        // `PUT /me/player/shuffle` requires `user-modify-playback-state` and prevents random track order during recording.
        await spotifyFetch(`/me/player/shuffle?state=false${deviceQuery}`, { method: "PUT" });
      } catch (error) {
        log(`Could not disable shuffle: ${error.message}`);
      }
      try {
        // `PUT /me/player/repeat` requires `user-modify-playback-state` and prevents a side from looping after completion.
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

    /**
     * Posts a token grant request to Spotify Accounts.
     *
     * It sends an `application/x-www-form-urlencoded` body to
     * `https://accounts.spotify.com/api/token`, optionally adds HTTP Basic
     * auth for localhost client-secret testing, parses the JSON response, and
     * throws `SpotifyAccountsError` for non-2xx responses so refresh callers
     * can detect `invalid_grant`.
     *
     * @param {URLSearchParams} body - Token endpoint form body for authorization-code or refresh-token grants.
     * @returns {Promise<object>} Parsed Spotify Accounts token response.
     * @throws {SpotifyAccountsError} Throws when Spotify Accounts returns a non-2xx token response.
     *
     * Side effects: Fetches `POST https://accounts.spotify.com/api/token`; reads the local client-secret input when localhost mode is enabled.
     */
    async function fetchAccounts(body) {
      // Spotify Accounts requires form-encoded grant bodies for `/api/token`.
      const headers = { "Content-Type": "application/x-www-form-urlencoded" };
      // The client secret is only read on localhost to avoid exposing confidential credentials on LAN or public hosts.
      const secret = getClientSecret();
      if (secret) {
        // Confidential-client testing uses HTTP Basic auth with `base64(client_id:client_secret)`.
        const clientId = getClientId();
        headers["Authorization"] = `Basic ${btoa(`${clientId}:${secret}`)}`;
      }
      // `POST /api/token` returns access/refresh token fields or a Spotify Accounts error object.
      const response = await fetch("https://accounts.spotify.com/api/token", {
        method: "POST",
        headers,
        body
      });
      // Parse JSON if possible; malformed or empty error bodies still become a typed accounts error below.
      const data = await response.json().catch(() => null);
      // Throw the typed wrapper so `refreshAccessToken` can detect HTTP 400 `invalid_grant` as terminal.
      if (!response.ok) throw new SpotifyAccountsError(data?.error_description || data?.error || "Spotify auth error", response, data);
      return data;
    }

    async function loadPlaylist() {
      try {
        if (blockIfRecordingLocked("Load playlist")) return;
        if (!(await confirmReplaceDirtyProject())) return;
        const playlistId = getRequestedPlaylistId();
        if (!playlistId) throw new Error("Paste a Spotify playlist URL or ID.");
        log(`Loading playlist ${playlistId}...`);
        const playlist = await spotifyFetch(`/playlists/${playlistId}?fields=name,images(url,width,height),tracks(total)`);
        const playlistName = playlist.name || playlistId;
        const coverUrl = pickPlaylistCover(playlist.images || []);
        const tracks = await fetchAllTracks(playlistId);
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
        log(tracks.length
          ? `Loaded ${tracks.length} tracks from ${playlistName}.`
          : `Loaded playlist metadata for ${playlistName}, but Spotify returned no usable track items.`
        );
      } catch (error) {
        log(error.message);
        renderEmptyStates();
      }
    }

    function getRequestedPlaylistId() {
      return parsePlaylistId(el.playlistInput.value.trim()) || parsePlaylistId(el.playlistSelect.value.trim());
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
          state.selectedDeviceId = "";
        }
        persistSelectedDevice();
        const checklistChanged = syncAutomaticDeckChecklistItems();
        renderDeviceOptions();
        if (checklistChanged) renderRecordMode();
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
            tracks: getPlaylistTrackTotal(playlist),
            public: playlist.public
          });
        }
        url = page.next ? page.next.replace("https://api.spotify.com/v1", "") : "";
      }
      return playlists;
    }

    function getPlaylistTrackTotal(playlist) {
      if (Number.isFinite(playlist?.tracks?.total)) return playlist.tracks.total;
      if (Number.isFinite(playlist?.items?.total)) return playlist.items.total;
      return null;
    }

    function selectUserPlaylist() {
      if (blockIfRecordingLocked("Playlist selection")) {
        renderPlaylistOptions();
        return;
      }
      const selected = state.playlists.find(playlist => playlist.id === el.playlistSelect.value);
      if (!selected) return;
      el.playlistInput.value = selected.id;
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
      const checklistChanged = syncAutomaticDeckChecklistItems();
      if (checklistChanged) renderRecordMode();
      renderReadiness();
      renderRecordMode();
      log(selected ? `Selected Spotify device: ${selected.name}.` : "No Spotify device selected.");
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
      const sources = [
        `/playlists/${playlistId}/items?limit=100&fields=items(track(id,uri,name,duration_ms,artists(name),is_local,type)),next,total`,
        `/playlists/${playlistId}/items?limit=100&fields=items(item(id,uri,name,duration_ms,artists(name),is_local,type)),next,total`,
        `/playlists/${playlistId}?fields=tracks(total,next,items(track(id,uri,name,duration_ms,artists(name),is_local,type)))`,
        `/playlists/${playlistId}?fields=items(total,next,items(item(id,uri,name,duration_ms,artists(name),is_local,type)))`,
        `/playlists/${playlistId}/tracks?limit=100&fields=items(track(id,uri,name,duration_ms,artists(name),is_local,type)),next,total&additional_types=track`
      ];
      let receivedItems = 0;
      let blockedBySpotify = false;

      for (const url of sources) {
        const result = await fetchTracksFromPlaylistContainer(url);
        if (result.tracks.length) return result.tracks;
        receivedItems += result.receivedItems;
        blockedBySpotify = blockedBySpotify || result.blocked;
      }

      if (receivedItems > 0) {
        throw new Error(`Spotify returned ${receivedItems} playlist items, but none were usable Spotify tracks.`);
      }

      if (blockedBySpotify) return [];
      return [];
    }

    async function fetchTracksFromPlaylistContainer(startUrl) {
      const tracks = [];
      let receivedItems = 0;
      let blocked = false;
      let url = startUrl;

      while (url) {
        let page;
        try {
          page = await spotifyFetch(url);
        } catch (error) {
          if (!(error instanceof SpotifyApiError) || error.status !== 403) throw error;
          blocked = true;
          break;
        }
        const container = getPlaylistItemsContainer(page);
        const items = Array.isArray(container.items) ? container.items : [];
        receivedItems += items.length;

        for (const item of items) {
          const track = normalizePlaylistTrackItem(item);
          if (track) tracks.push(track);
        }

        url = container.next ? container.next.replace("https://api.spotify.com/v1", "") : "";
      }

      return { tracks, receivedItems, blocked };
    }

    function getPlaylistItemsContainer(page) {
      if (Array.isArray(page?.items)) return page;
      return page?.tracks || page?.items || page || {};
    }

    function normalizePlaylistTrackItem(item) {
      const candidates = [item?.track, item?.item, item].filter(Boolean);
      const track = candidates.find(candidate =>
        candidate?.type === "track" ||
        String(candidate?.uri || "").startsWith("spotify:track:") ||
        Number.isFinite(Number(candidate?.duration_ms))
      );

      if (!track || track.is_local || !track.uri) return null;

      const durationMs = Number(track.duration_ms);
      if (!Number.isFinite(durationMs) || durationMs <= 0) return null;

      return {
        id: track.id || String(track.uri).replace("spotify:track:", ""),
        uri: track.uri,
        name: track.name || "Untitled track",
        artists: (track.artists || [])
          .map(artist => typeof artist === "string" ? artist : artist?.name)
          .filter(Boolean)
          .join(", ") || "Unknown artist",
        duration_ms: durationMs
      };
    }

    /**
     * Recomputes the cassette tape and side split plan.
     *
     * When a project exists, it rebuilds the tape layouts from the current
     * source tracks and tape formats, then reapplies saved manual split choices
     * plus J-card metadata. Without a project, it computes a single-layout
     * fallback from the loaded tracks and current tape length.
     *
     * @returns {void}
     * @throws {Error} May throw if the underlying tape-planning helpers receive invalid track or format data.
     *
     * Side effects: Mutates project tapes, split mode, selected tape index, timing progress fields, and timer state.
     */
    function computeSplit() {
      if (state.project) {
        // Preserve per-tape formats so rebuilding the plan does not collapse a mixed C60/C90 project.
        const existingTapes = state.project.tapes || [];
        const formats = existingTapes.map(tape => tape.tapeFormat || tape.tapeMinutes || state.tapeMinutes);
        // Manual split and J-card data are user edits; save them before rebuilding automatic layouts.
        const manualSplits = existingTapes.map(tape => ({
          splitMode: tape.splitMode,
          manualSplitIndex: tape.manualSplitIndex,
          jCard: tape.jCard,
          tapeTitle: tape.tapeTitle,
          cassetteProfileId: tape.cassetteProfileId || ""
        }));
        // The split helper preserves original playlist order and never cuts a track across tape sides.
        state.project.tapes = buildProjectTapes(state.project, state.tapeMinutes, formats);
        state.project.tapes.forEach((tape, index) => {
          if (manualSplits[index]?.jCard) tape.jCard = manualSplits[index].jCard;
          if (manualSplits[index]?.tapeTitle) tape.tapeTitle = manualSplits[index].tapeTitle;
          if (manualSplits[index]?.cassetteProfileId) tape.cassetteProfileId = manualSplits[index].cassetteProfileId;
          if (manualSplits[index]?.splitMode === "manual") {
            // Reapply the manual split after rebuilding so the user's chosen side boundary remains locked.
            applyManualSplitToLayout(tape, manualSplits[index].manualSplitIndex);
          }
        });
        state.project.splitMode = state.project.tapes.some(tape => tape.splitMode === "manual") ? "manual" : "automatic";
        state.project.selectedTapeIndex = clampTapeIndex(state.selectedTapeIndex, state.project.tapes.length);
        syncStateFromProject();
      } else {
        // Side capacity is half the cassette length plus any user-accepted unofficial slack.
        const halfMs = state.tapeMinutes * 60 * 1000 / 2 + getSlackMarginMs();
        // The fallback layout uses the selected format only and preserves track order across sides.
        state.tapeLayouts = splitTracksIntoTapesByFormats(state.tracks, [state.tapeMinutes], state.tapeMinutes, getSlackMarginMs());
        state.selectedTapeIndex = clampTapeIndex(state.selectedTapeIndex, state.tapeLayouts.length);
        // `splitTracksForSide` returns the first track index for Side B; tracks are moved whole, never split.
        state.splitIndex = selectedTapeLayout()?.sideBStartIndex || splitTracksForSide(state.tracks, halfMs).split;
      }
      // Reset recording progress because a changed split invalidates any previous side timing.
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
        const uris = plannedRecordingTracks().map(track => track.uri);
        const confirmed = await confirmPlaylistReorder(uris.length);
        if (!confirmed) return;
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

    function confirmPlaylistReorder(trackCount = 0) {
      return showConfirmOverlay(
        `
          <div class="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="applyConfirmTitle">
            <h3 id="applyConfirmTitle">Apply cassette order to Spotify?</h3>
            <p>This will replace the remote playlist sequence with the current full multi-tape plan.</p>
            ${trackCount > 100 ? "<p>Large playlists are written to Spotify in batches; keep a backup in case a later batch fails.</p>" : ""}
            <div class="confirm-actions">
              <button type="button" data-confirm-action="cancel">Cancel</button>
              <button type="button" data-confirm-action="backup">Export Backup</button>
              <button type="button" class="warn" data-confirm-action="continue">Continue Anyway</button>
            </div>
          </div>
        `,
        (action, finish) => {
          if (action === "cancel") finish(false);
          if (action === "backup") {
            exportTapeConfig();
            log("Backup exported. Spotify playlist order was not changed.");
            finish(false);
          }
          if (action === "continue") finish(true);
        }
      );
    }

    function confirmReplaceDirtyProject() {
      if (!state.project || !state.projectDirty) return Promise.resolve(true);
      return showConfirmOverlay(
        `
          <div class="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="replaceConfirmTitle">
            <h3 id="replaceConfirmTitle">Replace unsaved cassette project?</h3>
            <p>The current plan has local changes. Export a backup before replacing it, or continue and discard those edits.</p>
            <div class="confirm-actions">
              <button type="button" data-confirm-action="cancel">Cancel</button>
              <button type="button" data-confirm-action="backup">Export Backup</button>
              <button type="button" class="warn" data-confirm-action="replace">Replace Anyway</button>
            </div>
          </div>
        `,
        (action, finish) => {
          if (action === "cancel") finish(false);
          if (action === "backup") {
            exportTapeConfig();
            log("Backup exported. Current project was not replaced.");
            finish(false);
          }
          if (action === "replace") finish(true);
        }
      );
    }

    function showConfirmOverlay(markup, handleAction) {
      if (state.pendingConfirmClose) state.pendingConfirmClose(false);
      const existing = document.querySelector(".confirm-overlay");
      if (existing) existing.remove();
      return new Promise(resolve => {
        const overlay = document.createElement("div");
        overlay.className = "confirm-overlay";
        overlay.innerHTML = markup;
        document.body.append(overlay);
        const finish = value => {
          if (state.pendingConfirmClose === finish) state.pendingConfirmClose = null;
          overlay.remove();
          resolve(value);
        };
        state.pendingConfirmClose = finish;
        overlay.addEventListener("click", event => {
          if (event.target === overlay) {
            finish(false);
            return;
          }
          const action = event.target?.dataset?.confirmAction;
          if (action) handleAction(action, finish);
        });
        overlay.querySelector("[data-confirm-action='cancel']").focus();
      });
    }

    function markProjectDirty() {
      if (state.project) state.projectDirty = true;
    }

    /**
     * Starts or resumes the Side A recording flow.
     *
     * It validates the selected side, runs preflight checks, performs the
     * record cue countdown, optionally disables shuffle/repeat, starts Spotify
     * playback from Side A track 1, and begins timer and playback polling.
     *
     * @returns {Promise<void>} Resolves after recording has started or the failure path has restored idle/paused state.
     * @throws {Error} Does not intentionally throw; start errors are caught, logged, and reflected in UI state.
     *
     * Side effects: Mutates recording state, updates cue/current-track DOM, calls Spotify player endpoints, starts timers, and logs status.
     */
    async function startSideA() {
      let resuming = false;
      try {
        // A physical tape side cannot start without at least one whole track assigned to that side.
        if (!sideA().length) throw new Error("Side A has no tracks.");
        resuming = state.recordMode === "paused" && state.activeRecordSide === "A";
        // Recording may only start when every Recording Readiness row is green.
        assertRecordingReadinessReady("A");
        // Preflight blocks missing auth/device data, unplayable URIs, unchecked deck setup, and side overflows.
        runRecordingPreflight("A", sideA());
        el.flipBanner.classList.remove("show");
        state.recordMode = "cue_a";
        state.activeRecordSide = "A";
        if (!resuming) {
          // Fresh starts reset elapsed tracking; resumes keep elapsed time accumulated before pause.
          state.sideAElapsedBeforePause = 0;
          state.spotifySideElapsedMs = 0;
          state.lastSideProgressMs = 0;
        }
        state.autoPauseDone = false;
        // The cue gives the operator time to release record/pause before Spotify starts.
        if (!(await runRecordCue("A"))) return;
        state.recordMode = "recording_a";
        state.lastProgressUpdatedAt = Date.now();
        state.sideAStartedAt = Date.now();
      el.currentTrack.textContent = state.dryRun
        ? (resuming ? "Dry Run: resuming Side A timer." : "Dry Run: Side A timer started.")
        : (resuming ? "Resuming Side A..." : "Starting Side A from track 1...");
      if (!state.dryRun) {
        // Shuffle/repeat are disabled only for a fresh side start; resume should not disturb current playback order.
        if (!resuming) await preparePlaybackOrder();
        // Fresh Side A starts from the first URI; resume simply sends play to continue the paused device.
        await playSpotify(resuming ? { method: "PUT" } : buildSidePlaybackPayload(sideA(), 0, 0));
      } else {
        // Dry Run skips `PUT /me/player/shuffle`, `PUT /me/player/repeat`, and `PUT /me/player/play`; the UI log records the simulated side start instead.
        simulateDryRunAction(resuming ? "Would resume Spotify playback for Side A." : "Would disable shuffle/repeat and start Spotify playback for Side A.");
      }
      // Dry Run intentionally keeps the physical recording timer at real speed so the operator can rehearse the full flow.
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

    /**
     * Starts or resumes the Side B recording flow.
     *
     * It mirrors Side A startup using the current Side B track list and side-B
     * playlist offset, then starts Spotify playback/timing after the cue
     * countdown so the user can flip and arm the cassette deck.
     *
     * @returns {Promise<void>} Resolves after recording has started or the failure path has restored flip/paused state.
     * @throws {Error} Does not intentionally throw; start errors are caught, logged, and reflected in UI state.
     *
     * Side effects: Mutates recording state, updates cue/current-track DOM, calls Spotify player endpoints, starts timers, and logs status.
     */
    async function startSideB() {
      let resuming = false;
      try {
        // Side B may be empty when the selected tape uses only Side A.
        if (!sideB().length) throw new Error("Side B has no tracks.");
        resuming = state.recordMode === "paused" && state.activeRecordSide === "B";
        // Recording may only start when every Recording Readiness row is green.
        assertRecordingReadinessReady("B");
        // Preflight enforces playable URI data and side capacity before the physical tape starts rolling.
        runRecordingPreflight("B", sideB());
        el.flipBanner.classList.remove("show");
        state.recordMode = "cue_b";
        state.activeRecordSide = "B";
        if (!resuming) {
          // Side B gets its own elapsed baseline because the flip physically starts a new cassette side.
          state.spotifySideElapsedMs = 0;
          state.sideAElapsedBeforePause = 0;
          state.lastSideProgressMs = 0;
        }
        state.autoPauseDone = false;
        if (!(await runRecordCue("B"))) return;
        state.recordMode = "recording_b";
        state.lastProgressUpdatedAt = Date.now();
        state.sideAStartedAt = Date.now();
      el.currentTrack.textContent = state.dryRun
        ? (resuming ? "Dry Run: resuming Side B timer." : "Dry Run: Side B timer started.")
        : (resuming ? "Resuming Side B..." : `Starting Side B from track ${sideBStartNumber()}...`);
      if (!state.dryRun) {
        // Fresh Side B starts playback from the first Side B URI in the side-local payload.
        if (!resuming) await preparePlaybackOrder();
        await playSpotify(resuming ? { method: "PUT" } : buildSidePlaybackPayload(sideB(), 0, 0));
      } else {
        // Dry Run skips `PUT /me/player/shuffle`, `PUT /me/player/repeat`, and `PUT /me/player/play`; the UI log records the simulated side start instead.
        simulateDryRunAction(resuming ? "Would resume Spotify playback for Side B." : "Would disable shuffle/repeat and start Spotify playback for Side B.");
      }
      // Dry Run intentionally keeps the physical recording timer at real speed so the operator can rehearse the full flow.
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

    /**
     * Runs the pre-record countdown for a cassette side.
     *
     * It clears any previous cue, displays the current side and remaining
     * seconds, logs the operator prompt, and resolves when the interval reaches
     * zero so Spotify playback or the dry-run timer can start. If the user
     * aborts or another cue replaces it, the promise resolves `false`.
     *
     * @param {"A"|"B"} side - Cassette side being cued.
     * @returns {Promise<boolean>} Resolves `true` when the countdown reaches zero, or `false` when cancelled.
     * @throws {Error} Does not throw directly.
     *
     * Side effects: Starts and clears `state.cueTimerId`, mutates cue DOM, updates finish-time/record-mode UI, and logs status.
     */
    function runRecordCue(side) {
      clearRecordCue();
      // The cue duration includes configured lead-in and motor latency so the deck can reach stable recording speed.
      let remaining = getRecordCueSeconds();
      showRecordCue(side, remaining);
      log(`Cue Side ${side}: press record now. ${state.dryRun ? "Dry Run timer" : "Spotify"} starts in ${remaining}s.`);
      return new Promise(resolve => {
        const finish = value => {
          if (state.cueTimerId) clearInterval(state.cueTimerId);
          state.cueTimerId = null;
          if (state.recordCueFinish === finish) state.recordCueFinish = null;
          el.recordCue.classList.remove("show");
          resolve(value);
        };
        state.recordCueFinish = finish;
        state.cueTimerId = setInterval(() => {
          remaining -= 1;
          if (remaining <= 0) {
            // Clearing the cue removes the banner before playback begins.
            finish(true);
            return;
          }
          if (state.dryRun && side === "A" && !state.dryRun429Simulated && Math.random() < .22) {
            state.dryRun429Simulated = true;
            // This intentional simulated 429 exercises the full rate-limit banner, countdown, button-disable, and readiness API-row path without calling Spotify.
            simulateDryRunRateLimit();
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
      return Boolean(state.selectedDeviceId && state.devices.some(device => device.id === state.selectedDeviceId));
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
      const timing = getEffectiveTimingSettings();
      // Previously read directly from #leadInDelay and #motorLatency; now computed from active deck + cassette profiles via getEffectiveTimingSettings().
      return RECORD_CUE_SECONDS + timing.leaderTapeDelay + timing.motorLatency;
    }

    function getCuePhaseText(remaining, target) {
      const timing = getEffectiveTimingSettings();
      // Previously read directly from #leadInDelay; now computed from active deck + cassette profiles via getEffectiveTimingSettings().
      const leadIn = timing.leaderTapeDelay;
      // Previously read directly from #motorLatency; now computed from active deck + cassette profiles via getEffectiveTimingSettings().
      const motor = timing.motorLatency;
      if (leadIn && remaining > RECORD_CUE_SECONDS + motor) return `ADVANCING PAST LEADER TAPE - ${remaining}s`;
      if (motor && remaining > RECORD_CUE_SECONDS) return `WAITING FOR MOTOR - ${remaining}s`;
      return `${target} STARTS IN ${remaining}`;
    }

    function getCueMonitorText(remaining) {
      const timing = getEffectiveTimingSettings();
      // Previously read directly from #leadInDelay; now computed from active deck + cassette profiles via getEffectiveTimingSettings().
      const leadIn = timing.leaderTapeDelay;
      // Previously read directly from #motorLatency; now computed from active deck + cassette profiles via getEffectiveTimingSettings().
      const motor = timing.motorLatency;
      if (leadIn && remaining > RECORD_CUE_SECONDS + motor) return "Advancing past leader tape";
      if (motor && remaining > RECORD_CUE_SECONDS) return "Waiting for motor";
      return `${state.dryRun ? "Timer" : "Spotify"} starts in ${remaining}s`;
    }

    function clearRecordCue() {
      if (state.recordCueFinish) {
        state.recordCueFinish(false);
        return;
      }
      if (state.cueTimerId) clearInterval(state.cueTimerId);
      state.cueTimerId = null;
      el.recordCue.classList.remove("show");
    }

    /**
     * Builds a Spotify playback payload for one cassette side.
     *
     * Spotify `PUT /me/player/play` accepts a side-local `uris` array, an
     * `offset.position` within that array, and `position_ms` within the
     * selected track. This keeps correction and start commands scoped to the
     * current tape side rather than the full original playlist.
     *
     * @param {Array<{uri: string}>} tracks - Side-local tracks to send to Spotify.
     * @param {number} position - Zero-based index in `tracks` where playback should begin.
     * @param {number} [positionMs=0] - Millisecond offset within the selected track.
     * @returns {{method: "PUT", body: string}} Fetch options for `playSpotify`.
     * @throws {TypeError} May throw if the payload cannot be serialized.
     *
     * Side effects: None; callers send the returned payload to Spotify.
     */
    function buildSidePlaybackPayload(tracks, position, positionMs = 0) {
      return {
        method: "PUT",
        body: JSON.stringify({
          // `uris` requires playable Spotify track URIs; imported configs without URIs are blocked by preflight.
          uris: tracks.map(track => track.uri),
          // `offset.position` is side-local so track 0 means the first track on the cassette side.
          offset: { position },
          // `position_ms` lets drift correction resume inside the expected track instead of restarting it.
          position_ms: positionMs
        })
      };
    }

    async function pausePlayback() {
      try {
        if (!state.dryRun) {
          await spotifyFetch("/me/player/pause", { method: "PUT" });
        } else {
          // Dry Run skips `PUT /me/player/pause`; the local timer pause is still applied exactly like a real pause.
          simulateDryRunAction("Would pause Spotify playback.");
        }
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
        } else if (state.dryRun) {
          // Dry Run skips the abort-time `PUT /me/player/pause`; local recording state still returns to idle.
          simulateDryRunAction("Would pause Spotify playback during abort.");
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
      state.timerRunning = false;
      el.pauseBtn.disabled = false;
      state.timerId = setInterval(runTimerTick, 250);
      runTimerTick();
    }

    function stopTimer() {
      if (state.timerId) clearInterval(state.timerId);
      state.timerId = null;
      state.sideAStartedAt = 0;
      runTimerTick();
    }

    async function runTimerTick() {
      if (state.timerRunning) return;
      state.timerRunning = true;
      try {
        await updateTimer();
      } catch (error) {
        log(error.message);
      } finally {
        state.timerRunning = false;
      }
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
          if (syncAutomaticDeckChecklistItems()) renderRecordMode();
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
        if (syncAutomaticDeckChecklistItems()) renderRecordMode();
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
      // Playback recovery text changes the API/device status copy shown in Recording Readiness.
      renderReadiness();
    }

    /**
     * Synchronizes the recording timer from Spotify playback state.
     *
     * It picks the active side, verifies that Spotify is playing a track from
     * that side, corrects unexpected tracks when needed, computes side-local
     * elapsed time, records drift against the local deck timer, auto-completes
     * the side near its end, and schedules the next playback poll.
     *
     * @param {object} playback - Response from `GET /me/player`.
     * @returns {Promise<void>} Resolves after progress state and polling schedule are updated.
     * @throws {Error|SpotifyApiError|SpotifyAccountsError} May throw if a correction playback command fails.
     *
     * Side effects: Mutates playback status/progress fields, may call Spotify playback correction, updates timers, and schedules polling.
     */
    async function syncRecordProgressFromSpotify(playback) {
      // The active side defines the only valid track list during recording; tracks cannot span both sides.
      const tracks = state.activeRecordSide === "B" ? sideB() : sideA();
      if (!tracks.length || !playback.item?.uri) {
        renderRecordMode("Waiting");
        schedulePlaybackPoll(10000);
        return;
      }
      // If Spotify wandered to another track, correct before using its progress as the source of truth.
      await correctUnexpectedPlaybackTrack(tracks, playback);
      // Convert Spotify's current track URI and progress into elapsed time within the current cassette side.
      const elapsed = getSpotifySideElapsed(tracks, playback.item.uri, playback.progress_ms || 0);
      if (elapsed === null) {
        // The current Spotify track is outside the side plan, so local timing continues without trusting playback progress.
        state.playbackStatus.expectedTrackPlaying = false;
        state.playbackStatus.playbackInSync = false;
        state.playbackStatus.driftMs = null;
        renderRecordMode("Outside side");
        schedulePlaybackPoll(8000);
        return;
      }
      const localElapsed = getLocalRecordElapsed();
      // Positive drift means Spotify is ahead of the local deck timer; negative drift means it is behind.
      const driftMs = elapsed - localElapsed;
      const expected = getExpectedTrackAtElapsed(tracks, localElapsed);
      state.playbackStatus.expectedTrackPlaying = Boolean(expected && playback.item.uri === expected.track.uri);
      // Five seconds is the tolerance window before the UI reports Spotify and cassette timing as out of sync.
      state.playbackStatus.playbackInSync = Math.abs(driftMs) <= SPOTIFY_PROGRESS_DRIFT_TOLERANCE_MS;
      state.playbackStatus.driftMs = driftMs;
      if (driftMs > -2000 && driftMs <= SPOTIFY_PROGRESS_DRIFT_TOLERANCE_MS) {
        // Trust Spotify progress only when it is close enough to avoid jumping the local countdown.
        state.spotifySideElapsedMs = elapsed;
      }
      if (elapsed > state.lastSideProgressMs && driftMs > -2000 && driftMs <= SPOTIFY_PROGRESS_DRIFT_TOLERANCE_MS) {
        // Keep a monotonic floor so repeated tracks with the same URI do not move the side timer backwards.
        state.lastSideProgressMs = elapsed;
        state.lastProgressUpdatedAt = Date.now();
      }
      const effectiveElapsed = getProjectedRecordElapsed();
      // Complete slightly before exact duration to account for polling delay and avoid recording into the next side state.
      if (state.recordMode === "recording_a" && effectiveElapsed >= duration(sideA()) - 750 && !state.autoPauseDone) {
        await completeSideA();
        return;
      } else if (state.recordMode === "recording_b" && effectiveElapsed >= duration(sideB()) - 750 && !state.autoPauseDone) {
        await completeSideB();
        return;
      }
      renderRecordMode(playback.is_playing ? "Monitoring" : "Paused");
      await runTimerTick();
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

    /**
     * Calculates side-local elapsed time from Spotify playback progress.
     *
     * A URI can appear more than once in a side, so the function builds all
     * candidate elapsed positions for that URI, rejects candidates behind the
     * monotonic progress floor when possible, and picks the candidate nearest
     * the local timer anchor.
     *
     * @param {Array<{uri: string, duration_ms: number}>} tracks - Current side track list.
     * @param {string} uri - Spotify URI from the current playback item.
     * @param {number} progressMs - Spotify-reported progress within the current track.
     * @returns {number|null} Side-local elapsed milliseconds, or `null` when the URI is not on this side.
     * @throws {Error} Does not throw directly.
     *
     * Side effects: None.
     */
    function getSpotifySideElapsed(tracks, uri, progressMs) {
      const candidates = [];
      let running = 0;
      for (const track of tracks) {
        // Duplicate Spotify URIs are possible, so every matching occurrence is a candidate timeline position.
        if (track.uri === uri) candidates.push(running + progressMs);
        running += track.duration_ms;
      }
      if (!candidates.length) return null;
      // Allow a small backward window for jitter, but avoid jumping behind already-confirmed side progress.
      const floor = Math.max(0, state.lastSideProgressMs - 5000);
      const anchor = Math.max(getLocalRecordElapsed(), floor);
      const forward = candidates.filter(value => value >= floor);
      // Choose the occurrence closest to the local deck timer so repeated tracks map to the expected copy.
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
      if (driftMs > 0 && driftMs <= SPOTIFY_PROGRESS_DRIFT_TOLERANCE_MS) return state.spotifySideElapsedMs;
      return localElapsed;
    }

    async function completeSideA() {
      if (state.autoPauseDone) return;
      state.autoPauseDone = true;
      stopTimer();
      try {
        if (!state.dryRun) {
          await spotifyFetch("/me/player/pause", { method: "PUT" });
        } else {
          // Dry Run skips the Side A auto-pause endpoint while preserving the flip transition timing.
          simulateDryRunAction("Would pause Spotify playback at the end of Side A.");
        }
        log(state.dryRun ? "Dry Run: Side A complete." : "Record Mode: Side A complete. Spotify paused automatically.");
      } catch (error) {
        log(error.message);
      }
      state.recordMode = "flip";
      state.activeRecordSide = "A";
      if (state.dryRun && !sideB().length) {
        state.recordMode = "idle";
        state.activeRecordSide = null;
      }
      el.flipBanner.classList.toggle("show", state.recordMode !== "idle");
      el.startB.disabled = !sideB().length;
      renderRecordMode(state.recordMode === "idle" ? "Complete" : "Flip now");
      if (!state.dryRun) schedulePlaybackPoll(getPlaybackPollDelay());
    }

    async function completeSideB() {
      if (state.autoPauseDone) return;
      state.autoPauseDone = true;
      stopTimer();
      try {
        if (!state.dryRun) {
          await spotifyFetch("/me/player/pause", { method: "PUT" });
        } else {
          // Dry Run skips the Side B auto-pause endpoint while preserving the final idle transition.
          simulateDryRunAction("Would pause Spotify playback at the end of Side B.");
        }
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
      const checklistComplete = isChecklistComplete();
      const readinessReady = isRecordingReadinessReady();
      el.startA.textContent = pausedA ? "Resume Side A" : "Start Side A";
      el.startB.textContent = pausedB ? "Resume Side B" : "Start Side B";
      const needsToken = !state.dryRun;
      // Every Recording Readiness row must be green before arming Side A; this keeps the button state aligned with the readiness panel.
      el.startA.disabled = state.rateLimit.active || cueing || !a.length || (needsToken && !state.token) || !readinessReady || !(state.recordMode === "idle" || pausedA);
      // Every Recording Readiness row must be green before arming Side B; this keeps the button state aligned with the readiness panel.
      el.startB.disabled = state.rateLimit.active || cueing || !b.length || (needsToken && !state.token) || !readinessReady || !(state.recordMode === "flip" || pausedB);
      // The blocked class makes a failed readiness gate visually distinct without changing any other start-button guard.
      el.startA.classList.toggle("blocked", !readinessReady);
      // The blocked class makes a failed readiness gate visually distinct without changing any other start-button guard.
      el.startB.classList.toggle("blocked", !readinessReady);
      el.pauseBtn.disabled = cueing || (needsToken && !state.token) || !recording;
      el.abortBtn.disabled = !abortable;
      renderRecordingLockState();
      updateDeckChecklistState();
      // Recording mode and button gates changed, so Recording Readiness must reflect the latest active state.
      renderReadiness();
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
      syncAutomaticDeckChecklistItems({ persist: false });
      el.skipDeckChecklist.checked = Boolean(state.skipDeckChecklist);
      el.deckChecklistItems.innerHTML = DECK_CHECKLIST_ITEMS.map((item, index) => {
        const checked = state.deckChecklistDone?.[index] ? " checked" : "";
        return `<label class="deck-check"><input type="checkbox" value="${index}"${checked}><span>${escapeHtml(item)}</span></label>`;
      }).join("");
      updateDeckChecklistState();
    }

    /**
     * Applies checklist items that the app can verify from its own state.
     *
     * It currently checks the Spotify device checklist item when the operator
     * has selected a current Spotify device. It only turns automatic items on, never
     * clears manually checked items, because physical setup confirmations still
     * belong to the operator.
     *
     * @param {object} [options={}] - Sync options.
     * @param {boolean} [options.persist=true] - Whether to save the updated checklist to localStorage.
     * @returns {boolean} `true` when an automatic checklist item changed.
     * @throws {Error} Does not throw directly.
     *
     * Side effects: May mutate `state.deckChecklistDone`, update the matching checkbox DOM node, and persist `deck_checklist`.
     */
    function syncAutomaticDeckChecklistItems({ persist = true } = {}) {
      let changed = false;
      const spotifyDeviceKnown = isSpotifyDeviceReady();
      if (spotifyDeviceKnown && DECK_CHECKLIST_SPOTIFY_DEVICE_INDEX >= 0 && !state.deckChecklistDone[DECK_CHECKLIST_SPOTIFY_DEVICE_INDEX]) {
        // The Spotify device row can be checked automatically because an explicit Spotify device selection is observable app state.
        state.deckChecklistDone[DECK_CHECKLIST_SPOTIFY_DEVICE_INDEX] = true;
        const input = el.deckChecklistItems?.querySelector(`input[value="${DECK_CHECKLIST_SPOTIFY_DEVICE_INDEX}"]`);
        if (input) input.checked = true;
        changed = true;
      }
      if (changed && persist) persistDeckChecklist();
      return changed;
    }

    function persistDeckChecklist() {
      localStorage.setItem("deck_checklist", JSON.stringify({
        done: state.deckChecklistDone,
        skip: state.skipDeckChecklist
      }));
    }

    function updateDeckChecklist() {
      state.skipDeckChecklist = el.skipDeckChecklist.checked;
      state.deckChecklistDone = [...el.deckChecklistItems.querySelectorAll("input")].map(input => input.checked);
      persistDeckChecklist();
      // Changing any checklist item or the skip toggle immediately re-evaluates whether Start Side A/B may be armed.
      renderRecordMode();
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
      // Checklist progress changed, so Recording Readiness must re-evaluate the checklist and ready rows.
      renderReadiness();
    }

    /**
     * Computes the Recording Readiness rows used by UI and start gates.
     *
     * It evaluates the same six prerequisite rows shown in the panel:
     * Spotify, Device, Playlist, Tape, Checklist, and API. The returned
     * `ready` value is true only when all six rows are green, so Start Side
     * A/B and the visible Ready row share one source of truth.
     *
     * @returns {{statuses: Array<{label: string, state: string, icon: string, value: string}>, ready: boolean, warnings: string[]}} Readiness rows, aggregate ready state, and user-facing warnings.
     * @throws {Error} Does not throw directly.
     *
     * Side effects: None.
     */
    function getRecordingReadinessStatus() {
      const checklistReady = isAudioChecklistConfirmed();
      const selectedDevice = state.devices.find(device => device.id === state.selectedDeviceId);
      const selectedDeviceReady = isSpotifyDeviceReady();
      const selectedDeviceLabel = selectedDevice?.name || "";
      const tokenValid = Boolean(state.token && Date.now() <= state.expiresAt);
      const playlistLoaded = Boolean(state.project);
      const playlistReady = projectTracks().length >= 1;
      const tapeStatus = getTapeReadinessStatus(playlistLoaded, playlistReady);
      // The API row is warning during Retry-After countdowns, red after non-retryable errors, and green otherwise.
      const apiState = state.rateLimit.error ? "bad" : state.rateLimit.active ? "warn" : "ok";
      const statuses = [
        {
          label: "Spotify",
          state: tokenValid ? "ok" : "bad",
          icon: tokenValid ? "✅" : "❌",
          value: tokenValid ? "Token valid" : "Not connected / token missing"
        },
        {
          label: "Device",
          state: selectedDeviceReady ? "ok" : "bad",
          icon: selectedDeviceReady ? "✅" : "❌",
          value: state.dryRun ? "Dry Run device skipped" : selectedDeviceReady ? selectedDeviceLabel || "Device selected" : "No device selected"
        },
        {
          label: "Playlist",
          state: playlistReady ? "ok" : "bad",
          icon: playlistReady ? "✅" : "❌",
          value: playlistReady
            ? `${projectTracks().length} track${projectTracks().length === 1 ? "" : "s"} loaded`
            : playlistLoaded ? "Playlist loaded, no readable tracks" : "No playlist loaded"
        },
        {
          label: "Tape",
          state: tapeStatus.ready ? "ok" : "bad",
          icon: tapeStatus.ready ? "✅" : "❌",
          value: tapeStatus.message
        },
        {
          label: "Checklist",
          state: checklistReady ? "ok" : "bad",
          icon: checklistReady ? "✅" : "❌",
          value: checklistReady ? (state.skipDeckChecklist ? "Skipped" : "Complete") : "Incomplete"
        },
        {
          label: "API",
          state: apiState,
          icon: apiState === "ok" ? "✅" : apiState === "warn" ? "⚠️" : "❌",
          value: state.rateLimit.error || (state.rateLimit.active ? "429 in progress" : "No active rate limit")
        }
      ];
      const ready = statuses.every(item => item.state === "ok");
      const warnings = [];
      if (!state.dryRun && !state.token) warnings.push("Connect Spotify before recording.");
      if (!selectedDeviceReady) warnings.push("Select a Spotify device.");
      if (!tapeStatus.ready && tapeStatus.warning) warnings.push(tapeStatus.warning);
      if (!checklistReady) warnings.push("Confirm the audio quality checklist before recording.");
      if (state.playbackRecoveryMessage) warnings.push(state.playbackRecoveryMessage);
      return { statuses, ready, warnings };
    }

    /**
     * Computes whether the current cassette plan can be recorded with available tapes.
     *
     * It requires a loaded playlist, a selected tape layout, at least one tape
     * in the user's inventory, enough physical cassettes for every planned
     * format, and no side overflow across the full tape plan. The returned
     * message is shown in the Recording Readiness Tape row.
     *
     * @param {boolean} playlistLoaded - Whether playlist metadata or an imported project is loaded.
     * @param {boolean} playlistReady - Whether at least one playlist track is loaded.
     * @returns {{ready: boolean, message: string, warning: string}} Tape readiness state and user-facing detail.
     * @throws {Error} Does not throw directly.
     *
     * Side effects: None.
     */
    function getTapeReadinessStatus(playlistLoaded, playlistReady) {
      const selectedLayout = selectedTapeLayout();
      if (!playlistLoaded) return { ready: false, message: "No playlist loaded", warning: "" };
      if (!playlistReady) return { ready: false, message: "No readable tracks", warning: "Spotify did not allow this token to read the playlist track items." };
      if (!selectedLayout || !selectedTapeMinutes()) return { ready: false, message: "No tape selected", warning: "Select a tape format before recording." };
      const inventory = getTapeInventory();
      if (!Object.values(inventory).some(quantity => quantity > 0)) {
        return { ready: false, message: "No tapes in inventory", warning: "Add at least one cassette under Tapes you have." };
      }
      const shortages = getTapeInventoryShortages();
      if (shortages.length) {
        const message = shortages.map(({ minutes, used, available }) => `C${minutes}: ${available}/${used}`).join(", ");
        return { ready: false, message: `Inventory short: ${message}`, warning: "Increase Tapes you have or choose formats you actually have." };
      }
      const overflow = getTapePlanOverflow();
      if (overflow) {
        return { ready: false, message: `${overflow.label} too small`, warning: `${overflow.label} exceeds C${overflow.minutes}; choose a larger cassette or adjust the plan.` };
      }
      return { ready: true, message: `C${selectedTapeMinutes()} plan valid`, warning: "" };
    }

    /**
     * Lists cassette formats where the current plan exceeds user inventory.
     *
     * It compares the planned tape format counts against the quantities from
     * `Tapes you have` and returns only formats that need more physical
     * cassettes than the user has entered.
     *
     * @returns {Array<{minutes: number, used: number, available: number}>} Inventory shortages by cassette length.
     * @throws {Error} Does not throw directly.
     *
     * Side effects: None.
     */
    function getTapeInventoryShortages() {
      const inventory = getTapeInventory();
      const usedFormats = countTapeFormats();
      return Object.entries(usedFormats)
        .map(([minutes, used]) => ({
          minutes: Number(minutes),
          used,
          available: inventory[minutes] || 0
        }))
        .filter(item => item.used > item.available);
    }

    /**
     * Finds the first tape side that exceeds its cassette format capacity.
     *
     * It scans every planned physical tape, checks Side A and Side B against
     * that layout's side length, and returns the first overflow so readiness can
     * block recording when the selected inventory is too small.
     *
     * @returns {{label: string, minutes: number}|null} First overflowing side, or `null` when every planned side fits.
     * @throws {Error} Does not throw directly.
     *
     * Side effects: None.
     */
    function getTapePlanOverflow() {
      for (const layout of state.tapeLayouts) {
        const minutes = layout.tapeFormat || layout.tapeMinutes || state.tapeMinutes;
        const sideLength = layout.sideLengthMs || minutes * 30 * 1000;
        if (duration(layout.sideA) > sideLength) return { label: `Tape ${layout.tapeNumber || layout.number} Side A`, minutes };
        if (duration(layout.sideB) > sideLength) return { label: `Tape ${layout.tapeNumber || layout.number} Side B`, minutes };
      }
      return null;
    }

    function isRecordingReadinessReady() {
      return getRecordingReadinessStatus().ready;
    }

    /**
     * Blocks recording starts unless all Recording Readiness rows are green.
     *
     * It reuses `getRecordingReadinessStatus()` so the click guard cannot drift
     * from the rendered panel, writes the blocking rows into the readiness
     * warning area, logs the reason, and throws to stop the start flow before
     * cue timers or Spotify playback can begin.
     *
     * @param {"A"|"B"} side - Cassette side the user attempted to start.
     * @returns {void}
     * @throws {Error} Throws when any Recording Readiness row is not green.
     *
     * Side effects: Updates readiness warning text and writes a log entry on blocked starts.
     */
    function assertRecordingReadinessReady(side) {
      const readiness = getRecordingReadinessStatus();
      if (readiness.ready) return;
      const blockedRows = readiness.statuses.filter(item => item.state !== "ok").map(item => item.label).join(", ");
      const message = `Recording Readiness is not all green. Fix before starting Side ${side}: ${blockedRows}.`;
      el.spotifyStatusWarning.textContent = message;
      log(message);
      throw new Error(message);
    }

    /**
     * Renders the seven-row Recording Readiness traffic-light panel.
     *
     * It reads the shared readiness status, appends the final Ready row,
     * replaces the panel DOM, and writes any user-facing warnings beneath the
     * rows. Green rows show satisfied prerequisites, warning rows show
     * recoverable setup gaps, and red rows show blocking failures.
     *
     * Call sites: `setPlaybackRecovery()` refreshes API/device copy,
     * `renderRecordMode()` refreshes recording-button and mode-dependent state,
     * and `updateDeckChecklistState()` refreshes checklist-dependent state.
     *
     * @returns {void}
     * @throws {Error} Does not throw directly.
     *
     * Side effects: Replaces the Recording Readiness DOM rows and warning text.
     */
    function renderReadiness() {
      if (!el.spotifyStatusItems) return;
      const readiness = getRecordingReadinessStatus();
      const statuses = [...readiness.statuses];
      statuses.push({
        label: "Ready",
        state: readiness.ready ? "ok" : "bad",
        icon: readiness.ready ? "✅" : "❌",
        value: readiness.ready ? "All systems ready" : "Resolve readiness rows"
      });
      el.spotifyStatusItems.innerHTML = statuses.map(item => {
        return `<div class="readiness-row ${item.state}${item.label === "Ready" ? " final" : ""}"><span><i>${item.icon}</i>${escapeHtml(item.label)}</span><b>${escapeHtml(item.value)}</b></div>`;
      }).join("");
      el.spotifyStatusWarning.textContent = readiness.warnings.join(" ");
    }

    /**
     * Determines whether the deck checklist permits recording starts.
     *
     * It first honors the explicit skip toggle because the operator may need
     * to bypass checklist enforcement for a known-safe setup. When skip is not
     * active, it counts the persisted deck checklist booleans and requires
     * every configured checklist item to be checked before returning true.
     *
     * @returns {boolean} `true` when skip is active or every deck checklist item is checked; otherwise `false`.
     * @throws {Error} Does not throw directly.
     *
     * Side effects: None; callers use the result to update DOM disabled states and recording preflight checks.
     */
    function isChecklistComplete() {
      if (state.skipDeckChecklist) return true;
      const total = DECK_CHECKLIST_ITEMS.length;
      const done = state.deckChecklistDone.filter(Boolean).length;
      return done >= total;
    }

    function isAudioChecklistConfirmed() {
      return isChecklistComplete();
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
      renderDryRunState();
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
      // The DRY RUN banner appears immediately when active and disappears as soon as live Spotify commands are re-enabled.
      renderDryRunState();
      renderRecordMode();
      log(state.dryRun ? "Dry Run enabled. Spotify playback commands will be skipped." : "Dry Run disabled. Spotify playback commands are active.");
    }

    /**
     * Logs a simulated recording-flow action for Dry Run mode.
     *
     * It prints the would-be Spotify playback command to the console, prepends
     * the same action to the visible Dry Run log, and keeps only recent entries
     * so the transport panel remains compact. It never calls Spotify, never
     * mutates remote playback state, and never changes playlist order.
     *
     * @param {string} action - Human-readable description of the Spotify action that would have run.
     * @returns {void}
     * @throws {Error} Does not throw directly.
     *
     * Side effects: Writes to `console.info`, mutates `state.dryRunLog`, updates the Dry Run log DOM, and writes the shared app log.
     */
    function simulateDryRunAction(action) {
      const message = `DRY RUN - ${action}`;
      console.info(message);
      state.dryRunLog = [`${new Date().toLocaleTimeString()} ${message}`, ...state.dryRunLog].slice(0, 8);
      renderDryRunState();
      log(message);
    }

    function renderDryRunState() {
      if (!el.dryRunBanner || !el.dryRunLog) return;
      // The banner is visible only while Dry Run is active so live sessions cannot be mistaken for simulations.
      el.dryRunBanner.hidden = !state.dryRun;
      el.dryRunLog.hidden = !state.dryRun || !state.dryRunLog.length;
      el.dryRunLog.textContent = state.dryRunLog.join("\n");
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
      const deck = getActiveDeck();
      el.leadInDelay.value = deck ? deck.leaderTapeDelay : state.calibration.leadInSeconds;
      el.motorLatency.value = deck ? deck.motorLatency : state.calibration.motorLatencySeconds;
      el.safetyMargin.value = deck ? deck.safetyMargin : state.calibration.safetyMarginSeconds;
    }

    function updateCalibration(event) {
      const defer = event?.type === "input";
      updateDeckProfile(event);
      const timing = getEffectiveTimingSettings();
      state.calibration = normalizeCalibration({
        leadInSeconds: timing.leaderTapeDelay,
        motorLatencySeconds: timing.motorLatency,
        safetyMarginSeconds: timing.safetyMargin
      });
      if (state.project) state.project.calibration = { ...state.calibration };
      markProjectDirty();
      if (defer) {
        state.pendingCalibration = { ...state.calibration };
        scheduleTimingDependentViews(`Recording calibration saved: leader tape ${state.calibration.leadInSeconds}s, motor ${state.calibration.motorLatencySeconds}s, safety ${state.calibration.safetyMarginSeconds}s.`);
        return;
      }
      // Keep the legacy calibration key synchronized for older exports and any users who temporarily clear all deck profiles.
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

    /**
     * Gets the effective recording timing settings.
     *
     * Steps:
     * 1. Load the active deck profile and active cassette profile.
     * 2. Fall back to the legacy HTML inputs when no active deck exists.
     * 3. Add cassette `leaderLength` as an offset to the deck's base leader tape delay.
     * 4. Use deck motor latency and safety margin directly.
     * 5. Use cassette slack when measured, otherwise use the deck default slack margin.
     *
     * @returns {{leaderTapeDelay: number, motorLatency: number, safetyMargin: number, slackMargin: number}} Effective timing settings in seconds.
     * @throws {Error} Does not throw; missing profile state falls back to current HTML input values.
     *
     * Side effects: Reads profile localStorage through active profile helpers and may read calibration input values as a legacy fallback.
     */
    function getEffectiveTimingSettings() {
      const deck = getActiveDeck();
      // A missing deck means profile storage is unavailable or empty, so preserve the original behavior by reading the manual inputs.
      if (!deck) {
        return {
          // Fallback reads the current #leadInDelay input so legacy manual calibration still works when no profile is active.
          leaderTapeDelay: clampNumber(el.leadInDelay.value, 0, 120),
          // Fallback reads the current #motorLatency input so legacy manual calibration still works when no profile is active.
          motorLatency: clampNumber(el.motorLatency.value, 0, 30),
          // Fallback reads the current #safetyMargin input so legacy safety warnings still work when no profile is active.
          safetyMargin: clampSeconds(el.safetyMargin.value, 0, 300),
          // Fallback reads the current #slackMargin input so legacy planning still works when no profile is active.
          slackMargin: clampSeconds(el.slackMargin.value, 0, 120)
        };
      }
      const cassette = getActiveCassette();
      const cassetteLeaderLength = cassette?.leaderLength ?? 0;
      // cassette.leaderLength is an additive offset on top of the deck's base leaderTapeDelay.
      // It accounts for cassette batches with slightly longer physical leader tape, but the deck's
      // mechanical delay is the dominant factor and must never be fully overridden by cassette data.
      const leaderTapeDelay = Number(deck.leaderTapeDelay) + Number(cassetteLeaderLength || 0);
      // Missing cassette slack falls back from cassette to deck because most cassettes are not measured individually.
      const slackMargin = cassette?.slackMargin ?? deck.defaultSlackMargin;
      return {
        leaderTapeDelay: clampNumber(leaderTapeDelay, 0, 120),
        motorLatency: clampNumber(deck.motorLatency, 0, 30),
        safetyMargin: clampSeconds(deck.safetyMargin, 0, 300),
        slackMargin: clampSeconds(slackMargin, 0, 120)
      };
    }

    function clampSeconds(value, min, max) {
      const number = Number(value);
      if (!Number.isFinite(number)) return min;
      return Math.min(max, Math.max(min, Math.round(number)));
    }

    function clampNumber(value, min, max) {
      const number = Number(value);
      if (!Number.isFinite(number)) return min;
      return Math.min(max, Math.max(min, number));
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
      el.slackMargin.value = getEffectiveTimingSettings().slackMargin;
    }

    function updateSlackMargin(event) {
      if (blockIfRecordingLocked("Tape Slack Margin")) {
        renderSlackMargin();
        return;
      }
      const defer = event?.type === "input";
      const cassette = getActiveCassette();
      if (cassette?.slackMargin !== null && cassette?.slackMargin !== undefined) {
        el.cassetteSlackMargin.value = el.slackMargin.value;
        updateCassetteProfile(event);
      } else {
        updateDeckProfile(event);
      }
      state.slackMarginSeconds = getEffectiveTimingSettings().slackMargin;
      if (state.project) state.project.slackMarginSeconds = state.slackMarginSeconds;
      markProjectDirty();
      if (defer) {
        scheduleTimingDependentViews(`Tape slack margin set to ${state.slackMarginSeconds}s.`);
        return;
      }
      computeSplit();
      renderSlackMargin();
      renderSplit();
      log(`Tape slack margin set to ${state.slackMarginSeconds}s.`);
    }

    function renderTapeOptions() {
      const formats = getAvailableTapeFormats();
      if (!formats.length) {
        el.tapeSelect.innerHTML = `<option value="">No tapes in inventory</option>`;
        el.tapeSelect.disabled = true;
        return;
      }
      el.tapeSelect.disabled = false;
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
      const counts = countCollectionProfiles();
      const profiles = loadCassetteProfiles();
      if (!profiles.length) {
        el.tapeInventory.innerHTML = `<div class="tape-check tape-inventory-empty">
          <span>No cassette profiles yet</span>
          <button type="button" data-cassette-inventory-action="create-profile">Create profile</button>
        </div>`;
        return;
      }
      el.tapeInventory.innerHTML = profiles.map(profile => {
        const quantity = counts[profile.id] || 0;
        return `<div class="tape-check tape-quantity">
          <span>${escapeHtml(profile.name)} - C${escapeHtml(profile.lengthMinutes)}</span>
          <button type="button" data-cassette-inventory-action="remove" data-cassette-profile-id="${escapeHtml(profile.id)}" aria-label="Remove ${escapeHtml(profile.name)}">-</button>
          <b>${quantity}</b>
          <button type="button" data-cassette-inventory-action="add" data-cassette-profile-id="${escapeHtml(profile.id)}" aria-label="Add ${escapeHtml(profile.name)}">+</button>
        </div>`;
      }).join("");
    }

    function updateTapeCollectionFromButton(event) {
      const button = event.target.closest("[data-cassette-inventory-action]");
      if (!button) return;
      if (blockIfRecordingLocked("Tape inventory")) {
        renderTapeInventory();
        return;
      }
      if (button.dataset.cassetteInventoryAction === "create-profile") {
        addCassetteProfile();
        return;
      }
      const profileId = button.dataset.cassetteProfileId;
      if (button.dataset.cassetteInventoryAction === "add") {
        addTapeCollectionItem(profileId);
      } else {
        removeTapeCollectionItem(profileId);
      }
      state.availableTapeFormats = getAvailableTapeFormats();
      markProjectDirty();
      renderTapeOptions();
      computeSplit();
      renderSplit();
      renderTapeInventory();
    }

    function updateAvailableTapeFormats() {
      if (blockIfRecordingLocked("Tape inventory")) {
        renderTapeInventory();
        return;
      }
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
        restoreTapeCollection();
        const savedInventory = JSON.parse(localStorage.getItem("tape_inventory") || "null");
        const savedFormats = JSON.parse(localStorage.getItem("available_tape_formats") || "null");
        state.tapeInventory = normalizeTapeInventory(savedInventory, savedFormats || state.availableTapeFormats);
        state.availableTapeFormats = getAvailableTapeFormats();
      } catch {
        localStorage.removeItem("tape_inventory");
        localStorage.removeItem("available_tape_formats");
        restoreTapeCollection();
      }
    }

    function getAvailableTapeFormats() {
      return Object.entries(getTapeInventory())
        .filter(([, quantity]) => quantity > 0)
        .map(([minutes]) => Number(minutes))
        .sort((a, b) => a - b);
    }

    function getTapeInventory() {
      return getProfiledTapeInventory();
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
      const cassetteSelect = event.target.closest("[data-tape-cassette-index]");
      if (cassetteSelect) {
        updatePerTapeCassette(cassetteSelect);
        return;
      }
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

    function updatePerTapeCassette(select) {
      if (blockIfRecordingLocked("Physical cassette")) {
        renderSplit();
        return;
      }
      if (!state.project) return;
      const index = Number(select.dataset.tapeCassetteIndex);
      const layout = state.project.tapes[index];
      if (!layout) return;
      const profile = getCassetteProfileById(select.value);
      layout.cassetteProfileId = profile?.id || "";
      if (profile?.lengthMinutes && TAPE_FORMATS.includes(Number(profile.lengthMinutes))) {
        layout.tapeFormat = Number(profile.lengthMinutes);
        layout.tapeMinutes = Number(profile.lengthMinutes);
        if (index === state.selectedTapeIndex) state.tapeMinutes = Number(profile.lengthMinutes);
      }
      markProjectDirty();
      computeSplit();
      renderSplit();
      log(profile ? `Tape ${index + 1} physical cassette set to ${profile.name}.` : `Tape ${index + 1} physical cassette model cleared.`);
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
      el.loadPlaylistsBtn.disabled = !state.token || state.rateLimit.active;
      el.loadDevicesBtn.disabled = !state.token || state.rateLimit.active;
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
        const message = state.project
          ? "Spotify did not return readable track durations for this playlist."
          : "Load a playlist to compare the cassette formats you marked as available.";
        el.tapeRecommendation.innerHTML = `<b>Tape recommendation pending</b><span>${escapeHtml(message)}</span>`;
        return;
      }

      const availableFormats = getAvailableTapeFormats();
      if (!availableFormats.length) {
        el.tapeRecommendation.innerHTML = `<b>Tape recommendation pending</b><span>Add at least one cassette format under Tapes you have.</span>`;
        return;
      }
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
        const message = state.project
          ? "No split can be calculated because Spotify did not return readable track items for this playlist."
          : "Load a playlist to see the split decision.";
        el.splitExplanation.innerHTML = `<b>Why this split?</b><span>${escapeHtml(message)}</span>`;
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
        el.manualSplitTrack.innerHTML = `<option value="">${state.project ? "No readable tracks" : "Load a playlist first"}</option>`;
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

    /**
     * Locks the selected tape layout to a manual side split.
     *
     * It validates the requested Side B start index, preserves the split only
     * when Side A still fits within the side length, marks the project dirty,
     * resets recording progress because the side boundary changed, and rerenders
     * the split UI.
     *
     * @param {number} splitIndex - Absolute track index where Side B should start.
     * @returns {void}
     * @throws {Error} Does not throw directly; invalid split choices are logged and rendered.
     *
     * Side effects: Mutates project split state, recording progress, DOM controls, and log output.
     */
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
      // Project-level manual mode tells export/import and explanations that user intent overrides automatic packing.
      state.project.splitMode = "manual";
      state.project.tapes[state.selectedTapeIndex] = layout;
      syncStateFromProject();
      // A new side boundary invalidates any prior recording progress and Spotify drift anchor.
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

    /**
     * Applies a validated manual split to one tape layout.
     *
     * The split is clamped to the tape's track range, then rejected if Side A
     * would exceed the physical side length. Tracks are reassigned as whole
     * items because cassette planning cannot split a song across sides.
     *
     * @param {object} layout - Tape layout being edited.
     * @param {number} splitIndex - Requested absolute Side B start index.
     * @returns {{ok: boolean, message: string}} Result object with an error message when the split is invalid.
     * @throws {Error} Does not throw directly.
     *
     * Side effects: Mutates `layout` when the split is valid.
     */
    function applyManualSplitToLayout(layout, splitIndex) {
      const start = layout.sideAStartIndex;
      const end = layout.sideBEndIndex;
      // Clamp the manual boundary so Side A keeps at least one track and the split remains inside this tape.
      const nextSplit = Math.max(start + 1, Math.min(Number(splitIndex) || layout.sideBStartIndex, end));
      // Side A takes whole tracks up to the split; no track is cut to make it fit.
      const nextSideA = projectTracks().slice(start, nextSplit);
      if (duration(nextSideA) > layout.sideLengthMs) {
        // Reject the split because a real cassette side cannot contain more audio than its capacity.
        return { ok: false, message: `Manual split exceeds Side A length ${formatTime(layout.sideLengthMs)}.` };
      }
      layout.splitMode = "manual";
      layout.manualSplitIndex = nextSplit;
      layout.sideBStartIndex = nextSplit;
      layout.sideAEndIndex = nextSplit;
      layout.sideA = nextSideA;
      // Side B receives the remaining whole tracks through the tape's end boundary.
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

    /**
     * Exports deck and cassette profiles as a JSON file.
     *
     * Steps:
     * 1. Collect all saved deck profiles and cassette profiles from localStorage.
     * 2. Wrap them in a versioned profile export payload.
     * 3. Generate a dated filename so repeated exports are easy to identify.
     * 4. Trigger a browser download for the JSON payload.
     *
     * @returns {void}
     * @throws {DOMException} May throw if browser download APIs or storage reads are unavailable.
     *
     * Side effects: Triggers a file download; does not write to localStorage.
     */
    function exportProfiles() {
      const today = new Date().toISOString().slice(0, 10);
      const payload = {
        app: "cassette-optimizer",
        version: 1,
        exportedAt: new Date().toISOString(),
        deckProfiles: loadDeckProfiles().map(serializeDeckProfile),
        cassetteProfiles: loadCassetteProfiles()
      };
      // The date suffix makes it easy to identify the most recent export when multiple files accumulate in the downloads folder.
      downloadJson(payload, `cassette-profiles-${today}.json`);
      el.profileStatus.textContent = "Profiles exported.";
      log("Profiles exported as JSON.");
    }

    function exportActiveDeckProfile() {
      const profile = getActiveDeck();
      if (!profile) {
        el.profileStatus.textContent = "No deck profile selected.";
        return;
      }
      downloadJson(buildSingleProfilePayload("deck", profile), `${profileFilename(profile.name, profile.id)}.deck-profile.json`);
      el.profileStatus.textContent = "Deck profile exported.";
      log("Deck profile exported as JSON.");
    }

    function exportActiveCassetteProfile() {
      const profile = getActiveCassette();
      if (!profile) {
        el.profileStatus.textContent = "No cassette profile selected.";
        return;
      }
      downloadJson(buildSingleProfilePayload("cassette", profile), `${profileFilename(profile.name, profile.id)}.cassette-profile.json`);
      el.profileStatus.textContent = "Cassette profile exported.";
      log("Cassette profile exported as JSON.");
    }

    function buildSingleProfilePayload(profileType, profile) {
      return {
        app: "cassette-optimizer",
        version: 1,
        profileType,
        exportedAt: new Date().toISOString(),
        profile: profileType === "deck" ? serializeDeckProfile(profile) : profile
      };
    }

    function serializeDeckProfile(profile) {
      return {
        ...profile,
        recordingDelayCalibration: buildRecordingDelayCalibration(profile)
      };
    }

    function normalizeDeckProfile(profile) {
      if (!profile || typeof profile !== "object") return profile;
      const calibration = profile.recordingDelayCalibration && typeof profile.recordingDelayCalibration === "object"
        ? profile.recordingDelayCalibration
        : null;
      const normalized = {
        ...profile,
        leaderTapeDelay: typeof profile.leaderTapeDelay === "number" ? profile.leaderTapeDelay : calibration?.leaderTapeDelay,
        motorLatency: typeof profile.motorLatency === "number" ? profile.motorLatency : calibration?.motorLatency,
        safetyMargin: typeof profile.safetyMargin === "number" ? profile.safetyMargin : calibration?.safetyMargin
      };
      normalized.recordingDelayCalibration = buildRecordingDelayCalibration(normalized);
      return normalized;
    }

    function buildRecordingDelayCalibration(profile) {
      return {
        leaderTapeDelay: clampNumber(profile?.leaderTapeDelay, 0, 120),
        motorLatency: clampNumber(profile?.motorLatency, 0, 30),
        safetyMargin: clampSeconds(profile?.safetyMargin, 0, 300)
      };
    }

    /**
     * Exports all local profile/config data into a folder tree.
     *
     * Steps:
     * 1. Ask the user to choose a writable directory with the File System Access API.
     * 2. Create a `profiles` folder with dedicated subfolders for decks, cassettes, playlists, and tape collection data.
     * 3. Write every deck and cassette profile as its own JSON file.
     * 4. Write the current playlist project, unprofiled inventory, owned cassette collection, and a manifest.
     *
     * @returns {Promise<void>} Resolves after the folder export succeeds or a user-visible unsupported-browser message is shown.
     * @throws {DOMException} May throw if the user denies directory access or the browser blocks file writes.
     *
     * Side effects: Prompts for a local folder and writes JSON files into that folder; does not modify localStorage.
     */
    async function exportProfileFolder() {
      if (!window.showDirectoryPicker) {
        el.profileStatus.textContent = "Profile folder export needs a browser with folder write access.";
        log("Profile folder export is not supported in this browser.");
        return;
      }
      try {
        const root = await window.showDirectoryPicker({ mode: "readwrite" });
        const profilesDir = await getOrCreateDirectory(root, "profiles");
        const deckDir = await getOrCreateDirectory(profilesDir, "deck-profiles");
        const cassetteDir = await getOrCreateDirectory(profilesDir, "cassette-profiles");
        const playlistDir = await getOrCreateDirectory(profilesDir, "playlist-profiles");
        const collectionDir = await getOrCreateDirectory(profilesDir, "tape-collection");
        const exportedAt = new Date().toISOString();
        for (const profile of loadDeckProfiles()) {
          await writeJsonFile(deckDir, `${profileFilename(profile.name, profile.id)}.json`, { version: 1, exportedAt, profile: serializeDeckProfile(profile) });
        }
        for (const profile of loadCassetteProfiles()) {
          await writeJsonFile(cassetteDir, `${profileFilename(profile.name, profile.id)}.json`, { version: 1, exportedAt, profile });
        }
        await writeJsonFile(collectionDir, "owned-cassettes.json", { version: 1, exportedAt, tapeCollection: state.tapeCollection });
        await writeJsonFile(collectionDir, "unprofiled-inventory.json", { version: 1, exportedAt, tapeInventory: state.tapeInventory });
        if (state.project) {
          await writeJsonFile(playlistDir, `${profileFilename(state.project.projectTitle, state.project.sourcePlaylistId || "current")}.json`, buildPlaylistProfilePayload(exportedAt));
        }
        await writeJsonFile(profilesDir, "manifest.json", {
          app: "cassette-optimizer",
          version: 1,
          exportedAt,
          folders: ["deck-profiles", "cassette-profiles", "playlist-profiles", "tape-collection"]
        });
        el.profileStatus.textContent = "Profile folder exported.";
        log("Profile folder exported.");
      } catch (error) {
        if (error?.name === "AbortError") return;
        el.profileStatus.textContent = `Profile folder export failed: ${error.message}`;
        log(`Profile folder export failed: ${error.message}`);
      }
    }

    /**
     * Imports all local profile/config data from a folder tree.
     *
     * Steps:
     * 1. Ask the user to choose a readable directory with the File System Access API.
     * 2. Locate a `profiles` folder, or treat the selected folder itself as the profile root.
     * 3. Read deck, cassette, playlist, and tape collection JSON files from their subfolders.
     * 4. Merge deck and cassette profiles by id, restore collection/inventory data, and optionally import the first playlist project.
     * 5. Re-render profile, inventory, planning, and recording UI from the imported state.
     *
     * @returns {Promise<void>} Resolves after folder import succeeds or a user-visible unsupported-browser message is shown.
     * @throws {DOMException} May throw if the user denies directory access or the browser blocks file reads.
     *
     * Side effects: Prompts for a local folder, reads JSON files, writes profile and inventory localStorage, may replace the current project, and re-renders UI.
     */
    async function importProfileFolder() {
      if (!window.showDirectoryPicker) {
        el.profileStatus.textContent = "Profile folder import needs a browser with folder read access.";
        log("Profile folder import is not supported in this browser.");
        return;
      }
      try {
        if (blockIfRecordingLocked("Import profile folder")) return;
        const root = await window.showDirectoryPicker({ mode: "read" });
        const profilesDir = await getDirectoryIfExists(root, "profiles") || root;
        const deckDir = await getDirectoryIfExists(profilesDir, "deck-profiles");
        const cassetteDir = await getDirectoryIfExists(profilesDir, "cassette-profiles");
        const playlistDir = await getDirectoryIfExists(profilesDir, "playlist-profiles");
        const collectionDir = await getDirectoryIfExists(profilesDir, "tape-collection");
        const deckProfiles = (await readJsonFilesFromDirectory(deckDir)).map(payload => payload.profile || payload).filter(isValidDeckProfile);
        const cassetteProfiles = (await readJsonFilesFromDirectory(cassetteDir)).map(payload => payload.profile || payload).filter(isValidCassetteProfile);
        saveDeckProfiles(mergeProfilesById(loadDeckProfiles(), deckProfiles));
        saveCassetteProfiles(mergeProfilesById(loadCassetteProfiles(), cassetteProfiles));
        if (collectionDir) {
          const owned = await readJsonFileIfExists(collectionDir, "owned-cassettes.json");
          const unprofiled = await readJsonFileIfExists(collectionDir, "unprofiled-inventory.json");
          if (Array.isArray(owned?.tapeCollection)) {
            state.tapeCollection = owned.tapeCollection.filter(item => item && typeof item === "object" && typeof item.cassetteProfileId === "string");
            saveTapeCollection();
          }
          if (unprofiled?.tapeInventory) {
            state.tapeInventory = normalizeTapeInventory(unprofiled.tapeInventory, state.availableTapeFormats);
            localStorage.setItem("tape_inventory", JSON.stringify(state.tapeInventory));
          }
        }
        const playlistPayloads = await readJsonFilesFromDirectory(playlistDir);
        if (playlistPayloads.length && (!state.projectDirty || await confirmReplaceDirtyProject())) {
          const payload = migrateImportedConfig(playlistPayloads[0]);
          const project = normalizeImportedConfig(payload);
          state.importError = "";
          state.lastImportMissingUriCount = countMissingTrackUris(project);
          if (Array.isArray(payload.tapeCollection)) {
            state.tapeCollection = payload.tapeCollection;
            saveTapeCollection();
          }
          state.tapeMinutes = project.tapes[project.selectedTapeIndex]?.tapeFormat || state.availableTapeFormats[0] || 90;
          setProject(project);
        }
        state.availableTapeFormats = getAvailableTapeFormats();
        renderProfileControls();
        renderTapeOptions();
        renderTapeInventory();
        renderSlackMargin();
        renderCalibration();
        renderSplit();
        el.profileStatus.textContent = `Imported ${deckProfiles.length} deck profile(s), ${cassetteProfiles.length} cassette profile(s), and ${state.tapeCollection.length} owned cassette(s).`;
        log(el.profileStatus.textContent);
      } catch (error) {
        if (error?.name === "AbortError") return;
        el.profileStatus.textContent = `Profile folder import failed: ${error.message}`;
        log(`Profile folder import failed: ${error.message}`);
      }
    }

    function buildPlaylistProfilePayload(exportedAt) {
      syncStateFromProject();
      return {
        app: "cassette-optimizer",
        version: 1,
        exportedAt,
        projectTitle: state.project.projectTitle,
        playlistId: state.project.sourcePlaylistId,
        playlistName: state.project.sourcePlaylistName,
        playlistCoverUrl: state.project.coverUrl,
        selectedTapeIndex: state.project.selectedTapeIndex,
        selectedTapeMinutes: selectedTapeMinutes(),
        availableTapeFormats: getAvailableTapeFormats(),
        tapeInventory: getTapeInventory(),
        tapeCollection: state.tapeCollection,
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
    }

    async function getOrCreateDirectory(parent, name) {
      return parent.getDirectoryHandle(name, { create: true });
    }

    async function getDirectoryIfExists(parent, name) {
      if (!parent) return null;
      try {
        return await parent.getDirectoryHandle(name);
      } catch {
        return null;
      }
    }

    async function readJsonFilesFromDirectory(directory) {
      if (!directory) return [];
      const payloads = [];
      for await (const entry of directory.values()) {
        if (entry.kind !== "file" || !entry.name.endsWith(".json")) continue;
        const file = await entry.getFile();
        try {
          payloads.push(JSON.parse(await file.text()));
        } catch {
          log(`Skipping unreadable JSON file: ${entry.name}`);
        }
      }
      return payloads;
    }

    async function readJsonFileIfExists(directory, filename) {
      try {
        const handle = await directory.getFileHandle(filename);
        const file = await handle.getFile();
        return JSON.parse(await file.text());
      } catch {
        return null;
      }
    }

    async function writeJsonFile(directory, filename, payload) {
      const file = await directory.getFileHandle(filename, { create: true });
      const writable = await file.createWritable();
      await writable.write(JSON.stringify(payload, null, 2));
      await writable.close();
    }

    function profileFilename(name, id) {
      return `${slugify(name || id || "profile")}-${slugify(id || "profile")}`;
    }

    /**
     * Imports deck and cassette profiles from a JSON file.
     *
     * Steps:
     * 1. Read the selected File with FileReader.
     * 2. Parse JSON and validate the top-level profile export structure.
     * 3. Validate each deck and cassette profile independently.
     * 4. Merge imported profiles with local profiles by id, overwriting matches and adding new ids.
     * 5. Save the merged arrays and re-render selectors plus timing-dependent views.
     *
     * @param {File} file - JSON profile export selected by the user.
     * @returns {Promise<void>} Resolves after import succeeds or a user-visible validation error is shown.
     * @throws {Error} Does not intentionally throw; file, parse, and validation failures are caught and shown in the UI.
     *
     * Side effects: Reads a local File object, writes profile localStorage keys, re-renders profile selectors, and recomputes timing-dependent UI.
     */
    function importProfiles(file) {
      return new Promise(resolve => {
        const reader = new FileReader();
        reader.onerror = () => {
          el.profileStatus.textContent = "Could not read file — make sure it is a valid profiles export.";
          resolve();
        };
        reader.onload = () => {
          try {
            // The selected File is read as text so JSON.parse can validate the export payload before storage is modified.
            const payload = JSON.parse(String(reader.result || ""));
            // Future versions may introduce migration logic here if the profile schema changes.
            const version = Number(payload.version || 1);
            if (version !== 1) console.warn(`Unknown profile export version ${version}; attempting version 1 import.`);
            // Validate the top-level export structure before any merge so malformed files cannot partially overwrite storage.
            if (!Array.isArray(payload.deckProfiles) || !Array.isArray(payload.cassetteProfiles)) {
              el.profileStatus.textContent = "Could not read file — make sure it is a valid profiles export.";
              resolve();
              return;
            }
            const validDecks = payload.deckProfiles.filter(profile => {
              const valid = isValidDeckProfile(profile);
              // Invalid entries are skipped individually rather than aborting the import — a single malformed profile should not prevent valid profiles from being imported.
              if (!valid) console.warn("Skipping invalid deck profile import entry.", profile);
              return valid;
            });
            const validCassettes = payload.cassetteProfiles.filter(profile => {
              const valid = isValidCassetteProfile(profile);
              // Invalid entries are skipped individually rather than aborting the import — a single malformed profile should not prevent valid profiles from being imported.
              if (!valid) console.warn("Skipping invalid cassette profile import entry.", profile);
              return valid;
            });
            const activeDeckId = getActiveDeck()?.id;
            const activeCassetteId = getActiveCassette()?.id;
            // Merge rather than replace so the user does not lose profiles that were created locally after the export was made.
            saveDeckProfiles(mergeProfilesById(loadDeckProfiles(), validDecks));
            // Merge rather than replace so the user does not lose profiles that were created locally after the export was made.
            saveCassetteProfiles(mergeProfilesById(loadCassetteProfiles(), validCassettes));
            if (activeDeckId && loadDeckProfiles().some(profile => profile.id === activeDeckId)) setActiveDeck(activeDeckId);
            if (activeCassetteId && loadCassetteProfiles().some(profile => profile.id === activeCassetteId)) setActiveCassette(activeCassetteId);
            renderProfileControls();
            recomputeTimingDependentViews(`Imported ${validDecks.length} deck(s) and ${validCassettes.length} cassette(s).`);
          } catch {
            el.profileStatus.textContent = "Could not read file — make sure it is a valid profiles export.";
          }
          resolve();
        };
        reader.readAsText(file);
      });
    }

    async function importSingleProfile(file, profileType) {
      try {
        const payload = JSON.parse(await file.text());
        const profiles = extractProfilesFromPayload(payload, profileType);
        if (!profiles.length) {
          el.profileStatus.textContent = `Could not read file - make sure it is a valid ${profileType} profile export.`;
          return;
        }
        if (profileType === "deck") {
          saveDeckProfiles(mergeProfilesById(loadDeckProfiles(), profiles));
          setActiveDeck(profiles[0].id);
          renderProfileControls();
          recomputeTimingDependentViews(`Imported deck profile "${profiles[0].name}".`);
          return;
        }
        saveCassetteProfiles(mergeProfilesById(loadCassetteProfiles(), profiles));
        setActiveCassette(profiles[0].id);
        if (profiles[0].lengthMinutes) setTapeLengthFromProfile(profiles[0].lengthMinutes);
        renderProfileControls();
        recomputeTimingDependentViews(`Imported cassette profile "${profiles[0].name}".`);
      } catch {
        el.profileStatus.textContent = `Could not read file - make sure it is a valid ${profileType} profile export.`;
      }
    }

    function extractProfilesFromPayload(payload, profileType) {
      const candidates = [];
      if (payload?.profile) candidates.push(payload.profile);
      if (profileType === "deck" && Array.isArray(payload?.deckProfiles)) candidates.push(...payload.deckProfiles);
      if (profileType === "cassette" && Array.isArray(payload?.cassetteProfiles)) candidates.push(...payload.cassetteProfiles);
      if (!candidates.length) candidates.push(payload);
      const validator = profileType === "deck" ? isValidDeckProfile : isValidCassetteProfile;
      return candidates
        .map(profile => profileType === "deck" ? normalizeDeckProfile(profile) : profile)
        .filter(validator);
    }

    function isValidDeckProfile(profile) {
      return profile && typeof profile === "object"
        && typeof profile.id === "string"
        && typeof profile.name === "string"
        && (profile.manufacturer === undefined || typeof profile.manufacturer === "string")
        && (profile.model === undefined || typeof profile.model === "string")
        && typeof profile.leaderTapeDelay === "number"
        && typeof profile.motorLatency === "number"
        && typeof profile.safetyMargin === "number"
        && (profile.recordingDelayCalibration === undefined || profile.recordingDelayCalibration === null || typeof profile.recordingDelayCalibration === "object")
        && typeof profile.defaultSlackMargin === "number"
        && (profile.autoRecordingLevel === undefined || profile.autoRecordingLevel === null || typeof profile.autoRecordingLevel === "number")
        && (profile.typeIVSupport === undefined || typeof profile.typeIVSupport === "boolean")
        && (profile.notes === undefined || typeof profile.notes === "string");
    }

    function isValidCassetteProfile(profile) {
      return profile && typeof profile === "object"
        && typeof profile.id === "string"
        && typeof profile.name === "string"
        && (profile.manufacturer === undefined || typeof profile.manufacturer === "string")
        && (profile.model === undefined || typeof profile.model === "string")
        && (profile.type === "I" || profile.type === "II")
        && typeof profile.lengthMinutes === "number"
        && (profile.year === undefined || profile.year === null || typeof profile.year === "number")
        && (profile.condition === undefined || profile.condition === null || typeof profile.condition === "object");
    }

    function mergeProfilesById(existingProfiles, importedProfiles) {
      const merged = new Map((Array.isArray(existingProfiles) ? existingProfiles : []).map(profile => [profile.id, profile]));
      for (const profile of importedProfiles) {
        // Imported ids overwrite local matches, while new ids are appended through the same map.
        merged.set(profile.id, profile);
      }
      return [...merged.values()];
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
        cassetteProfileId: String(tape.cassetteProfileId || ""),
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
        cassetteProfileId: tape.cassetteProfileId || "",
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
          inventory[minutes] = 0;
        }
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
        el.tapePlanSelect.innerHTML = `<option value="0">${state.project ? "No readable tracks" : "Load a playlist first"}</option>`;
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
      if (!state.project || !state.tapeLayouts.length) {
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
        const cassetteOptions = renderCassetteModelOptions(layout, index, selectedMinutes);
        return `<label class="tape-format-row">
          <span>Tape ${layout.tapeNumber || layout.number}</span>
          <select data-tape-format-index="${index}">${options}</select>
          <select data-tape-cassette-index="${index}" aria-label="Tape ${layout.tapeNumber || layout.number} cassette model">${cassetteOptions}</select>
          <em>${formatLongTime(runtime)} planned / ${formatLongTime(sideLength * 2)} capacity</em>
        </label>`;
      }).join("");
    }

    function renderCassetteModelOptions(layout, index, selectedMinutes) {
      const selectedProfileId = layout.cassetteProfileId || "";
      const usedByOtherTapes = countTapeProfiles(index);
      const collectionCounts = countCollectionProfiles();
      const profiles = loadCassetteProfiles().filter(profile => {
        const profileMinutes = Number(profile.lengthMinutes);
        const remaining = (collectionCounts[profile.id] || 0) - (usedByOtherTapes[profile.id] || 0);
        return profile.id === selectedProfileId || (profileMinutes === selectedMinutes && remaining > 0);
      });
      const emptySelected = selectedProfileId ? "" : " selected";
      const options = [`<option value=""${emptySelected}>No exact model</option>`];
      for (const profile of profiles) {
        const selected = profile.id === selectedProfileId ? " selected" : "";
        const owned = collectionCounts[profile.id] || 0;
        options.push(`<option value="${escapeHtml(profile.id)}"${selected}>${escapeHtml(profile.name)} - C${profile.lengthMinutes} (${owned} owned)</option>`);
      }
      return options.join("");
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

    function countTapeProfiles(exceptIndex = -1) {
      const counts = {};
      for (const [index, layout] of state.tapeLayouts.entries()) {
        if (index === exceptIndex || !layout.cassetteProfileId) continue;
        counts[layout.cassetteProfileId] = (counts[layout.cassetteProfileId] || 0) + 1;
      }
      return counts;
    }

    function countCollectionProfiles() {
      const counts = {};
      for (const item of state.tapeCollection) {
        counts[item.cassetteProfileId] = (counts[item.cassetteProfileId] || 0) + 1;
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
        const trackLabel = Number.isFinite(playlist.tracks) ? `${playlist.tracks} tracks` : "tracks unknown";
        const label = `${playlist.name} - ${trackLabel} - ${visibility}`;
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
        // Token/device availability changed, so Recording Readiness must show the disconnected device state.
        renderReadiness();
        return;
      }
      el.loadDevicesBtn.disabled = false;
      if (!state.devices.length) {
        el.deviceSelect.innerHTML = `<option value="">Select a device</option>`;
        el.deviceSelect.disabled = true;
        renderEmptyStates();
        // Device refresh found no active devices, so Recording Readiness must show the device row as blocked.
        renderReadiness();
        return;
      }
      el.deviceSelect.innerHTML = `<option value="">Select a device</option>` + state.devices.map(device => {
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
      // Device options changed, so Recording Readiness must re-evaluate the selected/active device row.
      renderReadiness();
    }

    function renderTracks(container, tracks, offset) {
      if (!tracks.length) {
        const message = state.project ? "No readable tracks for this side." : "Load a playlist to calculate this side.";
        container.innerHTML = `<p class="small">${escapeHtml(message)}</p>`;
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

    /**
     * Renders cassette, Spotify, and recording readiness warnings.
     *
     * It compares planned duration against selected tape capacity, checks
     * per-side overflow and manual split constraints, reports missing Spotify
     * URI data, validates inventory and deck checklist readiness, and includes
     * calibration safety-margin warnings.
     *
     * @param {number} totalMs - Total selected tape-plan duration.
     * @param {number} tapeMs - Total capacity for the selected tape.
     * @param {number} halfMs - Side capacity for the selected tape including configured slack.
     * @returns {void}
     * @throws {Error} Does not throw directly.
     *
     * Side effects: Mutates the warnings DOM text.
     */
    function renderWarnings(totalMs, tapeMs, halfMs) {
      const messages = [];
      const selectedTotalMs = duration(sideA()) + duration(sideB());
      const tracks = projectTracks();
      const selectedLayout = selectedTapeLayout();
      const missingUris = countMissingTrackUris(state.project || { sourceTracks: tracks, tapes: state.tapeLayouts });
      const checklistReady = isAudioChecklistConfirmed();
      // Official side length excludes user slack so the UI can warn when the plan depends on unofficial extra tape.
      const officialSideLengthMs = selectedTapeMinutes() * 30 * 1000;
      const timing = getEffectiveTimingSettings();
      // Previously read directly from #slackMargin; now computed from active deck + cassette profiles via getEffectiveTimingSettings().
      const usesSlack = timing.slackMargin > 0 && (duration(sideA()) > officialSideLengthMs || duration(sideB()) > officialSideLengthMs);
      if (usesSlack) {
        messages.push("Uses unofficial extra tape length. Real cassette may still run out.");
      }
      for (const track of tracks) {
        if (track.duration_ms > halfMs) {
          // A single overlong track cannot be split across sides, so it must be reported even when order is preserved.
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
      if (state.token && !state.dryRun && !isSpotifyDeviceReady()) {
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
        // Overflowing Side B remains visible so the user can see which whole tracks no longer fit.
        messages.push(`Side B exceeds ${formatTime(halfMs)}. Extra tracks remain listed so original order is preserved.`);
      }
      for (const layout of state.tapeLayouts) {
        // Each tape can have its own format, so overflow must be checked per layout rather than only selected tape.
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
      // Previously read directly from #safetyMargin; now computed from active deck + cassette profiles via getEffectiveTimingSettings().
      const safetyMs = timing.safetyMargin * 1000;
      if (tracks.length && safetyMs) {
        if (halfMs - duration(sideA()) < safetyMs) messages.push(`Side A has less than the configured ${timing.safetyMargin}s safety margin remaining.`);
        if (duration(sideB()) && halfMs - duration(sideB()) < safetyMs) messages.push(`Side B has less than the configured ${timing.safetyMargin}s safety margin remaining.`);
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
      } else if (!state.project && !tracks.length) {
        inputMessages.push(["No playlist loaded", state.token ? "Paste a playlist URL or choose one from your Spotify playlists, then load it." : "Connect Spotify or import a saved cassette config."]);
      }

      if (!tracks.length) {
        splitMessages.push(state.project
          ? ["No readable tracks", "Spotify did not allow this token to read track items for the loaded playlist."]
          : ["No usable tracks", "The split view will update after a playlist or config with playable track durations is loaded."]
        );
      } else if (!sideA().length && !sideB().length) {
        splitMessages.push(["Playlist has no usable tracks", "Spotify local files or unavailable items were skipped."]);
      }

      if (!state.token && !state.dryRun) {
        playbackMessages.push(["Spotify not connected", "Connect Spotify before controlling playback, or enable Dry Run to test timing only."]);
      } else if (state.token && !state.devices.length && !isSpotifyDeviceReady()) {
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
      // Previously read directly from #slackMargin; now computed from active deck + cassette profiles via getEffectiveTimingSettings().
      return getEffectiveTimingSettings().slackMargin * 1000;
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
      log("Run npm run start:local, then open http://127.0.0.1:8787. Spotify OAuth will not complete from file://.");
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
