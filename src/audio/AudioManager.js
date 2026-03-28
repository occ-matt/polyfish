/**
 * AudioManager — Web Audio API based audio system for PolyFish.
 *
 * Handles three channels: music (playlist), narration, and SFX.
 * Music plays as a shuffled playlist with crossfade support.
 * All audio requires a user gesture to unlock (browser autoplay policy).
 */
import * as THREE from 'three';

// Reusable temp vectors for spatial audio listener updates (avoid per-frame allocation)
const _listenerPos = new THREE.Vector3();
const _listenerForward = new THREE.Vector3();
const _listenerUp = new THREE.Vector3();
const _listenerQuat = new THREE.Quaternion();

const MUSIC_TRACKS = [
  '/audio/music/purrple-cat-field-of-fireflies.mp3',
  '/audio/music/alex-productions-wonders.mp3',
  '/audio/music/alex-productions-once-upon-a-time.mp3',
];

const NARRATION_CLIPS = {
  welcome:          '/audio/narration/welcome.mp3',
  polyfish_intro:   '/audio/narration/polyfish_intro.mp3',
  manatee_intro:    '/audio/narration/manatee_intro.mp3',
  dolphin_intro:    '/audio/narration/dolphin_intro.mp3',
  outro:            '/audio/narration/outro.mp3',
};

const AMBIENCE_TRACK = '/audio/ambience/underwater_sea_diving_bubbles_loop_01.mp3';

const CREDITS_TRACK = '/audio/music/alex-productions-once-upon-a-time.mp3';

/**
 * SFX variants — each category has an array of file paths.
 * playSFXVariant(category) picks one at random.
 */
const SFX_VARIANTS = {
  birth: [
    '/audio/sfx/birth/collect_item_sparkle_pop_13.mp3',
    '/audio/sfx/birth/collect_item_sparkle_pop_14.mp3',
    '/audio/sfx/birth/collect_item_sparkle_pop_15.mp3',
  ],
  feed: [
    '/audio/sfx/feed/fish-eat/shaker_sprinkle_seeds_cook_garden_01.mp3',
    '/audio/sfx/feed/fish-eat/shaker_sprinkle_seeds_cook_garden_02.mp3',
    '/audio/sfx/feed/fish-eat/shaker_sprinkle_seeds_cook_garden_03.mp3',
    '/audio/sfx/feed/fish-eat/shaker_sprinkle_seeds_cook_garden_04.mp3',
  ],
  impact: [
    '/audio/sfx/impact/impact_deep_thud_bounce_01.mp3',
    '/audio/sfx/impact/impact_deep_thud_bounce_02.mp3',
    '/audio/sfx/impact/impact_deep_thud_bounce_03.mp3',
    '/audio/sfx/impact/impact_deep_thud_bounce_04.mp3',
    '/audio/sfx/impact/impact_deep_thud_bounce_05.mp3',
    '/audio/sfx/impact/impact_deep_thud_bounce_06.mp3',
    '/audio/sfx/impact/impact_deep_thud_bounce_07.mp3',
    '/audio/sfx/impact/impact_deep_thud_bounce_08.mp3',
    '/audio/sfx/impact/impact_deep_thud_bounce_09.mp3',
    '/audio/sfx/impact/impact_deep_thud_bounce_10.mp3',
  ],
  poo: [
    '/audio/sfx/poo/poo.mp3',
  ],
  spawn: [
    '/audio/sfx/spawn/user-spawn-food/ui_menu_button_click_12.mp3',
    '/audio/sfx/spawn/user-spawn-food/ui_menu_button_click_13.mp3',
  ],
  throw: [
    '/audio/sfx/throw/user-throw-food/ui_menu_button_click_14.mp3',
  ],
  uiStart: [
    '/audio/sfx/ui/click-start.mp3',
  ],
  gameOver: [
    '/audio/sfx/ui/game-over.mp3',
  ],
};

/** Per-category volume multipliers (relative to sfxGain). 1.0 = full volume. */
const SFX_VOLUME = {
  birth: 0.5,
  feed:  0.5,
  poo:   0.5,
};

export class AudioManager {
  constructor() {
    /** @type {AudioContext|null} */
    this.ctx = null;

    // Gain nodes (channel strips)
    this.musicGain = null;
    this.narrationGain = null;
    this.sfxGain = null;
    this.masterGain = null;

    // Volume targets
    this.musicVolume = 0.25;
    this.narrationVolume = 0.85;
    this.sfxVolume = 0.5;

    // Decoded buffers
    /** @type {Map<string, AudioBuffer>} */
    this.buffers = new Map();

    // Music playlist state (streaming via <audio> elements)
    this.playlist = [...MUSIC_TRACKS];
    this.playlistIndex = 0;
    /** @type {HTMLAudioElement|null} */
    this._musicEl = null;
    /** @type {MediaElementAudioSourceNode|null} */
    this._musicSource = null;
    this.musicPlaying = false;

    // Ambience
    this.ambienceGain = null;
    this.ambienceVolume = 0.35;
    /** @type {AudioBufferSourceNode|null} */
    this.currentAmbienceSource = null;

    // Narration
    /** @type {AudioBufferSourceNode|null} */
    this.currentNarrationSource = null;

    this.initialized = false;
    this.unlocked = false;
    this.clipsLoaded = false; // True after priority audio files are decoded
    this._creditsMode = false; // True when playing credits track (suppresses playlist advance)
  }

  /**
   * Initialize the audio context and pre-load all clips.
   * Must be called once. Actual playback won't work until unlock().
   */
  async init() {
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();

      // Build signal chain: source → channel gain → master gain → destination
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 1.0;
      this.masterGain.connect(this.ctx.destination);

      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = this.musicVolume;
      this.musicGain.connect(this.masterGain);

      this.narrationGain = this.ctx.createGain();
      this.narrationGain.gain.value = this.narrationVolume;
      this.narrationGain.connect(this.masterGain);

      this.sfxGain = this.ctx.createGain();
      this.sfxGain.gain.value = this.sfxVolume;
      this.sfxGain.connect(this.masterGain);

      this.ambienceGain = this.ctx.createGain();
      this.ambienceGain.gain.value = 0; // starts silent, faded in by startAmbience()
      this.ambienceGain.connect(this.masterGain);

      // Listen for user gesture to unlock (multiple event types for broad compat)
      const unlockHandler = () => {
        this._unlock();
        document.removeEventListener('click', unlockHandler);
        document.removeEventListener('keydown', unlockHandler);
        document.removeEventListener('touchstart', unlockHandler);
        document.removeEventListener('touchend', unlockHandler);
      };
      document.addEventListener('click', unlockHandler);
      document.addEventListener('keydown', unlockHandler);
      document.addEventListener('touchstart', unlockHandler);
      document.addEventListener('touchend', unlockHandler);

      // Clips are loaded separately via loadClips() — called after heavy init is done
      this.initialized = true;
    } catch (err) {
      console.warn('[AudioManager] Web Audio not available:', err);
    }
  }

  /** Resume context after user gesture */
  /**
   * Load all audio clips. Call AFTER heavy init (models, WASM) is done
   * so audio decoding doesn't compete with startup.
   */
  async loadClips() {
    if (!this.ctx) return;
    await this._loadAll();
    this.clipsLoaded = true;
    // Start ambience as soon as clips are ready (if context is unlocked)
    if (this.unlocked) {
      this.startAmbience();
    }
  }

  _unlock() {
    if (this.unlocked) return;
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
    this.unlocked = true;
    // Start ambience on first user gesture (if clips are loaded)
    if (this.clipsLoaded) {
      this.startAmbience();
    }
  }

  /**
   * Load audio in two phases:
   *   Phase 1 (priority): narration, ambience, SFX variant 0 per category
   *   Phase 2 (deferred): remaining SFX variants, loaded progressively
   *
   * Music is NOT loaded here - it streams via <audio> elements.
   */
  async _loadAll() {
    // Phase 1: priority clips (small total, fast decode)
    const priority = [];

    // Narration clips
    for (const [key, url] of Object.entries(NARRATION_CLIPS)) {
      priority.push(this._loadClip(key, url));
    }

    // SFX variant 0 per category (guarantees at least one clip available)
    for (const [category, urls] of Object.entries(SFX_VARIANTS)) {
      if (urls.length > 0) {
        priority.push(this._loadClip(`sfx_${category}_0`, urls[0]));
      }
    }

    // Ambience
    priority.push(this._loadClip('ambience', AMBIENCE_TRACK));

    await Promise.allSettled(priority);

    // Phase 2: backfill remaining SFX variants (non-blocking)
    this._loadDeferredSFX();
  }

  /**
   * Progressively load remaining SFX variants (index 1+) without
   * blocking init. Loads one clip at a time to avoid CPU/decode spikes.
   */
  async _loadDeferredSFX() {
    for (const [category, urls] of Object.entries(SFX_VARIANTS)) {
      for (let i = 1; i < urls.length; i++) {
        const key = `sfx_${category}_${i}`;
        if (!this.buffers.has(key)) {
          await this._loadClip(key, urls[i]);
        }
      }
    }
  }

  /** Fetch and decode a single audio file */
  async _loadClip(key, url) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        console.warn(`[AudioManager] Failed to fetch ${url}: ${response.status}`);
        return;
      }
      const arrayBuffer = await response.arrayBuffer();
      const audioBuffer = await this.ctx.decodeAudioData(arrayBuffer);
      this.buffers.set(key, audioBuffer);
    } catch (err) {
      console.warn(`[AudioManager] Error loading ${key}:`, err.message);
    }
  }

  // ── Music Playlist (streaming via <audio> element) ─────────

  /**
   * Play the next music track using a streaming <audio> element.
   * This avoids downloading and decoding the full file upfront,
   * saving ~12 MB of fetch and ~13 MB of decoded PCM memory.
   */
  _playNextTrack() {
    if (!this.ctx || !this.initialized) return;

    // Shuffle on first pass
    if (this.playlistIndex === 0) {
      this._shuffle(this.playlist);
    }

    this._creditsMode = false;
    const url = this.playlist[this.playlistIndex];

    // Reuse or create the <audio> element
    if (!this._musicEl) {
      this._musicEl = new Audio();
      this._musicEl.crossOrigin = 'anonymous';
      this._musicEl.preload = 'auto';

      // Create MediaElementSource once (can only call this once per element)
      this._musicSource = this.ctx.createMediaElementSource(this._musicEl);
      this._musicSource.connect(this.musicGain);

      this._musicEl.addEventListener('ended', () => {
        if (!this._creditsMode) {
          this.playlistIndex = (this.playlistIndex + 1) % this.playlist.length;
          this._playNextTrack();
        } else {
          this.musicPlaying = false;
          this._creditsMode = false;
        }
      });

      this._musicEl.addEventListener('error', (e) => {
        console.warn('[AudioManager] Music stream error:', e);
        // Skip to next track on error
        this.playlistIndex = (this.playlistIndex + 1) % this.playlist.length;
        setTimeout(() => this._playNextTrack(), 1000);
      });
    }

    this._musicEl.src = url;
    this._musicEl.play().catch(err => {
      // Autoplay blocked or load error - retry after short delay
      console.warn('[AudioManager] Music play failed, retrying:', err.message);
      setTimeout(() => this._musicEl.play().catch(() => {}), 500);
    });
    this.musicPlaying = true;
  }

  _shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  }

  // ── Public API ──────────────────────────────────────────────

  /**
   * Play a narration clip by key (e.g. 'welcome', 'polyfish_intro').
   */
  playNarration(key) {
    if (!this.ctx || !this.initialized) {
      // Narration not ready yet
      return;
    }

    const buffer = this.buffers.get(key);
    if (!buffer) {
      console.warn(`[AudioManager] Narration clip not found: ${key}`);
      return;
    }

    // Stop any currently playing narration
    if (this.currentNarrationSource) {
      try { this.currentNarrationSource.stop(); } catch (e) { /* ignore */ }
    }

    // Duck music while narration plays
    this._duckMusic(true);

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.narrationGain);
    source.onended = () => {
      this.currentNarrationSource = null;
      this._duckMusic(false);
    };
    source.start(0);
    this.currentNarrationSource = source;

    // Narration started
  }

  /** Duck music volume during narration, restore after */
  _duckMusic(duck) {
    if (!this.musicGain) return;
    const target = duck ? this.musicVolume * 0.3 : this.musicVolume;
    const now = this.ctx.currentTime;
    this.musicGain.gain.cancelScheduledValues(now);
    this.musicGain.gain.setValueAtTime(this.musicGain.gain.value, now);
    this.musicGain.gain.linearRampToValueAtTime(target, now + 0.8);
  }

  /**
   * Fade music volume to a target over duration (seconds).
   * Used by restart sequence to fade out music.
   */
  fadeMusic(targetVolume, duration) {
    if (!this.musicGain || !this.ctx) {
      // Fade not ready yet
      return;
    }
    const now = this.ctx.currentTime;
    this.musicGain.gain.cancelScheduledValues(now);
    this.musicGain.gain.setValueAtTime(this.musicGain.gain.value, now);
    this.musicGain.gain.linearRampToValueAtTime(targetVolume, now + duration);
  }

  /**
   * Stop music playback entirely.
   */
  stopMusic() {
    if (this._musicEl) {
      this._musicEl.pause();
      this._musicEl.currentTime = 0;
    }
    this.musicPlaying = false;
  }

  /**
   * Stop narration playback.
   */
  stopNarration() {
    if (this.currentNarrationSource) {
      this.currentNarrationSource.onended = null;
      try { this.currentNarrationSource.stop(); } catch (e) { /* ignore */ }
      this.currentNarrationSource = null;
    }
    this._duckMusic(false);
  }

  /**
   * Stop all audio (music + narration). Used when switching away from narrative mode.
   */
  stopAll() {
    this.stopMusic();
    this.stopNarration();
    this.stopAmbience();
  }

  /**
   * Restart music playlist (e.g. after ecosystem restart).
   * Fades volume back up smoothly to avoid clipping.
   */
  restartMusic() {
    this.stopMusic();
    this.playlistIndex = 0;

    // Ensure the AudioContext is running. On mobile (especially iOS Safari),
    // the context may still be suspended if the unlock handler didn't fire
    // (e.g. stopPropagation on the title button prevented the click from
    // reaching the document-level handler). Since restartMusic is always
    // called from a user gesture (title button click), resume() works here.
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
    this.unlocked = true;

    if (this.musicGain && this.ctx) {
      // Start at zero and fade up over 2 seconds to avoid pop/clip
      const now = this.ctx.currentTime;
      this.musicGain.gain.cancelScheduledValues(now);
      this.musicGain.gain.setValueAtTime(0, now);
      this.musicGain.gain.linearRampToValueAtTime(this.musicVolume, now + 2.0);
    }
    // Music streams on demand - no need to wait for buffer loading
    this._playNextTrack();
  }

  /**
   * Play the credits track with a fade-in. Uses the music gain channel
   * so fadeMusic() and stopMusic() work on it. Streams via <audio> element.
   */
  playCreditsTrack() {
    this.stopMusic();
    if (!this.ctx || !this.initialized) return;

    // Fade in over 2s
    if (this.musicGain) {
      const now = this.ctx.currentTime;
      this.musicGain.gain.cancelScheduledValues(now);
      this.musicGain.gain.setValueAtTime(0, now);
      this.musicGain.gain.linearRampToValueAtTime(this.musicVolume, now + 2.0);
    }

    // Reuse music element infrastructure, but set credits track directly
    if (!this._musicEl) {
      this._musicEl = new Audio();
      this._musicEl.crossOrigin = 'anonymous';
      this._musicEl.preload = 'auto';
      this._musicSource = this.ctx.createMediaElementSource(this._musicEl);
      this._musicSource.connect(this.musicGain);
    }

    // Flag suppresses playlist advance in the 'ended' listener
    this._creditsMode = true;

    this._musicEl.src = CREDITS_TRACK;
    this._musicEl.play().catch(() => {});
    this.musicPlaying = true;
  }

  /**
   * Play a one-shot SFX by key.
   * @param {string} key - Audio buffer key
   * @param {number} [volume] - Optional volume multiplier (0-1). If provided, routes
   *   through an intermediate gain node instead of connecting directly to sfxGain.
   */
  playSFX(key, volume) {
    if (!this.ctx || !this.initialized) {
      // SFX not ready yet
      return;
    }
    const buffer = this.buffers.get(key);
    if (!buffer) return;

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;

    if (volume !== undefined && volume < 1) {
      const vol = this.ctx.createGain();
      vol.gain.value = volume;
      source.connect(vol);
      vol.connect(this.sfxGain);
    } else {
      source.connect(this.sfxGain);
    }
    source.start(0);
  }

  /**
   * Pick a random variant index, falling back to 0 if the chosen
   * variant hasn't been loaded yet (deferred loading in progress).
   */
  _pickVariantIndex(category) {
    const variants = SFX_VARIANTS[category];
    if (!variants || variants.length === 0) return -1;
    const index = Math.floor(Math.random() * variants.length);
    // If the randomly chosen variant isn't loaded yet, fall back to 0
    // (variant 0 is always loaded in the priority phase)
    if (!this.buffers.has(`sfx_${category}_${index}`)) {
      return 0;
    }
    return index;
  }

  /**
   * Play a random variant from an SFX category (e.g. 'birth', 'feed', 'impact').
   * Applies per-category volume from SFX_VOLUME if defined.
   * @param {string} category - Key from SFX_VARIANTS
   */
  playSFXVariant(category) {
    const index = this._pickVariantIndex(category);
    if (index < 0) return;
    this.playSFX(`sfx_${category}_${index}`, SFX_VOLUME[category]);
  }

  /**
   * Play a spatially-positioned random SFX variant.
   * @param {string} category - Key from SFX_VARIANTS
   * @param {THREE.Vector3} worldPosition - Where the sound originates
   */
  playSpatialSFXVariant(category, worldPosition) {
    const index = this._pickVariantIndex(category);
    if (index < 0) return;
    this.playSpatialSFX(`sfx_${category}_${index}`, worldPosition, SFX_VOLUME[category]);
  }

  /**
   * Start looping ambient audio. Fades in over 2 seconds.
   */
  startAmbience() {
    if (!this.ctx || !this.initialized) return;
    if (this.currentAmbienceSource) return; // already playing

    const buffer = this.buffers.get('ambience');
    if (!buffer) {
      console.warn('[AudioManager] Ambience buffer not loaded');
      return;
    }

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.connect(this.ambienceGain);
    source.start(0);
    this.currentAmbienceSource = source;

    // Fade in
    const now = this.ctx.currentTime;
    this.ambienceGain.gain.cancelScheduledValues(now);
    this.ambienceGain.gain.setValueAtTime(0, now);
    this.ambienceGain.gain.linearRampToValueAtTime(this.ambienceVolume, now + 2.0);
  }

  /**
   * Stop ambient audio with a fade out.
   */
  stopAmbience() {
    if (!this.currentAmbienceSource || !this.ctx) return;

    const now = this.ctx.currentTime;
    this.ambienceGain.gain.cancelScheduledValues(now);
    this.ambienceGain.gain.setValueAtTime(this.ambienceGain.gain.value, now);
    this.ambienceGain.gain.linearRampToValueAtTime(0, now + 1.0);

    // Schedule actual stop after fade
    const src = this.currentAmbienceSource;
    this.currentAmbienceSource = null;
    setTimeout(() => {
      try { src.stop(); } catch (e) { /* ignore */ }
    }, 1100);
  }

  /**
   * Enable spatial audio for VR by tracking the Web Audio API listener position.
   * This must be called once before any spatial sounds are played.
   * @param {THREE.AudioListener} listener - Three.js AudioListener (for reference, not directly used)
   */
  enableSpatialAudio(listener) {
    if (!this.ctx) return;
    // Note: We manage the Web Audio API listener position directly via updateListenerPosition(),
    // rather than using THREE.AudioListener. This gives us more control.
    // Listener is now ready for spatial audio updates.
  }

  /**
   * Update the Web Audio API listener position and orientation from the camera.
   * Call this every frame when in VR to track head position for spatial audio.
   * @param {THREE.Camera} camera - The XR camera
   */
  updateListenerPosition(camera) {
    if (!this.ctx || !this.ctx.listener) return;

    // Get camera world position (important: in VR the camera is inside a rig)
    camera.getWorldPosition(_listenerPos);

    // Set listener position
    this.ctx.listener.positionX.value = _listenerPos.x;
    this.ctx.listener.positionY.value = _listenerPos.y;
    this.ctx.listener.positionZ.value = _listenerPos.z;

    // Get world quaternion (accounts for rig rotation in VR)
    camera.getWorldQuaternion(_listenerQuat);

    // Forward direction (camera looks down -Z in Three.js)
    _listenerForward.set(0, 0, -1).applyQuaternion(_listenerQuat);

    // Up direction
    _listenerUp.set(0, 1, 0).applyQuaternion(_listenerQuat);

    // Set listener orientation (forward + up)
    this.ctx.listener.forwardX.value = _listenerForward.x;
    this.ctx.listener.forwardY.value = _listenerForward.y;
    this.ctx.listener.forwardZ.value = _listenerForward.z;
    this.ctx.listener.upX.value = _listenerUp.x;
    this.ctx.listener.upY.value = _listenerUp.y;
    this.ctx.listener.upZ.value = _listenerUp.z;
  }

  /**
   * Play a positioned SFX sound with spatial audio (3D panning).
   * The sound will appear to come from the given world position.
   * @param {string} key - Audio buffer key
   * @param {THREE.Vector3} worldPosition - World position where the sound originates
   */
  playSpatialSFX(key, worldPosition, volume) {
    if (!this.ctx || !this.initialized) {
      // SFX not ready yet
      return;
    }
    const buffer = this.buffers.get(key);
    if (!buffer) return;

    // Create panner for spatial positioning
    const panner = this.ctx.createPanner();
    panner.panningModel = 'HRTF'; // High-quality 3D audio
    panner.distanceModel = 'inverse';
    panner.refDistance = 1;
    panner.maxDistance = 100;
    panner.rolloffFactor = 1;

    // Set panner position
    panner.positionX.value = worldPosition.x;
    panner.positionY.value = worldPosition.y;
    panner.positionZ.value = worldPosition.z;

    // Create source
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;

    // Connect: source → [vol →] panner → sfxGain → masterGain
    if (volume !== undefined && volume < 1) {
      const vol = this.ctx.createGain();
      vol.gain.value = volume;
      source.connect(vol);
      vol.connect(panner);
    } else {
      source.connect(panner);
    }
    panner.connect(this.sfxGain);

    // Play
    source.start(0);
  }

  setMusicVolume(vol) {
    this.musicVolume = vol;
    if (this.musicGain) {
      this.musicGain.gain.value = vol;
    }
  }

  dispose() {
    this.stopMusic();
    if (this._musicEl) {
      this._musicEl.src = '';
      this._musicEl = null;
      this._musicSource = null;
    }
    if (this.currentAmbienceSource) {
      try { this.currentAmbienceSource.stop(); } catch (e) { /* ignore */ }
    }
    if (this.currentNarrationSource) {
      try { this.currentNarrationSource.stop(); } catch (e) { /* ignore */ }
    }
    if (this.ctx) {
      this.ctx.close();
    }
    this.buffers.clear();
  }
}
