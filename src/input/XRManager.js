/**
 * XRManager - WebXR VR integration for PolyFish.
 *
 * Handles:
 *   - VR session lifecycle (enter/exit)
 *   - Controller tracking + model rendering
 *   - Laser pointer UI interaction (title screen buttons, menus)
 *   - Thumbstick locomotion (left stick = move, right stick = smooth turn)
 *   - Physics-based food throwing (inherits controller velocity + upward float)
 *   - Hand tracking fallback (Quest + Vision Pro)
 *
 * Input architecture (aligned with Three.js WebXR examples):
 *   - Controllers are obtained via renderer.xr.getController(i)
 *   - Each controller fires 'connected' with event.data = XRInputSource,
 *     giving us the stable mapping between controller index and inputSource.
 *   - select/squeeze events also carry event.data = inputSource.
 *   - Per-channel state (trigger, grip, face, pinch) tracked independently
 *     per controller index. Unified "held" = OR of all channels.
 *   - Throw velocity uses Three.js built-in controller.hasLinearVelocity /
 *     controller.linearVelocity from the XR frame pose data.
 */
import * as THREE from 'three';
import { XRControllerModelFactory } from 'three/examples/jsm/webxr/XRControllerModelFactory.js';
import { XRHandModelFactory } from 'three/examples/jsm/webxr/XRHandModelFactory.js';
import { VRButton } from 'three/examples/jsm/webxr/VRButton.js';
import { XRHandGestures } from './XRHandGestures.js';
import { VRComfortVignette } from '../rendering/VRComfortVignette.js';
import { VRHud } from '../rendering/VRHud.js';
import { VRDebugPanel, VR_BUILD_VERSION } from '../rendering/VRDebugPanel.js';
import { VRControllerHints } from '../rendering/VRControllerHints.js';
import { CONFIG } from '../config.js';
import { getTerrainHeight } from '../utils/Terrain.js';

const _forward = new THREE.Vector3();
const _right = new THREE.Vector3();
const _inputDir = new THREE.Vector3();
const _throwForce = new THREE.Vector3();
const _controllerDir = new THREE.Vector3();
const _tempMatrix = new THREE.Matrix4();
const _raycaster = new THREE.Raycaster();
const _intersections = [];
const _worldQuat = new THREE.Quaternion();

export class XRManager {
  constructor(renderer, scene, camera, options = {}) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.devMode = !!options.devMode;

    /** The XR camera rig - a Group that we move for locomotion.
     *  The actual XR camera is a child of this rig. */
    this.rig = new THREE.Group();
    this.rig.name = 'xr-rig';

    // Controller references (indexed by Three.js controller index, NOT handedness)
    this.controllers = [null, null];  // [0, 1] target ray spaces
    this.controllerGrips = [null, null];
    this.hands = [null, null];

    // ── InputSource tracking (from 'connected' events) ──
    // Three.js's internal mapping between controller index and XRInputSource
    // is NOT the same as session.inputSources[i]. The 'connected' event
    // gives us the correct mapping.
    this._inputSources = [null, null]; // XRInputSource per controller index
    this._handedness = [null, null];   // 'left'|'right'|null per controller index

    // Locomotion
    this.moveSpeed = 1.33;
    this.smoothTurnSpeed = 1.5; // radians/sec
    this.velocity = new THREE.Vector3();
    this.acceleration = 10.0;
    this.friction = 6.0;

    // Movement dampening (0 = no input, 1 = full input). Used by end sequence
    // to fade out control effectiveness gradually rather than hard-disabling.
    this._movementScale = 1.0;

    // ── Per-channel input state (tracked independently to avoid cross-interference) ──
    // Each is indexed by Three.js controller index [0, 1]
    this._selectHeld = [false, false];     // trigger (selectstart/selectend)
    this._squeezeHeld = [false, false];    // grip (squeezestart/squeezeend)
    this._faceButtonHeld = [false, false]; // A/B/X/Y face buttons (polled)
    this._pinchHeld = [false, false];      // hand tracking pinch

    // Per-controller feeding state (both hands can hold food independently)
    this._feedHeldPerCtrl = [false, false];
    this._feedJustReleasedPerCtrl = [false, false];

    // Legacy aliases for backward compat (used by debug panel, laser pointer, etc.)
    this._feedHeld = false;
    this._feedControllerIndex = -1;
    this._feedJustReleased = false;

    // Throw physics
    this.floatUp = 0.4; // gentle upward drift on release

    // Laser pointer for UI interaction
    this._laserRays = [null, null];
    this._laserDots = [null, null];
    this._hoveredElement = null;

    // Hand gesture detection (initialized after hands are created)
    this.handGestures = null;

    // Factories for auto-loading controller/hand meshes
    this._controllerModelFactory = new XRControllerModelFactory();
    this._handModelFactory = new XRHandModelFactory();

    // VR comfort vignette
    this.vignette = null;

    // VR HUD (population counter)
    this.hud = null;

    // VR debug panel (floating text at chest level)
    this.debugPanel = null;

    // VR controller tutorial hints
    this.controllerHints = null;

    // Session state
    this._vrButton = null;
    this._active = false;
    this._titleClickCallback = null; // set by main.js for title screen interaction

    // Performance targets for VR mode optimization
    this.sceneManager = null;
    this.marineSnow = null;
    this.vfxManager = null;
  }

  /** Whether we're currently in an active VR session */
  get active() {
    return this._active;
  }

  /**
   * Register a callback for when a title-screen button is "clicked" via VR laser.
   * @param {(withNarration: boolean) => void} cb
   */
  set onTitleSelect(cb) {
    this._titleClickCallback = cb;
  }

  /**
   * Initialize WebXR on the renderer. Call once during setup.
   * Returns the VR button element (or null if WebXR is unavailable).
   */
  init() {
    const xr = this.renderer.xr;
    xr.enabled = true;
    xr.setReferenceSpaceType('local-floor');

    // Reparent the camera under the rig
    this.rig.add(this.camera);
    this.scene.add(this.rig);

    // Initialize VR comfort vignette
    this.vignette = new VRComfortVignette();
    this.vignette.attach(this.camera);

    // ── Fade-from-black overlay (shown on VR session start) ──
    // Clip-space full-screen quad (same technique as VRComfortVignette) so it
    // works correctly with WebXR's stereo projection override.
    const fadeGeo = new THREE.PlaneGeometry(2, 2);
    const fadeMat = new THREE.ShaderMaterial({
      vertexShader: `void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: `uniform float opacity; void main() { gl_FragColor = vec4(0.0, 0.0, 0.0, opacity); }`,
      uniforms: { opacity: { value: 0.0 } },
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    this._fadeMesh = new THREE.Mesh(fadeGeo, fadeMat);
    this._fadeMesh.renderOrder = 999; // just below vignette
    this._fadeMesh.frustumCulled = false;
    this._fadeMesh.visible = false;
    this.camera.add(this._fadeMesh);
    this._fadeTimer = 0;
    this._fadeDuration = 4.0;

    // VR HUD (population dive-watch) - deferred to 'connected' event
    // so we know which controller is left hand.
    this.hud = null;
    this._hudControllerIndex = -1;

    // Initialize VR debug panel (dev mode only)
    if (this.devMode) {
      this.debugPanel = new VRDebugPanel(this.camera);
      this.debugPanel.setVisible(false);
    }

    // Initialize controller tutorial hints
    this.controllerHints = new VRControllerHints();

    // ── Controllers ──
    for (let i = 0; i < 2; i++) {
      const controller = this.renderer.xr.getController(i);
      this.rig.add(controller);
      this.controllers[i] = controller;

      // ── Connected/Disconnected (Three.js pattern) ──
      // The 'connected' event carries event.data = XRInputSource, giving us
      // the stable mapping between this controller index and the input source.
      controller.addEventListener('connected', (event) => {
        this._inputSources[i] = event.data;
        this._handedness[i] = event.data.handedness;
        this.debugPanel?.log(`connected ctrl=${i} hand=${event.data.handedness}`);
        // XRManager: controller connected

        // Attach dive-watch HUD to the left controller
        if (event.data.handedness === 'left' && !this.hud) {
          this.hud = new VRHud(controller);
          this._hudControllerIndex = i;
          if (this._active) this.hud.setVisible(true);
          this.debugPanel?.log(`dive-watch HUD on ctrl=${i}`);
        }

        // Attach tutorial hints to grip space
        if (this.controllerHints && this.controllerGrips[i]) {
          this.controllerHints.attachToController(
            i, event.data.handedness, this.controllerGrips[i]
          );
        }
      });

      controller.addEventListener('disconnected', () => {
        this.debugPanel?.log(`disconnected ctrl=${i} hand=${this._handedness[i]}`);
        // XRManager: controller disconnected
        // Clean up dive-watch HUD if this was the left controller
        if (this._hudControllerIndex === i && this.hud) {
          this.hud.dispose();
          this.hud = null;
          this._hudControllerIndex = -1;
        }
        // Detach tutorial hints
        if (this.controllerHints) {
          this.controllerHints.detachController(i);
        }
        this._inputSources[i] = null;
        this._handedness[i] = null;
        // Clear any held state on this controller
        this._selectHeld[i] = false;
        this._squeezeHeld[i] = false;
        this._faceButtonHeld[i] = false;
        this._pinchHeld[i] = false;
        this._syncFeedState(i);
      });

      // Controller select events (trigger press/release)
      // event.data = XRInputSource (same as connected event)
      controller.addEventListener('selectstart', (event) => this._onSelectStart(i, event));
      controller.addEventListener('selectend', (event) => this._onSelectEnd(i, event));

      // Squeeze events (grip button)
      controller.addEventListener('squeezestart', (event) => this._onSqueezeStart(i, event));
      controller.addEventListener('squeezeend', (event) => this._onSqueezeEnd(i, event));

      // Controller grip (for model attachment)
      const grip = this.renderer.xr.getControllerGrip(i);
      grip.add(this._controllerModelFactory.createControllerModel(grip));
      this.rig.add(grip);
      this.controllerGrips[i] = grip;

      // Hand tracking
      const hand = this.renderer.xr.getHand(i);
      hand.add(this._handModelFactory.createHandModel(hand, 'mesh'));
      this.rig.add(hand);
      this.hands[i] = hand;

      // Laser pointers removed - controllers use direct interaction only.
      // Keeping the arrays populated with nulls so existing code that
      // references _laserRays[i] / _laserDots[i] doesn't throw.
      this._laserRays[i] = null;
      this._laserDots[i] = null;
    }

    // Initialize hand gesture detection
    this.handGestures = new XRHandGestures(this.hands[0], this.hands[1]);

    // Attach feed-state indicator cubes to controllers
    if (this.debugPanel) {
      this.debugPanel.attachIndicators(this.controllers);
    }


    // Listen for session start/end
    xr.addEventListener('sessionstart', () => {
      // Cut to black IMMEDIATELY — before any camera/rig work — to hide VR setup
      if (this._fadeMesh) {
        this._fadeMesh.material.uniforms.opacity.value = 1;
        this._fadeMesh.visible = true;
        this._fadeTimer = -0.5; // hold black for 0.5s to let framerate stabilize
      }
      this._active = true;
      this._hasLastPos = false;
      // Position rig now that VR is active (local-floor adds eye height)
      if (this._startPos) {
        this.rig.position.copy(this._startPos);
      }
      // Reset vignette on session start
      if (this.vignette) {
        this.vignette.setIntensity(0);
      }
      // Show HUD when entering VR
      if (this.hud) this.hud.setVisible(true);
      // Show debug panel
      if (this.debugPanel) {
        this.debugPanel.setVisible(true);
        this.debugPanel.log(`VR session started ${VR_BUILD_VERSION}`);
        // Check if DOM overlay was granted
        const session = this.renderer.xr.getSession();
        const hasDomOverlay = !!session?.domOverlay?.type;
        this.debugPanel.log(`dom-overlay: ${hasDomOverlay ? session.domOverlay.type : 'NOT granted'}`);
        // Log tracked input sources (from connected events)
        for (let i = 0; i < 2; i++) {
          const src = this._inputSources[i];
          if (src) {
            this.debugPanel.log(`ctrl[${i}] hand=${src.handedness} btns=${src.gamepad?.buttons?.length || 0}`);
          } else {
            this.debugPanel.log(`ctrl[${i}] not connected`);
          }
        }
      }
      // Trigger VR performance optimizations
      if (this.sceneManager) this.sceneManager.setVRMode(true);
      if (this.marineSnow) this.marineSnow.setVRMode(true);
      if (this.vfxManager) this.vfxManager.setVRMode(true);
      // XRManager: VR session started
    });
    xr.addEventListener('sessionend', () => {
      this._active = false;
      this._feedHeldPerCtrl = [false, false];
      this._feedJustReleasedPerCtrl = [false, false];
      this._feedHeld = false;
      this._feedJustReleased = false;
      this._selectHeld[0] = this._selectHeld[1] = false;
      this._squeezeHeld[0] = this._squeezeHeld[1] = false;
      this._faceButtonHeld[0] = this._faceButtonHeld[1] = false;
      this._pinchHeld[0] = this._pinchHeld[1] = false;
      this._inputSources[0] = this._inputSources[1] = null;
      this._handedness[0] = this._handedness[1] = null;
      // Reset vignette intensity on session end
      if (this.vignette) {
        this.vignette.setIntensity(0);
      }
      // Hide HUD and debug panel when exiting VR
      if (this.hud) this.hud.setVisible(false);
      if (this.debugPanel) this.debugPanel.setVisible(false);
      // Restore camera: move world position back to camera.position,
      // reset rig to origin so flat-screen CameraController works normally
      const worldPos = new THREE.Vector3();
      this.camera.getWorldPosition(worldPos);
      this.rig.position.set(0, 0, 0);
      this.rig.rotation.set(0, 0, 0);
      this.camera.position.copy(worldPos);
      // Hide laser dots
      for (const dot of this._laserDots) {
        if (dot) dot.visible = false;
      }
      // Restore full performance when leaving VR
      if (this.sceneManager) this.sceneManager.setVRMode(false);
      if (this.marineSnow) this.marineSnow.setVRMode(false);
      if (this.vfxManager) this.vfxManager.setVRMode(false);
      // XRManager: VR session ended
    });

    // Create VR button using official Three.js implementation.
    // dom-overlay uses document.body as root — most compatible pattern.
    // VREndScreen appends its credits overlay to body (z-index 1000 covers everything).
    this._vrButton = VRButton.createButton(this.renderer, {
      optionalFeatures: ['hand-tracking', 'dom-overlay'],
      domOverlay: { root: document.body },
    });

    // Place VR button inside the title-screen button group so it visually
    // centers with Start / Start w/ Narration between the logo and copyright.
    // Override the official VRButton's absolute positioning to flow in the flex column.
    const titleButtons = document.querySelector('#title-screen .title-buttons');
    if (titleButtons) {
      this._vrButton.classList.add('title-btn', 'vr-title-btn');
      // Reset the inline styles VRButton.js applies (position:absolute, bottom:20px, etc.)
      this._vrButton.style.position = 'static';
      this._vrButton.style.bottom = '';
      this._vrButton.style.left = '';
      this._vrButton.style.width = '';
      this._vrButton.style.cursor = 'pointer';
      this._vrButton.style.padding = '';
      this._vrButton.style.font = '';
      this._vrButton.style.fontSize = '';
      this._vrButton.style.border = '';
      this._vrButton.style.borderRadius = '';
      this._vrButton.style.background = '';
      this._vrButton.style.color = '';
      this._vrButton.style.textAlign = '';
      this._vrButton.style.opacity = '';
      this._vrButton.style.outline = '';
      this._vrButton.style.zIndex = '';
      titleButtons.appendChild(this._vrButton);
    } else {
      document.body.appendChild(this._vrButton);
    }

    // The official VRButton sets text asynchronously after checking
    // isSessionSupported. Override unfriendly messages:
    const vrBtn = this._vrButton;
    const observer = new MutationObserver(() => {
      const text = (vrBtn.textContent || '').trim();
      if (text === 'VR NOT SUPPORTED' || text === 'VR NOT ALLOWED' || text === 'WEBXR NEEDS HTTPS') {
        vrBtn.textContent = 'Connect VR Headset';
      }
      const anchor = vrBtn.querySelector('a');
      if (anchor && (anchor.textContent || '').includes('HTTPS')) {
        vrBtn.textContent = 'Connect VR Headset';
      }
    });
    observer.observe(vrBtn, { childList: true, characterData: true, subtree: true });

    return this._vrButton;
  }

  // ── Haptic Feedback ───────────────────────────────────────────────

  /**
   * Send haptic pulse to a controller by Three.js controller index.
   * Uses the inputSource tracked from the 'connected' event (NOT
   * session.inputSources[i], which has a different index mapping).
   */
  _pulseHaptic(controllerIndex, intensity, duration) {
    const source = this._inputSources[controllerIndex];
    if (!source?.gamepad) return;

    if (source.gamepad.vibrationActuator) {
      source.gamepad.vibrationActuator.playEffect?.('dual-rumble', {
        duration, strongMagnitude: intensity, weakMagnitude: intensity * 0.5,
      }).catch(() => {});
    } else if (source.gamepad.hapticActuators?.[0]?.pulse) {
      source.gamepad.hapticActuators[0].pulse(intensity, duration).catch(() => {});
    }
  }

  /**
   * Pulse haptic on the active feeding controller when a fish eats from hand.
   * Stronger than the feed-start pulse (0.6 intensity, 150ms).
   */
  pulseEatHaptic() {
    const idx = this._feedControllerIndex;
    if (idx >= 0) {
      this._pulseHaptic(idx, 0.6, 150);
    }
  }

  // ── Laser Pointer UI ─────────────────────────────────────────────

  /**
   * Raycast from controllers (reserved for future UI interaction).
   * Laser visuals have been removed - this is now a no-op.
   */
  _updateLaserPointer() {
    // Lasers removed - no-op
  }

  // ── Controller Events (per-channel, no cross-interference) ──────

  _onSelectStart(index, event) {
    // Update inputSource mapping in case it changed
    if (event.data) {
      this._inputSources[index] = event.data;
      this._handedness[index] = event.data.handedness;
    }
    this._selectHeld[index] = true;
    this.debugPanel?.log(`selectStart ctrl=${index} hand=${this._handedness[index]}`);
    this._syncFeedState(index);
  }

  _onSelectEnd(index, event) {
    if (event.data) {
      this._inputSources[index] = event.data;
      this._handedness[index] = event.data.handedness;
    }
    this._selectHeld[index] = false;
    this.debugPanel?.log(`selectEnd ctrl=${index}`);
    this._syncFeedState(index);
  }

  _onSqueezeStart(index, event) {
    if (event.data) {
      this._inputSources[index] = event.data;
      this._handedness[index] = event.data.handedness;
    }
    this._squeezeHeld[index] = true;
    this.debugPanel?.log(`squeezeStart ctrl=${index}`);
    this._syncFeedState(index);
  }

  _onSqueezeEnd(index, event) {
    if (event.data) {
      this._inputSources[index] = event.data;
      this._handedness[index] = event.data.handedness;
    }
    this._squeezeHeld[index] = false;
    this.debugPanel?.log(`squeezeEnd ctrl=${index}`);
    this._syncFeedState(index);
  }

  /**
   * Derive unified feed state from per-channel states.
   * Called after any channel changes. Only triggers haptic/laser on transitions.
   *
   * SIMPLIFIED (v9): Only the trigger (select) channel drives feeding.
   * Grip, face buttons, and pinch were causing false positives on Quest
   * (grip spring bounce, face button mappings reading as always-pressed).
   * Those channels may be re-enabled once basic feeding is verified working.
   */
  _syncFeedState(changedIndex) {
    // Only trigger (select) drives feeding - other channels caused stuck "held" state
    const triggerHeld = this._selectHeld[changedIndex];
    const wasHeld = this._feedHeldPerCtrl[changedIndex];

    if (!wasHeld && triggerHeld) {
      // Transition: not feeding -> feeding (on this controller)
      this._feedHeldPerCtrl[changedIndex] = true;
      this._pulseHaptic(changedIndex, 0.3, 50);
      this.debugPanel?.setIndicatorColor(changedIndex, 0xff0000);
      this.debugPanel?.log(`FEED START ctrl=${changedIndex} hand=${this._handedness[changedIndex]}`);
      this.controllerHints?.markCompleted('feed');
    } else if (wasHeld && !triggerHeld) {
      // Transition: feeding -> released
      this._feedHeldPerCtrl[changedIndex] = false;
      this._feedJustReleasedPerCtrl[changedIndex] = true;
      this._pulseHaptic(changedIndex, 0.5, 100);
      this.debugPanel?.setIndicatorColor(changedIndex, 0x00ff00);
      this.debugPanel?.log(`FEED RELEASE ctrl=${changedIndex}`);
    }

    // Update legacy aliases for backward compat
    this._feedHeld = this._feedHeldPerCtrl[0] || this._feedHeldPerCtrl[1];
    this._feedControllerIndex = this._feedHeldPerCtrl[1] ? 1 : (this._feedHeldPerCtrl[0] ? 0 : -1);
  }

  // ── Per-Frame Update ───────────────────────────────────────────

  /**
   * Call every frame from the game loop.
   * @param {number} dt - delta time
   * @param {FeedingInput} feedingInput - for throw parameters
   * @param {THREE.Object3D|null} heldFood - currently held food entity
   * @returns {{ triggerHeld, triggerReleased, holdPosition, throwForce }|null}
   */
  update(dt, feedingInput, heldFood) {
    if (!this._active) return null;

    const session = this.renderer.xr.getSession();
    if (!session) return null;

    try {
      this._updateLocomotion(dt);
    } catch (e) {
      this.debugPanel?.setIndicatorColor(0, 0xffffff); // WHITE = locomotion error
      this.debugPanel?.setIndicatorColor(1, 0xffffff);
      console.error('[XR] locomotion error:', e);
    }

    try {
      this._updateLaserPointer();
    } catch (e) {
      console.error('[XR] laser error:', e);
    }

    // ── Fade-from-black animation (ease-out for gentle reveal) ──
    // Timer starts negative (hold period); fade begins at t=0.
    if (this._fadeMesh && this._fadeMesh.visible) {
      this._fadeTimer += dt;
      if (this._fadeTimer <= 0) {
        // Still in hold period — stay fully black
        this._fadeMesh.material.uniforms.opacity.value = 1;
      } else {
        const t = Math.min(this._fadeTimer / this._fadeDuration, 1);
        const ease = 1 - (1 - t) * (1 - t);
        this._fadeMesh.material.uniforms.opacity.value = 1 - ease;
        if (t >= 1) {
          this._fadeMesh.visible = false;
        }
      }
    }

    try {
      // Update comfort vignette based on movement
      if (this.vignette) {
        const isMoving = this.velocity.length() > 0.05;
        this.vignette.update(dt, isMoving);
      }
    } catch (e) {
      console.error('[XR] vignette error:', e);
    }

    try {
      // Update hand gesture detection (pinch -> feed)
      if (this.handGestures) {
        this.handGestures.update(dt, session);
        this._updatePinchState();
      }
    } catch (e) {
      console.error('[XR] hand gesture error:', e);
    }

    try {
      // Poll face buttons (A/B/X/Y) using tracked inputSources
      this._pollFaceButtons();
    } catch (e) {
      console.error('[XR] face button error:', e);
    }

    let result = null;
    try {
      result = this._updateFeeding(dt, feedingInput, heldFood);
      // ── DEBUG: YELLOW cube = _updateFeeding returned triggerHeld=true ──
      if (result) {
        for (let ci = 0; ci < result.length; ci++) {
          if (result[ci] && result[ci].triggerHeld) {
            this.debugPanel?.setIndicatorColor(ci, 0xffff00);
          }
        }
      }
    } catch (e) {
      // ── DEBUG: MAGENTA cube = exception in _updateFeeding ──
      this.debugPanel?.setIndicatorColor(0, 0xff00ff);
      this.debugPanel?.setIndicatorColor(1, 0xff00ff);
      console.error('[XR] feeding error:', e);
    }

    // Update debug panel texture (positioning is automatic - it's a camera child)
    try {
      if (this.debugPanel) {
        this.debugPanel.update();
      }
    } catch (e) {
      console.error('[XR] debug panel error:', e);
    }

    // Update controller tutorial hints (fade animations + billboard toward camera)
    try {
      if (this.controllerHints) {
        this.controllerHints.update(dt, this.camera);
      }
    } catch (e) {
      console.error('[XR] hints error:', e);
    }

    // Billboard the dive-watch HUD toward the camera each frame
    try {
      if (this.hud) {
        this.hud.billboard(this.camera);
      }
    } catch (e) {
      // silent
    }

    return result;
  }

  /**
   * Poll face buttons (A/B/X/Y) each frame.
   * Uses the inputSource tracked per controller from 'connected' events,
   * NOT session.inputSources (which has different index mapping).
   * Quest xr-standard-gamepad: button 4 = A/X, button 5 = B/Y.
   */
  _pollFaceButtons() {
    for (let i = 0; i < 2; i++) {
      const source = this._inputSources[i];
      if (!source) continue;

      const gp = source.gamepad;
      if (!gp || !gp.buttons || gp.buttons.length < 5) continue;

      const pressed = !!(gp.buttons[4]?.pressed || gp.buttons[5]?.pressed);
      const wasPressed = this._faceButtonHeld[i];

      if (pressed !== wasPressed) {
        this._faceButtonHeld[i] = pressed;
        this.debugPanel?.log(`faceBtn ctrl=${i} pressed=${pressed}`);
        this._syncFeedState(i);
      }
    }
  }

  /**
   * Map hand tracking pinch gestures to per-channel pinch state.
   */
  _updatePinchState() {
    if (!this.handGestures) return;

    for (let i = 0; i < 2; i++) {
      const pinching = this.handGestures.isPinching(i);
      const wasPinching = this._pinchHeld[i];

      if (pinching !== wasPinching) {
        this._pinchHeld[i] = pinching;
        this._syncFeedState(i);
      }
    }
  }

  /**
   * Thumbstick locomotion - left stick moves, right stick smooth-turns.
   * Movement direction follows the LEFT CONTROLLER's pointing direction
   * (not head direction), which feels more natural in VR.
   *
   * Uses stored inputSources from 'connected' events (not session.inputSources)
   * so controller index and handedness are correctly paired.
   */
  _updateLocomotion(dt) {
    let moveX = 0, moveY = 0;
    let turnX = 0;
    let leftCtrlIndex = -1;

    // Read axes from tracked inputSources
    for (let i = 0; i < 2; i++) {
      const source = this._inputSources[i];
      if (!source?.gamepad) continue;
      const axes = source.gamepad.axes;
      if (!axes || axes.length < 2) continue;

      if (source.handedness === 'left') {
        leftCtrlIndex = i;
        // Standard mapping: axes[0]=X, axes[1]=Y for the primary thumbstick
        // Some devices put them at axes[2]/axes[3], so check both
        moveX = Math.abs(axes[2]) > 0.15 ? axes[2] : (Math.abs(axes[0]) > 0.15 ? axes[0] : 0);
        moveY = Math.abs(axes[3]) > 0.15 ? axes[3] : (Math.abs(axes[1]) > 0.15 ? axes[1] : 0);
      } else if (source.handedness === 'right') {
        turnX = Math.abs(axes[2]) > 0.15 ? axes[2] : (Math.abs(axes[0]) > 0.15 ? axes[0] : 0);
      }
    }

    // Apply movement dampening (end sequence fades this to 0)
    moveX *= this._movementScale;
    moveY *= this._movementScale;
    turnX *= this._movementScale;

    // Smooth turn (right stick X axis)
    if (Math.abs(turnX) > 0.1) {
      this.rig.rotateY(-turnX * this.smoothTurnSpeed * dt);
      this.controllerHints?.markCompleted('turn');
    }

    // Locomotion - move in the direction the left controller is pointing
    if (Math.abs(moveX) > 0.01 || Math.abs(moveY) > 0.01) {
      // Use left controller direction if available, fall back to head
      const refObject = (leftCtrlIndex >= 0 && this.controllers[leftCtrlIndex])
        ? this.controllers[leftCtrlIndex]
        : this.renderer.xr.getCamera();

      refObject.getWorldQuaternion(_worldQuat);

      // Forward follows controller pointing (including vertical for underwater)
      _forward.set(0, 0, -1).applyQuaternion(_worldQuat).normalize();
      // Right is horizontal only (no barrel roll)
      _right.set(1, 0, 0).applyQuaternion(_worldQuat);
      _right.y = 0;
      _right.normalize();

      _inputDir.set(0, 0, 0);
      _inputDir.addScaledVector(_forward, -moveY);
      _inputDir.addScaledVector(_right, moveX);
      _inputDir.normalize();

      this.velocity.addScaledVector(_inputDir, this.acceleration * dt);
      if (this.velocity.length() > this.moveSpeed) {
        this.velocity.normalize().multiplyScalar(this.moveSpeed);
      }
      this.controllerHints?.markCompleted('move');
    } else {
      const f = Math.exp(-this.friction * dt);
      this.velocity.multiplyScalar(f);
      if (this.velocity.lengthSq() < 0.0001) this.velocity.set(0, 0, 0);
    }

    this.rig.position.addScaledVector(this.velocity, dt);

    // Terrain collision - don't go through the floor
    const terrainY = getTerrainHeight(this.rig.position.x, this.rig.position.z);
    if (this.rig.position.y < terrainY) {
      this.rig.position.y = terrainY;
      if (this.velocity.y < 0) this.velocity.y = 0;
    }

    // Surface ceiling - don't go above water
    const surfaceY = CONFIG.surfaceY;
    if (this.rig.position.y > surfaceY - 1.0) {
      this.rig.position.y = surfaceY - 1.0;
      if (this.velocity.y > 0) this.velocity.y = 0;
    }
  }

  /**
   * Feeding with physics-based throwing - per-controller.
   * Both controllers can independently hold and throw food.
   *
   * ARCHITECTURE: Instead of manually computing world positions (which are
   * stale during the animation callback), we use scene-graph parenting.
   * main.js parents food meshes to the grip group while held, so Three.js
   * handles the transform automatically during render - the same mechanism
   * that makes controller hints track perfectly.
   *
   * This method returns per-controller state:
   *   { triggerHeld, triggerReleased, grip, throwForce }
   * main.js handles parenting/unparenting the food mesh.
   */
  _updateFeeding(dt, feedingInput, heldFood) {
    const results = [];

    for (let ci = 0; ci < 2; ci++) {
      const triggerReleased = this._feedJustReleasedPerCtrl[ci];
      this._feedJustReleasedPerCtrl[ci] = false;

      const held = this._feedHeldPerCtrl[ci];
      const controller = this.controllers[ci];
      const grip = this.controllerGrips[ci];

      if (!controller) {
        results.push({ triggerHeld: false, triggerReleased: false, grip: null, throwForce: null });
        continue;
      }

      let throwForce = null;

      if (triggerReleased) {
        // Prefer XR API velocity data (available on Quest).
        // Check both grip and controller for linear velocity.
        // Reuse module-level scratch vector for throw velocity — avoids per-throw allocations
        if (grip && grip.hasLinearVelocity) {
          _throwForce.copy(grip.linearVelocity);
        } else if (controller.hasLinearVelocity) {
          _throwForce.copy(controller.linearVelocity);
        } else {
          // No XR velocity data available - use zero (floatUp will be added below)
          _throwForce.set(0, 0, 0);
        }

        // XR API velocity is in reference-space coordinates. Smooth turn
        // rotates the rig (not the reference space), so we must apply the
        // rig's rotation to get the correct world-space throw direction.
        _throwForce.applyQuaternion(this.rig.quaternion);

        // Scale down — raw XR velocity feels too hot for underwater food tossing
        _throwForce.multiplyScalar(0.4);

        _throwForce.y += this.floatUp;

        if (_throwForce.length() < 0.3) {
          _throwForce.set(0, this.floatUp, 0);
        }

        // Include angular velocity if available (spins the food on throw)
        let angularVelocity = null;
        if (grip && grip.hasAngularVelocity) {
          _controllerDir.copy(grip.angularVelocity);
          angularVelocity = _controllerDir;
        } else if (controller.hasAngularVelocity) {
          _controllerDir.copy(controller.angularVelocity);
          angularVelocity = _controllerDir;
        }
        if (angularVelocity) {
          angularVelocity.applyQuaternion(this.rig.quaternion);
        }

        // Clone here because throwForce is consumed asynchronously by the caller
        throwForce = new THREE.Vector3().copy(_throwForce);
        throwForce._angularVelocity = angularVelocity ? new THREE.Vector3().copy(angularVelocity) : null;
      }

      results.push({ triggerHeld: held, triggerReleased, grip: grip || controller, throwForce });
    }

    return results;
  }

  /**
   * Position the rig at the starting camera location.
   */
  setStartPosition(x, y, z) {
    this.rig.position.set(x, y, z);
  }

  /**
   * Fade out movement effectiveness over the given duration (seconds).
   * Used by end sequence to smoothly disable player controls.
   * @param {number} duration - fade duration in seconds (default 2)
   */
  fadeOutMovement(duration = 2) {
    const startScale = this._movementScale;
    const startTime = performance.now();
    const durationMs = duration * 1000;
    const tick = () => {
      const elapsed = performance.now() - startTime;
      const t = Math.min(elapsed / durationMs, 1);
      this._movementScale = startScale * (1 - t);
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  /**
   * Restore movement to full effectiveness.
   */
  restoreMovement() {
    this._movementScale = 1.0;
  }

  /**
   * Update the HUD with population data.
   * @param {Object} populationData - { fish, dolphin, manatee, plant, speciesSeen }
   */
  updateHud(populationData) {
    if (this.hud) {
      this.hud.update(populationData);
    }
  }

  /**
   * Show/hide the VR button (used when leaving title screen).
   */
  showButton() { if (this._vrButton) this._vrButton.style.display = ''; }
  hideButton() { if (this._vrButton) this._vrButton.style.display = 'none'; }

  /**
   * Register performance optimization targets (SceneManager and MarineSnow).
   * Called from main.js after XRManager initialization.
   */
  registerPerformanceTargets(sceneManager, marineSnow) {
    this.sceneManager = sceneManager;
    this.marineSnow = marineSnow;
    // XRManager: performance targets registered
  }

  dispose() {
    if (this._fadeMesh) {
      this._fadeMesh.geometry.dispose();
      this._fadeMesh.material.dispose();
      this.camera.remove(this._fadeMesh);
      this._fadeMesh = null;
    }
    if (this.vignette) {
      this.vignette.dispose();
      this.vignette = null;
    }
    if (this.hud) {
      this.hud.dispose();
      this.hud = null;
    }
    if (this.debugPanel) {
      this.debugPanel.dispose();
      this.debugPanel = null;
    }
    if (this.controllerHints) {
      this.controllerHints.dispose();
      this.controllerHints = null;
    }
    if (this._vrButton) {
      this._vrButton.remove();
      this._vrButton = null;
    }
    for (let i = 0; i < 2; i++) {
      if (this.controllers[i]) this.rig.remove(this.controllers[i]);
      if (this.controllerGrips[i]) this.rig.remove(this.controllerGrips[i]);
      if (this.hands[i]) this.rig.remove(this.hands[i]);
      if (this._laserDots[i]) this.scene.remove(this._laserDots[i]);
    }
    this.scene.remove(this.rig);
  }
}
