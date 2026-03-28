import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { getTerrainHeight } from '../utils/Terrain.js';
import { getMacroWaveHeight } from '../utils/WaveUtils.js';
import { randomRange } from '../utils/MathUtils.js';
import { VirtualJoystick } from './VirtualJoystick.js';
import { DocumentaryDirector } from '../camera/DocumentaryDirector.js';
import { EcosystemScout } from '../camera/EcosystemScout.js';
import { Cinematographer } from '../camera/Cinematographer.js';

const _v = new THREE.Vector3();
const _forward = new THREE.Vector3();
const _right = new THREE.Vector3();
const _lookAt = new THREE.Vector3();

/**
 * CameraController — two modes:
 *   'fps'         — WASD + mouse look (pointer lock), default
 *   'screensaver' — cinematic replay cam with varied shot types
 *
 * Toggle with Tab key.
 *
 * Screensaver shot types (racing-game replay style):
 *   ORBIT_HIGH    — classic orbit from above, looking down at a creature cluster
 *   ORBIT_LOW     — low orbit near the seafloor, looking up through the kelp
 *   FOLLOW_CHASE  — chase cam behind a specific creature
 *   FOLLOW_SIDE   — side-tracking shot parallel to a creature
 *   GROUND_TRACK  — stationary camera on the seafloor, panning to track creatures
 *   FLY_THROUGH   — slow dolly between two points of interest
 */
export class CameraController {
  /** Key bindings — used by DesktopHints to display correct labels */
  static KEYS = {
    forward:  'W',
    back:     'S',
    left:     'A',
    right:    'D',
    swimUp:   'Space',
    swimDown: 'Shift',
    toggle:   'Tab',
  };

  constructor(camera, domElement) {
    this.camera = camera;
    this.domElement = domElement;
    this.mode = 'fps'; // 'fps' | 'screensaver'
    this._debugLog = new URLSearchParams(window.location.search).has('debug');

    // ── FPS state ──
    this.yaw = 0;   // radians around Y
    this.pitch = 0;  // radians around X (clamped)
    this.moveSpeed = 1.5;        // max speed (normal)
    this.sprintSpeed = 2.7;      // max speed (shift held) — 1.8x walk
    this.acceleration = 30.0;    // units/sec²
    this.friction = 6.0;         // deceleration factor (higher = snappier stop)
    this.eyeHeight = 1.8;       // camera height above terrain
    this.velocity = new THREE.Vector3();
    this.lookSensitivity = 0.0015;
    this.enabled = true; // set false to freeze camera (e.g. editor mode)
    // Mouse smoothing
    this._targetYaw = 0;
    this._targetPitch = 0;
    this.lookSmoothing = 18.0;   // interpolation speed (higher = tighter)
    this.keys = {};
    this.pointerLocked = false;

    // ── Cinematic screensaver state ──
    this.ss = {
      smoothLookAt: new THREE.Vector3(0, -7, 0),

      // Documentary system modules
      director: null,        // created when entering screensaver mode
      scout: null,           // created when creature pools are set
      cinematographer: null, // created when entering screensaver mode

      // Transition blend state (kept from old system)
      transitioning: false,
      transitionTimer: 0,
      transitionDuration: 2.0,
      prevPos: new THREE.Vector3(),
      prevTarget: new THREE.Vector3(),

      // Fade state (kept from old system)
      fadeState: 'NONE',
      fadeTimer: 0,
      fadeOutDuration: 0.4,
      fadeHoldDuration: 0.15,
      fadeInDuration: 0.5,
      fadePendingShot: null, // now stores the pending ShotRequest

      // Current active shot from director
      currentShot: null,
    };

    // ── Fade overlay ──
    this._fadeOverlay = document.createElement('div');
    this._fadeOverlay.style.cssText =
      'position:fixed;top:0;left:0;width:100%;height:100%;' +
      'background:#000;opacity:0;pointer-events:none;z-index:9999;' +
      'transition:none;';
    document.body.appendChild(this._fadeOverlay);

    // ── Debug screensaver overlay ──
    this._debugOverlay = document.createElement('div');
    this._debugOverlay.id = 'screensaver-debug';
    this._debugOverlay.style.cssText =
      'position:fixed;bottom:80px;left:10px;z-index:10001;' +
      'background:rgba(0,0,0,0.7);color:#0f0;font-family:monospace;' +
      'font-size:12px;padding:10px 14px;border-radius:6px;' +
      'pointer-events:none;display:none;line-height:1.6;' +
      'white-space:pre;border:1px solid rgba(0,255,0,0.3);';
    document.body.appendChild(this._debugOverlay);
    this._debugScreensaver = false;
    this._shotHistory = [];
    this._shotDurationHistory = []; // Track actual durations of last N shots

    // ── Cinematography grid overlay (rule of thirds / golden ratio) ──
    this._gridOverlay = document.createElement('canvas');
    this._gridOverlay.id = 'cine-grid-overlay';
    this._gridOverlay.style.cssText =
      'position:fixed;top:0;left:0;width:100%;height:100%;' +
      'pointer-events:none;z-index:10001;display:none;';
    document.body.appendChild(this._gridOverlay);
    this._gridMode = 0; // 0=off, 1=rule of thirds, 2=golden ratio, 3=center crosshair
    this._gridLabels = ['OFF', 'RULE OF THIRDS', 'GOLDEN RATIO', 'CENTER CROSS + SAFE'];
    this._gridLabelOverlay = document.createElement('div');
    this._gridLabelOverlay.style.cssText =
      'position:fixed;top:10px;right:10px;z-index:10001;' +
      'background:rgba(0,0,0,0.6);color:#ff8844;font-family:monospace;' +
      'font-size:11px;padding:4px 10px;border-radius:4px;' +
      'pointer-events:none;display:none;border:1px solid rgba(255,136,68,0.3);';
    document.body.appendChild(this._gridLabelOverlay);

    // ── Letterbox bars (cinematic 2.39:1 aspect ratio bars) ──
    this._letterboxTop = document.createElement('div');
    this._letterboxTop.style.cssText =
      'position:fixed;top:0;left:0;width:100%;height:0;' +
      'background:#000;pointer-events:none;z-index:9997;' +
      'transition:height 0.8s ease-in-out;';
    document.body.appendChild(this._letterboxTop);
    this._letterboxBottom = document.createElement('div');
    this._letterboxBottom.style.cssText =
      'position:fixed;bottom:0;left:0;width:100%;height:0;' +
      'background:#000;pointer-events:none;z-index:9997;' +
      'transition:height 0.8s ease-in-out;';
    document.body.appendChild(this._letterboxBottom);

    // ── DOF / Vignette effect toggles ──
    this._dofEnabled = false;
    this._vignetteEnabled = false;

    // Camera velocity telemetry
    this._lastCamPos = new THREE.Vector3();
    this._camVelocity = 0;
    this._camAngularVelocity = 0;
    this._lastLookDir = new THREE.Vector3();
    this._skipNextVelocityFrame = false;

    // Subtle underwater sway (both modes)
    this.swayEnabled = true;
    this.swayTimer = 0;

    // Creature pools reference (set via setCreaturePools)
    this._creaturePools = null;

    // Mobile virtual joystick
    this.isMobile = VirtualJoystick.isTouchDevice();
    this.joystick = null;
    if (this.isMobile) {
      this.joystick = new VirtualJoystick();
      this.joystick.init();
      this.joystick.hide(); // hidden until sim starts
      this.touchLookSensitivity = 0.004; // tuned for finger drag
    }

    // Gyroscope look mode (mobile only) — absolute orientation approach
    // Uses absolute device quaternion → forward vector → yaw/pitch, with a
    // yaw offset so the "zero point" matches camera heading when gyro was enabled.
    // This is immune to phone roll because we always rebuild the camera from
    // yaw + pitch only (roll = 0).
    this.gyroEnabled = false;
    this._gyroYawOffset = 0;           // camera yaw - device yaw at enable time
    this._gyroInitialSet = false;      // true once first device event captured
    this._gyroDeviceQuat = new THREE.Quaternion();
    this._gyroAbsoluteQuat = new THREE.Quaternion(); // latest absolute device orientation
    // Reusable scratch objects for device orientation conversion
    this._gyroEuler = new THREE.Euler();
    this._gyroScreenQuat = new THREE.Quaternion();
    this._gyroWorldFixQuat = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5)); // -90° X rotation
    this._onDeviceOrientation = this._onDeviceOrientation.bind(this);
    this._gyroButton = null;

    // Bindings
    this._onMouseMove = this._onMouseMove.bind(this);
    this._onKeyDown = this._onKeyDown.bind(this);
    this._onKeyUp = this._onKeyUp.bind(this);
    this._onPointerLockChange = this._onPointerLockChange.bind(this);
    this._onClick = this._onClick.bind(this);

    domElement.addEventListener('click', this._onClick);
    document.addEventListener('mousemove', this._onMouseMove);
    document.addEventListener('keydown', this._onKeyDown);
    document.addEventListener('keyup', this._onKeyUp);
    document.addEventListener('pointerlockchange', this._onPointerLockChange);
    this._onResize = () => {
      if (this._gridMode > 0) this._drawCineGrid();
      if (this.mode === 'screensaver') this._showLetterbox(true);
    };
    window.addEventListener('resize', this._onResize);

    // Initialize yaw/pitch from camera's current orientation
    const euler = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
    this.yaw = this._targetYaw = euler.y;
    this.pitch = this._targetPitch = euler.x;
  }

  /** Provide creature pools so screensaver can find hotspots. */
  setCreaturePools(pools) {
    this._creaturePools = pools;
  }

  /**
   * Toggle between FPS and screensaver modes.
   */
  toggleMode() {
    if (this.mode === 'fps') {
      this.mode = 'screensaver';
      // Exit pointer lock
      if (document.pointerLockElement) document.exitPointerLock();
      // Initialize documentary modules
      if (!this.ss.director) {
        this.ss.director = new DocumentaryDirector();
        this.ss.cinematographer = new Cinematographer();
        this.ss.director.resetSequence();
      }
      if (!this.ss.scout && this._creaturePools) {
        this.ss.scout = new EcosystemScout(this._creaturePools, { surfaceY: CONFIG.surfaceY });
      }
      // Start the first shot from the director's initial state
      this.ss.currentShot = this.ss.director.currentShot;
      // Seed smoothLookAt from current camera direction before first shot
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
      this.ss.smoothLookAt.copy(this.camera.position).add(fwd);
      // Seed velocity tracking from current camera state to prevent first-frame spike
      this._lastCamPos.copy(this.camera.position);
      this._lastLookDir.copy(fwd.normalize());
      this._camVelocity = 0;
      this._camAngularVelocity = 0;
      // Show letterbox bars (cinematic 2.39:1 crop)
      this._showLetterbox(true);
      if (this._debugLog) console.log('[Camera] Cinematic mode');
    } else {
      this.mode = 'fps';
      // Derive yaw/pitch from current camera orientation
      const euler = new THREE.Euler().setFromQuaternion(this.camera.quaternion, 'YXZ');
      this.yaw = this._targetYaw = euler.y;
      this.pitch = this._targetPitch = euler.x;
      this.velocity.set(0, 0, 0);
      // Clean up documentary modules
      this.ss.director = null;
      this.ss.scout = null;
      this.ss.cinematographer = null;
      this.ss.currentShot = null;
      // Hide debug overlay and title-safe circle
      this._debugOverlay.style.display = 'none';
      this._debugScreensaver = false;
      if (this._gridMode === 0) this._gridOverlay.style.display = 'none';
      // Hide letterbox bars
      this._showLetterbox(false);
      if (this._debugLog) console.log('[Camera] FPS mode');
    }
  }

  update(dt, elapsed = 0) {
    if (!this.enabled) return;

    if (this.mode === 'fps') {
      this._updateFPS(dt, elapsed);
    } else {
      this._updateScreensaver(dt, elapsed);
    }
  }

  // ── FPS ──────────────────────────────────────────────────────

  _updateFPS(dt, elapsed = 0) {
    // Advance sway timer (used for wave bob at surface)
    this.swayTimer += dt;

    // ── Touch look (mobile right joystick or gyroscope) ──
    if (this.gyroEnabled && this._gyroInitialSet) {
      // Absolute approach: extract forward vector from the device's absolute
      // orientation (after world-fix + screen correction). This vector is
      // completely independent of phone roll — tilting the phone around its
      // screen-normal axis doesn't change where the screen "faces".
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this._gyroAbsoluteQuat);

      // Derive yaw/pitch from the absolute forward vector
      const deviceYaw = Math.atan2(-fwd.x, -fwd.z);
      const devicePitch = Math.asin(Math.max(-1, Math.min(1, fwd.y)));

      // Apply yaw offset so "zero" matches camera heading when gyro was enabled
      this._targetYaw = deviceYaw + this._gyroYawOffset;
      this._targetPitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, devicePitch));

      this.yaw = this._targetYaw;
      this.pitch = this._targetPitch;

      // Rebuild camera quaternion from yaw + pitch only — roll is always 0,
      // so horizon stays level regardless of how the phone is physically rolled
      const corrected = new THREE.Quaternion();
      corrected.setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
      this.camera.quaternion.copy(corrected);
    } else if (this.joystick && this.joystick.active) {
      const look = this.joystick.consumeLookDelta();
      this._targetYaw -= look.x * this.touchLookSensitivity;
      this._targetPitch -= look.y * this.touchLookSensitivity;
      this._targetPitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, this._targetPitch));
    }

    // Smooth mouse look — interpolate toward target angles
    const lerpFactor = 1 - Math.exp(-this.lookSmoothing * dt);
    this.yaw += (this._targetYaw - this.yaw) * lerpFactor;
    this.pitch += (this._targetPitch - this.pitch) * lerpFactor;

    // Apply rotation (skip if gyro already set it directly via quaternion)
    if (!this.gyroEnabled) {
      const quat = new THREE.Quaternion();
      quat.setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
      this.camera.quaternion.copy(quat);
    }

    // Build input direction from keys
    // Forward uses full 3D camera direction (swimming/flying feel)
    _forward.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
    // Strafe stays horizontal so A/D don't roll you into the ground
    _right.set(1, 0, 0).applyQuaternion(this.camera.quaternion);
    _right.y = 0;
    _right.normalize();

    const inputDir = _v.set(0, 0, 0);
    if (this.keys['w'] || this.keys['arrowup'])    inputDir.addScaledVector(_forward, 1);
    if (this.keys['s'] || this.keys['arrowdown'])   inputDir.addScaledVector(_forward, -1);
    if (this.keys['a'] || this.keys['arrowleft'])   inputDir.addScaledVector(_right, -1);
    if (this.keys['d'] || this.keys['arrowright'])  inputDir.addScaledVector(_right, 1);
    if (this.keys[' '])                              inputDir.y += 0.125;
    if (this.keys['shift'])                          inputDir.y -= 0.125;

    // ── Touch movement (mobile left joystick) ──
    if (this.joystick && this.joystick.active) {
      const mv = this.joystick.moveAxis;
      if (Math.abs(mv.x) > 0.05 || Math.abs(mv.y) > 0.05) {
        // joystick X = strafe, joystick Y (inverted) = forward/back
        inputDir.addScaledVector(_forward, -mv.y);
        inputDir.addScaledVector(_right, mv.x);
      }
    }

    const maxSpeed = this.keys['shift'] ? this.sprintSpeed : this.moveSpeed;

    if (inputDir.lengthSq() > 0.001) {
      inputDir.normalize();
      // Accelerate toward input direction
      this.velocity.addScaledVector(inputDir, this.acceleration * dt);
      // Clamp to max speed
      if (this.velocity.length() > maxSpeed) {
        this.velocity.normalize().multiplyScalar(maxSpeed);
      }
    } else {
      // Apply friction when no input
      const frictionFactor = Math.exp(-this.friction * dt);
      this.velocity.multiplyScalar(frictionFactor);
      // Kill tiny drift
      if (this.velocity.lengthSq() < 0.0001) this.velocity.set(0, 0, 0);
    }

    // Apply velocity
    this.camera.position.addScaledVector(this.velocity, dt);

    // Terrain collision — keep camera above ground
    const terrainY = getTerrainHeight(this.camera.position.x, this.camera.position.z);
    const minY = terrainY + this.eyeHeight;
    if (this.camera.position.y < minY) {
      this.camera.position.y = minY;
      if (this.velocity.y < 0) this.velocity.y = 0;
    }

    // Surface ceiling — player can't go above the ocean surface.
    // Fade zone: gentle resistance starts below surfaceY, hard clamp at surfaceY.
    const surfaceY = CONFIG.surfaceY;
    const fadeDepth = 2.0; // how far below surface the resistance starts
    const camY = this.camera.position.y;

    if (camY > surfaceY - fadeDepth) {
      // 0 at bottom of fade zone → 1 at surface
      const t = Math.min(1, (camY - (surfaceY - fadeDepth)) / fadeDepth);
      // Smoothstep for gentle fade-in
      const strength = t * t * (3 - 2 * t);

      // Dampen upward velocity proportional to strength
      if (this.velocity.y > 0) {
        this.velocity.y *= 1 - strength * 0.9;
      }

      // Wave bob — match the actual water surface wave height at camera XZ position.
      // Only apply the macro (low-frequency) wave for smooth bobbing.
      // Blended in by `strength` so it's strongest at the surface and fades with depth.
      const waveHeight = getMacroWaveHeight(this.camera.position.x, this.camera.position.z, elapsed);
      this.camera.position.y += waveHeight * strength;

      // Hard clamp — never above surface + wave
      const surfaceCap = surfaceY + waveHeight;
      if (this.camera.position.y > surfaceCap) {
        this.camera.position.y = surfaceCap;
        if (this.velocity.y > 0) this.velocity.y = 0;
      }
    }
  }

  _onClick() {
    if (this.enabled && this.mode === 'fps' && !this.pointerLocked && !this.isMobile) {
      this.domElement.requestPointerLock();
    }
  }

  _onMouseMove(e) {
    if (this.mode !== 'fps' || !this.pointerLocked) return;
    this._targetYaw -= e.movementX * this.lookSensitivity;
    this._targetPitch -= e.movementY * this.lookSensitivity;
    this._targetPitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, this._targetPitch));
  }

  _onKeyDown(e) {
    const key = e.key.toLowerCase();
    this.keys[key] = true;
    if (e.key === 'Tab') {
      e.preventDefault();
      this.toggleMode();
    }
    // Toggle screensaver debug overlay with 'I' key
    if ((e.key === 'i' || e.key === 'I') && this.mode === 'screensaver') {
      this._debugScreensaver = !this._debugScreensaver;
      this._debugOverlay.style.display = this._debugScreensaver ? 'block' : 'none';
      // Show/hide grid overlay for title-safe circle when no grid mode is active
      if (this._gridMode === 0) {
        this._gridOverlay.style.display = this._debugScreensaver ? 'block' : 'none';
      }
    }
    // Toggle DOF effect with 'D' key (screensaver mode only)
    if ((e.key === 'd' || e.key === 'D') && this.mode === 'screensaver') {
      this._dofEnabled = !this._dofEnabled;
      if (this._debugLog) console.log(`[Camera] DOF: ${this._dofEnabled ? 'ON' : 'OFF'}`);
    }
    // Toggle vignette effect with 'V' key (screensaver mode only)
    if ((e.key === 'v' || e.key === 'V') && this.mode === 'screensaver') {
      this._vignetteEnabled = !this._vignetteEnabled;
      if (this._debugLog) console.log(`[Camera] Vignette: ${this._vignetteEnabled ? 'ON' : 'OFF'}`);
    }
    // Toggle cinematography grid overlay with 'G' key (cycles: off → thirds → golden → center → off)
    if ((e.key === 'g' || e.key === 'G') && this.mode === 'screensaver') {
      this._gridMode = (this._gridMode + 1) % this._gridLabels.length;
      if (this._gridMode === 0) {
        // Keep grid overlay visible if debug mode needs it for title-safe circle
        if (!this._debugScreensaver) this._gridOverlay.style.display = 'none';
        this._gridLabelOverlay.style.display = 'none';
      } else {
        this._gridOverlay.style.display = 'block';
        this._gridLabelOverlay.style.display = 'block';
        this._gridLabelOverlay.textContent = `GRID: ${this._gridLabels[this._gridMode]}  [G to cycle]`;
        this._drawCineGrid();
      }
    }
    // Prevent key events from triggering while disabled (editor mode)
    if (!this.enabled && key !== 'tab') return;
  }

  _onKeyUp(e) {
    this.keys[e.key.toLowerCase()] = false;
  }

  _onPointerLockChange() {
    this.pointerLocked = document.pointerLockElement === this.domElement;
  }

  // ── Gyroscope Look ──────────────────────────────────────────────

  /**
   * Create the gyro toggle button (called once joysticks are shown).
   */
  createGyroButton() {
    if (this._gyroButton || !this.isMobile) return;

    const btn = document.createElement('button');
    btn.id = 'gyro-toggle';
    btn.textContent = '📱';
    btn.style.cssText =
      'position:fixed;top:12px;right:12px;z-index:9998;width:56px;height:56px;' +
      'border-radius:50%;border:1.5px solid rgba(255,255,255,0.18);' +
      'background:radial-gradient(circle at 35% 35%, rgba(255,255,255,0.15) 0%, rgba(255,255,255,0.05) 100%);' +
      'backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);' +
      'box-shadow:inset 0 1px 1px rgba(255,255,255,0.15), 0 2px 8px rgba(0,0,0,0.12);' +
      'color:#fff;font-size:24px;cursor:pointer;touch-action:manipulation;display:flex;' +
      'align-items:center;justify-content:center;' +
      '-webkit-tap-highlight-color:transparent;user-select:none;-webkit-user-select:none;outline:none;';
    btn.addEventListener('click', () => this.toggleGyro());
    document.body.appendChild(btn);
    this._gyroButton = btn;
  }

  /**
   * Create the cinematic / screensaver camera toggle button (mobile only).
   * @param {object} feedingInput — FeedingInput instance (to hide/show feed button)
   */
  createCinemaButton(feedingInput) {
    if (this._cinemaButton || !this.isMobile) return;
    this._feedingInputRef = feedingInput;

    const btn = document.createElement('button');
    btn.id = 'cinema-toggle';
    btn.textContent = '🐠';
    btn.style.cssText =
      'position:fixed;top:12px;right:76px;z-index:9998;width:56px;height:56px;' +
      'border-radius:50%;border:1.5px solid rgba(255,255,255,0.18);' +
      'background:radial-gradient(circle at 35% 35%, rgba(255,255,255,0.15) 0%, rgba(255,255,255,0.05) 100%);' +
      'backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);' +
      'box-shadow:inset 0 1px 1px rgba(255,255,255,0.15), 0 2px 8px rgba(0,0,0,0.12);' +
      'color:#fff;font-size:24px;cursor:pointer;touch-action:manipulation;display:flex;' +
      'align-items:center;justify-content:center;' +
      '-webkit-tap-highlight-color:transparent;user-select:none;-webkit-user-select:none;outline:none;';
    btn.addEventListener('click', () => this._toggleCinemaMode());
    document.body.appendChild(btn);
    this._cinemaButton = btn;
  }

  _toggleCinemaMode() {
    this.toggleMode();
    const isScreensaver = this.mode === 'screensaver';

    // Swap icon: 🐠 = "enter aquarium mode", 🤿 = "dive back in (FPS)"
    if (this._cinemaButton) {
      this._cinemaButton.textContent = isScreensaver ? '🤿' : '🐠';
      this._cinemaButton.style.background = isScreensaver
        ? 'radial-gradient(circle at 35% 35%, rgba(255,255,255,0.3) 0%, rgba(255,255,255,0.1) 100%)'
        : 'radial-gradient(circle at 35% 35%, rgba(255,255,255,0.15) 0%, rgba(255,255,255,0.05) 100%)';
      this._cinemaButton.style.borderColor = isScreensaver
        ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.18)';
    }

    // Hide/show mobile FPS controls based on mode
    if (isScreensaver) {
      if (this.joystick) this.joystick.hide();
      if (this._feedingInputRef) this._feedingInputRef.hideMobileButton();
      if (this._gyroButton) this._gyroButton.style.display = 'none';
    } else {
      if (this.joystick) this.joystick.show();
      if (this._feedingInputRef) this._feedingInputRef.showMobileButton();
      if (this._gyroButton) this._gyroButton.style.display = 'flex';
    }
  }

  async toggleGyro() {
    if (this.gyroEnabled) {
      // Turn off — restore yaw/pitch from current camera so view doesn't jump
      const euler = new THREE.Euler().setFromQuaternion(this.camera.quaternion, 'YXZ');
      this.yaw = this._targetYaw = euler.y;
      this.pitch = this._targetPitch = euler.x;
      this.gyroEnabled = false;
      this._gyroInitialSet = false;
      this._gyroYawOffset = 0;
      window.removeEventListener('deviceorientation', this._onDeviceOrientation);
      if (this._gyroButton) {
        this._gyroButton.style.background = 'rgba(255,136,68,0.12)';
        this._gyroButton.style.borderColor = 'rgba(255,136,68,0.4)';
      }
      return;
    }

    // iOS 13+ requires permission
    if (typeof DeviceOrientationEvent !== 'undefined' &&
        typeof DeviceOrientationEvent.requestPermission === 'function') {
      try {
        const perm = await DeviceOrientationEvent.requestPermission();
        if (perm !== 'granted') {
          console.warn('[Camera] Gyro permission denied');
          return;
        }
      } catch (e) {
        console.warn('[Camera] Gyro permission error:', e);
        return;
      }
    }

    // Store current camera yaw so we can compute the offset on first device event
    this._gyroCameraYawAtEnable = this.yaw;
    this._gyroInitialSet = false; // will be set on first device event
    this.gyroEnabled = true;
    window.addEventListener('deviceorientation', this._onDeviceOrientation);
    if (this._gyroButton) {
      this._gyroButton.style.background = 'rgba(255,136,68,0.35)';
      this._gyroButton.style.borderColor = 'rgba(255,136,68,0.7)';
    }
  }

  /**
   * Convert device orientation event to quaternion.
   * Uses the standard Z-X'-Y'' Tait-Bryan convention from the W3C spec,
   * then applies a -90° X world fix (screen faces up → forward) and
   * a screen orientation correction.
   */
  _deviceOrientationToQuat(alpha, beta, gamma) {
    // Convert degrees to radians
    const a = THREE.MathUtils.degToRad(alpha);
    const b = THREE.MathUtils.degToRad(beta);
    const g = THREE.MathUtils.degToRad(gamma);

    // Device orientation → Euler (ZXY intrinsic = YXZ extrinsic)
    this._gyroEuler.set(b, a, -g, 'YXZ');
    this._gyroDeviceQuat.setFromEuler(this._gyroEuler);

    // Apply world fix: device "up" (screen ceiling-ward) → Three.js "forward" (-Z)
    this._gyroDeviceQuat.multiply(this._gyroWorldFixQuat);

    // Apply screen orientation (portrait vs landscape)
    const screenAngle = -(window.screen.orientation?.angle || window.orientation || 0);
    this._gyroScreenQuat.setFromAxisAngle(
      new THREE.Vector3(0, 0, 1),
      THREE.MathUtils.degToRad(screenAngle)
    );
    this._gyroDeviceQuat.multiply(this._gyroScreenQuat);

    return this._gyroDeviceQuat.clone();
  }

  _onDeviceOrientation(e) {
    if (e.alpha === null || e.beta === null || e.gamma === null) return;

    const deviceQuat = this._deviceOrientationToQuat(e.alpha, e.beta, e.gamma);

    // Store the absolute device quaternion (used in _updateFPS)
    this._gyroAbsoluteQuat.copy(deviceQuat);

    // On the first reading, compute yaw offset = cameraYaw - deviceYaw
    // so the gyro "zero" matches where the camera was already pointing
    if (!this._gyroInitialSet) {
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(deviceQuat);
      const initialDeviceYaw = Math.atan2(-fwd.x, -fwd.z);
      this._gyroYawOffset = this._gyroCameraYawAtEnable - initialDeviceYaw;
      this._gyroInitialSet = true;
    }
  }

  // ── Cinematic Screensaver ──────────────────────────────────────

  _updateScreensaver(dt, elapsed) {
    const ss = this.ss;

    // Initialize modules on first call if needed
    if (!ss.director) {
      ss.director = new DocumentaryDirector();
      ss.cinematographer = new Cinematographer();
      ss.director.resetSequence();
    }
    if (!ss.scout && this._creaturePools) {
      ss.scout = new EcosystemScout(this._creaturePools, { surfaceY: CONFIG.surfaceY });
    }

    // ── Fade-to-black state machine (kept from old system) ──
    if (ss.fadeState !== 'NONE') {
      ss.fadeTimer += dt;

      switch (ss.fadeState) {
        case 'FADING_OUT': {
          const t = Math.min(ss.fadeTimer / ss.fadeOutDuration, 1.0);
          this._fadeOverlay.style.opacity = t;
          if (t >= 1.0) {
            // Screen is fully black — set up the new shot and teleport camera
            ss.fadeState = 'HOLD_BLACK';
            ss.fadeTimer = 0;
            if (ss.fadePendingShot) {
              ss.currentShot = ss.fadePendingShot;
              // Teleport camera to new shot position immediately
              const helpers = {
                getTerrainHeight,
                getMacroWaveHeight,
                findNearestCreature: (pos) => this._findNearestCreature(pos),
                findHotspot: () => this._findHotspot(),
                getAllCreatures: () => this._getAllCreatures(),
                surfaceY: CONFIG.surfaceY,
              };
              const frame = ss.cinematographer.computeFrame(ss.currentShot, 0, elapsed, helpers);
              this.camera.position.copy(frame.position);
              ss.smoothLookAt.copy(frame.lookAt);
              this.camera.lookAt(frame.lookAt);
              // Reset velocity tracking after teleport to prevent first-frame spike
              this._lastCamPos.copy(frame.position);
              const newLookDir = frame.lookAt.clone().sub(frame.position).normalize();
              this._lastLookDir.copy(newLookDir);
              this._camVelocity = 0;
              this._camAngularVelocity = 0;
              ss.fadePendingShot = null;
            }
          }
          return; // freeze scene during fade-out
        }

        case 'HOLD_BLACK': {
          this._fadeOverlay.style.opacity = 1;
          if (ss.fadeTimer >= ss.fadeHoldDuration) {
            ss.fadeState = 'FADING_IN';
            ss.fadeTimer = 0;
          }
          return;
        }

        case 'FADING_IN': {
          const t = Math.min(ss.fadeTimer / ss.fadeInDuration, 1.0);
          this._fadeOverlay.style.opacity = 1 - t;
          // Let the shot run during fade-in so camera moves naturally
          if (t >= 1.0) {
            ss.fadeState = 'NONE';
            this._fadeOverlay.style.opacity = 0;
          }
          break; // fall through to normal shot update
        }
      }
    }

    // ── Scout: scan for dramatic moments ──
    let scoutReport = null;
    if (ss.scout) {
      ss.scout.update(dt);
      scoutReport = ss.scout.currentReport || null;
    }

    // ── Director: decide if we need a new shot ──
    const shotRequest = ss.director.update(dt, scoutReport);

    // Check for scout interrupts
    if (scoutReport && scoutReport.hasMoment) {
      const interrupt = ss.director.onScoutAlert(scoutReport);
      if (interrupt && !shotRequest) {
        // Scout interrupted — use the interrupt shot
        this._startNewShot(interrupt);
        return;
      }
    }

    if (shotRequest) {
      this._startNewShot(shotRequest);
      return;
    }

    // ── Cinematographer: compute this frame's camera position ──
    if (!ss.currentShot) return;

    // Validate non-tracking shots still have something interesting to look at.
    // For environmental shots (ESTABLISHING_WIDE, FLY_THROUGH, etc.) that don't track
    // a specific creature, verify there are creatures in the general vicinity.
    // If the scene is truly empty near the camera, try to reorient toward the cluster.

    const helpers = {
      getTerrainHeight,
      getMacroWaveHeight,
      findNearestCreature: (pos) => this._findNearestCreature(pos),
      findHotspot: () => this._findHotspot(),
      getAllCreatures: () => this._getAllCreatures(),
      surfaceY: CONFIG.surfaceY,
    };

    const frame = ss.cinematographer.computeFrame(ss.currentShot, dt, elapsed, helpers);

    // ── Title-safe correction: nudge lookAt toward subject if it would project outside the circle ──
    if (!frame.isNonTracking && ss.currentShot.subject) {
      const subj = ss.currentShot.subject;
      if (subj.mesh && !subj.dead && subj.active) {
        // Project subject using the current camera (already positioned from previous frame).
        // This is a one-frame-delayed check, but the smoothing makes it invisible.
        const subjNDC = subj.mesh.position.clone().project(this.camera);

        if (subjNDC.z < 1) { // In front of camera
          // Title-safe circle: 40% of min viewport dim, converted to NDC
          const w = window.innerWidth, h = window.innerHeight;
          const minDim = Math.min(w, h);
          const safeRX = (minDim * 0.40) / (w * 0.5); // NDC radius on X axis
          const safeRY = (minDim * 0.40) / (h * 0.5); // NDC radius on Y axis
          // Elliptical distance
          const nx = subjNDC.x / safeRX;
          const ny = subjNDC.y / safeRY;
          const dist = Math.sqrt(nx * nx + ny * ny);

          if (dist > 1.0) {
            // Subject is outside the title-safe circle — nudge lookAt toward subject.
            // Strength ramps with overshoot so small violations correct gently,
            // large ones correct more aggressively.
            const overshoot = Math.min(dist - 1.0, 2.0);
            const correctionStrength = overshoot * 0.3;
            frame.lookAt.lerp(subj.mesh.position, correctionStrength);
          }
        }
      }
    }

    // Apply smoothed camera position and look-at
    // Cap smoothing rates to prevent overshoot (cinematographer provides 0.5-1.8 range)
    const clampedPosRate = Math.min(frame.smoothingRate, 1.5);
    const clampedLookRate = Math.min(frame.lookSmoothingRate, 1.2);
    const posRate = 1 - Math.exp(-clampedPosRate * dt);
    const lookRate = 1 - Math.exp(-clampedLookRate * dt);

    // Save pre-lerp position for velocity clamping
    const prevPos = this.camera.position.clone();
    const prevLookAt = ss.smoothLookAt.clone();

    this.camera.position.lerp(frame.position, posRate);
    ss.smoothLookAt.lerp(frame.lookAt, lookRate);

    // ── Camera collision FIRST: push away from creatures before clamping ──
    // This ensures all velocity/angular clamps operate on post-collision position.
    this._applyCameraCollision();

    // Hard clamp: max 0.5 units/sec camera movement (comfortable diver swim speed)
    // This prevents speed spikes and keeps motion naturalistic
    if (dt > 0) {
      const maxPosMove = 0.5 * dt;
      const posDelta = this.camera.position.clone().sub(prevPos);
      if (posDelta.length() > maxPosMove) {
        posDelta.setLength(maxPosMove);
        this.camera.position.copy(prevPos).add(posDelta);
      }
      // World-space lookAt clamp (prevents teleporting lookAt)
      const maxLookMove = 1.0 * dt;
      const lookDelta = ss.smoothLookAt.clone().sub(prevLookAt);
      if (lookDelta.length() > maxLookMove) {
        lookDelta.setLength(maxLookMove);
        ss.smoothLookAt.copy(prevLookAt).add(lookDelta);
      }

      // Final angular velocity clamp: both position AND lookAt changes contribute to
      // angular velocity. Clamp the resulting look direction change directly.
      if (this._lastLookDir.lengthSq() > 0) {
        const maxAngularChange = 30 * dt; // 30°/s max — gentle diver-like pan
        const newLookDir = ss.smoothLookAt.clone().sub(this.camera.position).normalize();
        const dot = Math.min(1, Math.max(-1, newLookDir.dot(this._lastLookDir)));
        const angularChangeDeg = Math.acos(dot) * 180 / Math.PI;
        if (angularChangeDeg > maxAngularChange) {
          // Interpolate look direction back toward previous to stay within angular budget
          const ratio = maxAngularChange / angularChangeDeg;
          const clampedDir = new THREE.Vector3().copy(this._lastLookDir).lerp(newLookDir, ratio).normalize();
          const dist = ss.smoothLookAt.distanceTo(this.camera.position);
          ss.smoothLookAt.copy(this.camera.position).addScaledVector(clampedDir, dist);
        }
      }
    }

    // Gimbal lock safety: prevent lookAt direction from being nearly parallel to up vector.
    // When the camera looks almost straight up or down, THREE.lookAt() can spin wildly.
    {
      const lookDir = ss.smoothLookAt.clone().sub(this.camera.position);
      const len = lookDir.length();
      if (len > 0.001) {
        lookDir.divideScalar(len);
        // Dot with up vector — if nearly ±1, we're looking straight up/down
        const upDot = Math.abs(lookDir.y);
        if (upDot > 0.98) {
          // Clamp to max 80° from horizontal to prevent gimbal lock
          const sign = lookDir.y > 0 ? 1 : -1;
          lookDir.y = sign * 0.98; // ~78° from horizontal
          lookDir.normalize();
          ss.smoothLookAt.copy(this.camera.position).addScaledVector(lookDir, len);
        }
      }
    }

    this.camera.lookAt(ss.smoothLookAt);

    // Track camera velocity for debug telemetry
    // Skip measurement after CUT transitions (camera teleported — don't measure the jump)
    if (this._skipNextVelocityFrame) {
      this._skipNextVelocityFrame = false;
      this._camVelocity = 0;
      this._camAngularVelocity = 0;
      this._lastCamPos.copy(this.camera.position);
      const skipDir = ss.smoothLookAt.clone().sub(this.camera.position).normalize();
      this._lastLookDir.copy(skipDir);
    } else {
      const camDelta = this.camera.position.clone().sub(this._lastCamPos);
      this._camVelocity = dt > 0 ? camDelta.length() / dt : 0;
      const currentLookDir = ss.smoothLookAt.clone().sub(this.camera.position).normalize();
      if (this._lastLookDir.lengthSq() > 0) {
        const angleDiff = Math.acos(Math.min(1, Math.max(-1, currentLookDir.dot(this._lastLookDir))));
        this._camAngularVelocity = dt > 0 ? (angleDiff * 180 / Math.PI) / dt : 0;
      }
      this._lastCamPos.copy(this.camera.position);
      this._lastLookDir.copy(currentLookDir);
    }

    // Console warnings for speed violations (debug only - fires per frame)
    if (this._debugLog) {
      if (this._camVelocity > 1.0) {
        console.warn(`[Camera] ⚠ FAST: ${this._camVelocity.toFixed(1)} u/s | shot=${ss.currentShot.type} phase=${ss.director?.currentPhase} smoothRate=${frame.smoothingRate.toFixed(2)}`);
      }
      if (this._camAngularVelocity > 35) {
        console.warn(`[Camera] ⚠ SPIN: ${this._camAngularVelocity.toFixed(1)}°/s | shot=${ss.currentShot.type} phase=${ss.director?.currentPhase} lookRate=${frame.lookSmoothingRate.toFixed(2)}`);
      }
    }

    // ── Update debug overlay ──
    if (this._debugScreensaver && ss.currentShot) {
      this._updateDebugOverlay(ss, dt);
    }

    // ── Redraw grid overlay every frame (for target circle + title-safe) ──
    const needsGrid = this._gridMode > 0 || this._debugScreensaver;
    if (needsGrid) {
      this._gridOverlay.style.display = 'block';
      this._drawCineGrid();
    }
  }

  /**
   * Update the debug HUD overlay with current telemetry.
   */
  _updateDebugOverlay(ss, dt) {
    if (!ss.director || !ss.currentShot) return;

    const shot = ss.currentShot;
    const debugInfo = ss.director.getDebugInfo ? ss.director.getDebugInfo() : {};

    // Track shot history (last 5 shots with durations)
    if (!this._lastShotType || this._lastShotType !== shot.type) {
      if (this._lastShotType && this._lastShotElapsed) {
        this._shotDurationHistory.unshift({
          type: this._lastShotType,
          duration: this._lastShotElapsed,
        });
        if (this._shotDurationHistory.length > 5) {
          this._shotDurationHistory.pop();
        }
        this._shotHistory.unshift(this._lastShotType);
        if (this._shotHistory.length > 5) {
          this._shotHistory.pop();
        }
      }
      this._lastShotType = shot.type;
    }

    // Format shot duration and progress bar
    const shotDuration = shot.duration || 8.0;
    const shotElapsed = (debugInfo.shotElapsed || 0);
    this._lastShotElapsed = shotElapsed;
    const progress = Math.min(shotElapsed / shotDuration, 1.0);
    const barLength = 10;
    const filledBars = Math.floor(progress * barLength);
    const progressBar = '█'.repeat(filledBars) + '░'.repeat(barLength - filledBars);

    // Subject info
    let subjectInfo = 'none';
    if (shot.subject) {
      const s = shot.subject;
      const type = s.cfg?.type || s.type || '?';
      subjectInfo = `${type} #${s.id || '?'}`;
      // Show food target if available
      if (s.foodTarget && s.foodTarget.active !== false && !s.foodTarget.dead) {
        subjectInfo += ' → food';
      }
    }
    // Death phase indicator
    if (shot._deathPhase) {
      subjectInfo += ` [DEATH: ${shot._deathPhase}]`;
    }

    // Get narrative phase info
    const phaseNum = (debugInfo.shotsInPhase || 0) + 1;
    const totalPhases = debugInfo.targetShotsInPhase || 3;
    const phaseName = debugInfo.phase || 'DEVELOP';

    // Format transition style
    const transitionStyle = shot.transitionStyle || 'BLEND';

    // Format shot duration history
    const historyLines = this._shotDurationHistory.map(h => {
      const shortType = h.type.replace('ESTABLISHING_', 'EST_').replace('CHASE_', 'CH_')
        .replace('HERO_', 'H_').replace('SIDE_', 'S_').replace('GROUND_', 'GND_')
        .replace('MACRO_', 'MAC_').replace('SLOW_', 'SL_').replace('FLY_', 'FLY_')
        .replace('REACTION_', 'RX_').replace('KELP_', 'K_').replace('SNELLS_', 'SN_');
      return `${shortType} ${h.duration.toFixed(1)}s`;
    }).join(' → ');

    // Build the overlay HTML
    const html = `
DOCUMENTARY CAMERA
─────────────────────────
Phase: ${phaseName} (${phaseNum}/${totalPhases})
Shot:  ${shot.type}
Time:  ${shotElapsed.toFixed(1)}s / ${shotDuration.toFixed(1)}s  [${progressBar}]
DOF:   ${shot.dofProfile || 'SHALLOW'}
Trans: ${transitionStyle}
Subject: ${subjectInfo}
─────────────────────────
Recent: ${historyLines || '(none)'}
Speed:  ${this._camVelocity.toFixed(1)} u/s | Rot: ${this._camAngularVelocity.toFixed(1)}°/s
${this._camVelocity > 1.0 ? '⚠ FAST' : ''} ${this._camAngularVelocity > 35 ? '⚠ SPIN' : ''}
    `.trim();

    this._debugOverlay.innerHTML = html;
  }

  /**
   * Start a new shot with appropriate transition style (fade, cut, or blend).
   */
  _startNewShot(shotRequest) {
    const ss = this.ss;
    const prevType = ss.currentShot?.type;

    // Fill in subject if the shot needs one and doesn't have it.
    // Search from the creature hotspot (densest cluster) rather than camera
    // position, which may be far from any life after an environmental shot.
    if (!shotRequest.subject && this._needsSubject(shotRequest.type)) {
      const searchCenter = this._findHotspot() || this.camera.position;
      shotRequest.subject = this._findNearestCreature(searchCenter)
        || this._pickRandomCreature();
    }
    // Validate the subject is still alive
    if (shotRequest.subject && (shotRequest.subject.dead || !shotRequest.subject.active)) {
      const searchCenter = this._findHotspot() || this.camera.position;
      shotRequest.subject = this._findNearestCreature(searchCenter)
        || this._pickRandomCreature();
    }

    const transitionStyle = shotRequest.transitionStyle || 'BLEND';

    if (transitionStyle === 'FADE_BLACK') {
      ss.prevPos.copy(this.camera.position);
      ss.prevTarget.copy(ss.smoothLookAt);
      ss.fadePendingShot = shotRequest;
      ss.fadeState = 'FADING_OUT';
      ss.fadeTimer = 0;
      ss.fadeOutDuration = randomRange(0.3, 0.5);
      ss.fadeHoldDuration = randomRange(0.1, 0.2);
      ss.fadeInDuration = randomRange(0.4, 0.7);
    } else if (transitionStyle === 'CUT') {
      // Hard cut — teleport camera to new shot's first frame position immediately
      ss.currentShot = shotRequest;
      // Compute first frame and teleport
      const helpers = {
        getTerrainHeight,
        getMacroWaveHeight,
        findNearestCreature: (pos) => this._findNearestCreature(pos),
        findHotspot: () => this._findHotspot(),
        getAllCreatures: () => this._getAllCreatures(),
        surfaceY: CONFIG.surfaceY,
      };
      const frame = ss.cinematographer.computeFrame(ss.currentShot, 0, 0, helpers);
      this.camera.position.copy(frame.position);
      ss.smoothLookAt.copy(frame.lookAt);
      this.camera.lookAt(frame.lookAt);
      // Reset velocity tracking so next frame doesn't measure the teleport
      this._lastCamPos.copy(frame.position);
      const newDir = frame.lookAt.clone().sub(frame.position).normalize();
      this._lastLookDir.copy(newDir);
      this._camVelocity = 0;
      this._camAngularVelocity = 0;
      this._skipNextVelocityFrame = true;
    } else {
      // Any other transition (including legacy BLEND) → treat as fade-to-black
      ss.prevPos.copy(this.camera.position);
      ss.prevTarget.copy(ss.smoothLookAt);
      ss.fadePendingShot = shotRequest;
      ss.fadeState = 'FADING_OUT';
      ss.fadeTimer = 0;
      ss.fadeOutDuration = randomRange(0.3, 0.5);
      ss.fadeHoldDuration = randomRange(0.1, 0.2);
      ss.fadeInDuration = randomRange(0.4, 0.7);
    }
  }

  /**
   * Determine if a shot type requires a creature subject.
   */
  _needsSubject(type) {
    return ['HERO_PORTRAIT', 'CHASE_FOLLOW', 'SIDE_TRACK', 'SLOW_REVEAL',
            'REACTION_CUT', 'MACRO_DETAIL'].includes(type);
  }

  // ── Creature helpers ──────────────────────────────────────────

  _getAllCreatures() {
    if (!this._creaturePools) return [];
    const result = [];
    for (const { pool } of this._creaturePools) {
      for (const c of pool.pool) {
        if (c.active && !c.dead) result.push(c);
      }
    }
    return result;
  }

  _pickRandomCreature() {
    const creatures = this._getAllCreatures();
    if (creatures.length === 0) return null;
    return creatures[Math.floor(Math.random() * creatures.length)];
  }

  _findNearestCreature(pos) {
    const creatures = this._getAllCreatures();
    if (creatures.length === 0) return null;
    let best = null;
    let bestDist = Infinity;
    for (const c of creatures) {
      const d = pos.distanceToSquared(c.mesh.position);
      if (d < bestDist) { bestDist = d; best = c; }
    }
    return best;
  }

  /**
   * Returns the centroid of the densest creature cluster, or null if no creatures.
   */
  _findHotspot() {
    if (!this._creaturePools || this._creaturePools.length === 0) return null;

    const positions = [];
    for (const { pool } of this._creaturePools) {
      for (const c of pool.pool) {
        if (c.active && !c.dead) {
          positions.push(c.mesh.position);
        }
      }
    }
    if (positions.length === 0) return null;

    // Score each creature by how many neighbors it has within a radius
    const clusterRadius = 10;
    const r2 = clusterRadius * clusterRadius;
    let bestScore = -1;
    let bestIdx = 0;

    for (let i = 0; i < positions.length; i++) {
      let score = 0;
      for (let j = 0; j < positions.length; j++) {
        if (i === j) continue;
        if (positions[i].distanceToSquared(positions[j]) < r2) score++;
      }
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }

    // Compute centroid of the cluster around the best creature
    const center = new THREE.Vector3();
    let count = 0;
    for (let j = 0; j < positions.length; j++) {
      if (positions[bestIdx].distanceToSquared(positions[j]) < r2) {
        center.add(positions[j]);
        count++;
      }
    }
    center.divideScalar(count);

    return center;
  }

  // ── Camera collision ─────────────────────────────────────────
  /**
   * Draw cinematography framing guides on the grid overlay canvas.
   * Modes: 1 = Rule of Thirds, 2 = Golden Ratio (phi), 3 = Center Cross + Action Safe
   */
  _drawCineGrid() {
    const canvas = this._gridOverlay;
    const w = window.innerWidth;
    const h = window.innerHeight;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, w, h);

    if (this._gridMode === 1) {
      // ── Rule of Thirds ──
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
      ctx.lineWidth = 1;
      // Vertical lines at 1/3 and 2/3
      for (let i = 1; i <= 2; i++) {
        const x = Math.round(w * i / 3);
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
      }
      // Horizontal lines at 1/3 and 2/3
      for (let i = 1; i <= 2; i++) {
        const y = Math.round(h * i / 3);
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
      }
      // Power points (intersections) — small circles
      ctx.fillStyle = 'rgba(255, 136, 68, 0.6)';
      for (let ix = 1; ix <= 2; ix++) {
        for (let iy = 1; iy <= 2; iy++) {
          const x = w * ix / 3;
          const y = h * iy / 3;
          ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill();
        }
      }
    } else if (this._gridMode === 2) {
      // ── Golden Ratio (Phi lines) ──
      const phi = 0.618;
      ctx.strokeStyle = 'rgba(255, 200, 50, 0.35)';
      ctx.lineWidth = 1;
      // Vertical at phi and 1-phi
      const xA = Math.round(w * phi);
      const xB = Math.round(w * (1 - phi));
      ctx.beginPath(); ctx.moveTo(xA, 0); ctx.lineTo(xA, h); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(xB, 0); ctx.lineTo(xB, h); ctx.stroke();
      // Horizontal at phi and 1-phi
      const yA = Math.round(h * phi);
      const yB = Math.round(h * (1 - phi));
      ctx.beginPath(); ctx.moveTo(0, yA); ctx.lineTo(w, yA); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, yB); ctx.lineTo(w, yB); ctx.stroke();
      // Golden spiral approximation (quarter arcs in phi rectangles)
      ctx.strokeStyle = 'rgba(255, 200, 50, 0.2)';
      ctx.lineWidth = 1.5;
      // Draw a simplified golden spiral as concentric arcs
      let sx = 0, sy = 0, sw = w, sh = h;
      for (let i = 0; i < 8; i++) {
        ctx.beginPath();
        const r = Math.min(sw, sh) * phi;
        switch (i % 4) {
          case 0: ctx.arc(sx + sw, sy + sh, r, Math.PI, Math.PI * 1.5); break;
          case 1: ctx.arc(sx, sy + sh, r, Math.PI * 1.5, Math.PI * 2); break;
          case 2: ctx.arc(sx, sy, r, 0, Math.PI * 0.5); break;
          case 3: ctx.arc(sx + sw, sy, r, Math.PI * 0.5, Math.PI); break;
        }
        ctx.stroke();
        // Subdivide
        switch (i % 4) {
          case 0: sw *= phi; break;
          case 1: sh *= phi; break;
          case 2: sx += sw * (1 - phi); sw *= phi; break;
          case 3: sy += sh * (1 - phi); sh *= phi; break;
        }
      }
    } else if (this._gridMode === 3) {
      // ── Center Cross + Action Safe / Title Safe ──
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
      ctx.lineWidth = 1;
      // Center crosshair
      const cx = w / 2, cy = h / 2;
      ctx.beginPath(); ctx.moveTo(cx - 20, cy); ctx.lineTo(cx + 20, cy); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx, cy - 20); ctx.lineTo(cx, cy + 20); ctx.stroke();
      // Action safe (90%)
      ctx.strokeStyle = 'rgba(255, 100, 100, 0.25)';
      ctx.setLineDash([4, 4]);
      const ax = w * 0.05, ay = h * 0.05;
      ctx.strokeRect(ax, ay, w * 0.9, h * 0.9);
      // Title safe (80%)
      ctx.strokeStyle = 'rgba(100, 200, 255, 0.25)';
      const tx = w * 0.1, ty = h * 0.1;
      ctx.strokeRect(tx, ty, w * 0.8, h * 0.8);
      ctx.setLineDash([]);
      // Labels
      ctx.font = '10px monospace';
      ctx.fillStyle = 'rgba(255, 100, 100, 0.5)';
      ctx.fillText('ACTION SAFE', ax + 4, ay + 12);
      ctx.fillStyle = 'rgba(100, 200, 255, 0.5)';
      ctx.fillText('TITLE SAFE', tx + 4, ty + 12);
    }

    // ── Title-safe circle + subject tracking ──
    if (this.mode === 'screensaver' && this.ss && this.ss.currentShot) {
      const cx = w / 2, cy = h / 2;

      // Title-safe circle: 85% of the smaller viewport dimension
      // Fits just inside the title-safe rectangle, giving a clear keep-in zone
      const safeRadius = Math.min(w, h) * 0.40; // ~80% of title-safe area

      // Draw the title-safe circle
      ctx.strokeStyle = 'rgba(0, 200, 255, 0.25)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.arc(cx, cy, safeRadius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      // Label
      ctx.font = '9px monospace';
      ctx.fillStyle = 'rgba(0, 200, 255, 0.4)';
      ctx.fillText('TITLE SAFE', cx + safeRadius + 6, cy - 4);

      // Project subject creature to screen space
      const shot = this.ss.currentShot;
      const subj = shot.subject;
      if (subj && subj.mesh && !subj.dead) {
        const worldPos = subj.mesh.position.clone();
        worldPos.project(this.camera);
        const sx = (worldPos.x * 0.5 + 0.5) * w;
        const sy = (-worldPos.y * 0.5 + 0.5) * h;
        // Only draw if subject is in front of camera
        if (worldPos.z < 1) {
          // Check if subject is inside the title-safe circle
          const dx = sx - cx, dy = sy - cy;
          const distFromCenter = Math.sqrt(dx * dx + dy * dy);
          const isInside = distFromCenter <= safeRadius;

          // Color: green if inside safe zone, red if outside
          const ringColor = isInside ? 'rgba(50, 255, 50, 0.7)' : 'rgba(255, 50, 50, 0.7)';
          const dotColor = isInside ? 'rgba(50, 255, 50, 0.8)' : 'rgba(255, 50, 50, 0.8)';
          const labelColor = isInside ? 'rgba(50, 255, 50, 0.6)' : 'rgba(255, 50, 50, 0.6)';

          // Outer ring
          ctx.strokeStyle = ringColor;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(sx, sy, 28, 0, Math.PI * 2);
          ctx.stroke();
          // Crosshair ticks
          ctx.beginPath();
          ctx.moveTo(sx - 36, sy); ctx.lineTo(sx - 28, sy);
          ctx.moveTo(sx + 28, sy); ctx.lineTo(sx + 36, sy);
          ctx.moveTo(sx, sy - 36); ctx.lineTo(sx, sy - 28);
          ctx.moveTo(sx, sy + 28); ctx.lineTo(sx, sy + 36);
          ctx.stroke();
          // Inner dot
          ctx.fillStyle = dotColor;
          ctx.beginPath();
          ctx.arc(sx, sy, 3, 0, Math.PI * 2);
          ctx.fill();
          // Label with distance info
          ctx.font = '9px monospace';
          ctx.fillStyle = labelColor;
          const pct = Math.round(distFromCenter / safeRadius * 100);
          ctx.fillText(`SUBJECT ${pct}%`, sx + 40, sy + 3);

          // Draw line from subject to circle edge when outside
          if (!isInside) {
            ctx.strokeStyle = 'rgba(255, 50, 50, 0.3)';
            ctx.lineWidth = 1;
            ctx.setLineDash([3, 3]);
            // Line from subject to nearest point on circle
            const angle = Math.atan2(dy, dx);
            const edgeX = cx + Math.cos(angle) * safeRadius;
            const edgeY = cy + Math.sin(angle) * safeRadius;
            ctx.beginPath();
            ctx.moveTo(sx, sy);
            ctx.lineTo(edgeX, edgeY);
            ctx.stroke();
            ctx.setLineDash([]);
          }
        }
      }
    }
  }

  /**
   * Push the camera away from any creature whose mesh is too close.
   * Acts as a soft collision sphere — prevents the camera from clipping
   * through fish and other creatures during screensaver mode.
   */
  _applyCameraCollision() {
    const camPos = this.camera.position;
    const collisionRadius = 0.8; // Minimum distance camera keeps from creatures
    const pushStrength = 1.0;    // How much to push per frame (soft, not instant)
    const creatures = this._getAllCreatures();

    for (const creature of creatures) {
      const creaturePos = creature.mesh.position;
      const dx = camPos.x - creaturePos.x;
      const dy = camPos.y - creaturePos.y;
      const dz = camPos.z - creaturePos.z;
      const distSq = dx * dx + dy * dy + dz * dz;
      const minDistSq = collisionRadius * collisionRadius;

      if (distSq < minDistSq && distSq > 0.001) {
        // Camera is inside the collision sphere — push it out
        const dist = Math.sqrt(distSq);
        const overlap = collisionRadius - dist;
        const pushX = (dx / dist) * overlap * pushStrength;
        const pushY = (dy / dist) * overlap * pushStrength;
        const pushZ = (dz / dist) * overlap * pushStrength;
        camPos.x += pushX;
        camPos.y += pushY;
        camPos.z += pushZ;
      }
    }
  }

  /**
   * Show or hide cinematic letterbox bars.
   * Uses a gentle 2.0:1 ratio — thin bars that sit at title-safe edges
   * rather than aggressively cropping into the frame.
   * @param {boolean} show - true to show, false to hide
   */
  _showLetterbox(show) {
    if (show) {
      // Calculate bar height for 2.0:1 cinematic ratio (thinner, title-safe)
      const barHeight = Math.max(0, (window.innerHeight - window.innerWidth / 2.0) / 2);
      const barPx = Math.round(barHeight) + 'px';
      this._letterboxTop.style.height = barPx;
      this._letterboxBottom.style.height = barPx;
    } else {
      this._letterboxTop.style.height = '0';
      this._letterboxBottom.style.height = '0';
    }
  }

  // ── Compat shims ─────────────────────────────────────────────
  // NarrativeMode sets these — keep them working

  setTarget(position) {
    if (this.mode === 'screensaver') {
      this.ss.target.copy(position);
    }
  }

  get controls() {
    // Shim for code that accesses cameraController.controls.target etc.
    const self = this;
    return {
      get target() { return self.ss.target; },
      set autoRotate(_v) { /* no-op */ },
      get autoRotate() { return self.mode === 'screensaver'; },
      update() { /* no-op — we update in our own update() */ },
    };
  }

  dispose() {
    this.domElement.removeEventListener('click', this._onClick);
    document.removeEventListener('mousemove', this._onMouseMove);
    document.removeEventListener('keydown', this._onKeyDown);
    document.removeEventListener('keyup', this._onKeyUp);
    document.removeEventListener('pointerlockchange', this._onPointerLockChange);
    if (document.pointerLockElement) document.exitPointerLock();
  }
}
