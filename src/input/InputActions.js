import * as THREE from 'three';

/**
 * InputActions — unified input abstraction layer for PolyFish.
 *
 * Provides a single normalized API that works across all input modes:
 *   - Keyboard/Mouse (desktop FPS)
 *   - Touch/Gyro (mobile)
 *   - XR Controllers (VR handset sticks + triggers)
 *   - XR Hand Tracking (future: gesture-based input)
 *
 * Normalized actions are frame-delta aware and automatically reset after each update().
 * This allows main.js to read a unified set of getters without knowing about the
 * underlying input devices.
 */

export class InputActions {
  constructor() {
    // Aggregated state from all active input providers
    this._move = new THREE.Vector3();           // { x, y, z } normalized -1 to 1
    this._look = { yaw: 0, pitch: 0 };          // radians/frame
    this._feedStart = false;                    // true on frame feeding starts
    this._feedHeld = false;                     // true while feeding is held
    this._feedEnd = false;                      // true on frame feeding ends
    this._feedPosition = new THREE.Vector3();   // where to place held food
    this._feedThrowForce = new THREE.Vector3(); // force to apply on release
    this._snapTurn = 0;                         // -1, 0, or 1 (left, none, right)
    this._toggleCinematic = false;              // true on frame when toggled

    // Input provider references
    this._cameraController = null;
    this._joystick = null;
    this._feedingInput = null;
    this._xrManager = null;

    // Frame-local state tracking (reset each update)
    this._lastFeedHeld = false;
    this._lastSnapTurn = 0;
    this._lastToggleCinematic = false;
  }

  // ─────────────────────────────────────────────────────────────────
  // PUBLIC GETTERS — Query current input state
  // ─────────────────────────────────────────────────────────────────

  /**
   * Movement vector (normalized -1 to 1).
   * x: strafe (left/right)
   * y: vertical (up/down)
   * z: forward (forward/back, negative = forward)
   * @returns {THREE.Vector3}
   */
  get move() {
    return this._move;
  }

  /**
   * Look input (radians per frame).
   * yaw: rotation around Y axis (horizontal look)
   * pitch: rotation around X axis (vertical look)
   * @returns {{ yaw: number, pitch: number }}
   */
  get look() {
    return this._look;
  }

  /**
   * True only on the frame feeding starts (mousedown or mobile feed button press).
   * Use to spawn food entity.
   * @returns {boolean}
   */
  get feedStart() {
    return this._feedStart;
  }

  /**
   * True while feeding is held down (mousedown pressed, not released).
   * Use to keep food in front of camera each frame.
   * @returns {boolean}
   */
  get feedHeld() {
    return this._feedHeld;
  }

  /**
   * True only on the frame feeding ends (mouseup or mobile feed button release).
   * Use to apply throw force and release food.
   * @returns {boolean}
   */
  get feedEnd() {
    return this._feedEnd;
  }

  /**
   * Position in world space where held food should be placed.
   * Only valid when feedHeld is true.
   * @returns {THREE.Vector3}
   */
  get feedPosition() {
    return this._feedPosition;
  }

  /**
   * Force vector to apply to food on release.
   * Only valid when feedEnd is true.
   * @returns {THREE.Vector3}
   */
  get feedThrowForce() {
    return this._feedThrowForce;
  }

  /**
   * Snap turn input for VR (-1 left, 0 none, 1 right).
   * True on the frame the snap turn occurs.
   * @returns {number}
   */
  get snapTurn() {
    return this._snapTurn;
  }

  /**
   * True only on the frame cinematic mode is toggled.
   * Use to switch between FPS and screensaver modes.
   * @returns {boolean}
   */
  get toggleCinematic() {
    return this._toggleCinematic;
  }

  // ─────────────────────────────────────────────────────────────────
  // REGISTRATION METHODS — Connect input providers
  // ─────────────────────────────────────────────────────────────────

  /**
   * Register the keyboard/mouse camera controller.
   * @param {CameraController} cameraController
   */
  registerKeyboardMouse(cameraController) {
    this._cameraController = cameraController;
  }

  /**
   * Register mobile touch inputs (virtual joystick + feeding button).
   * @param {VirtualJoystick} joystick
   * @param {FeedingInput} feedingInput
   */
  registerTouch(joystick, feedingInput) {
    this._joystick = joystick;
    this._feedingInput = feedingInput;
  }

  /**
   * Register WebXR manager (VR controllers + hand tracking).
   * @param {XRManager} xrManager
   */
  registerXR(xrManager) {
    this._xrManager = xrManager;
  }

  // ─────────────────────────────────────────────────────────────────
  // UPDATE — Call once per frame to aggregate all input
  // ─────────────────────────────────────────────────────────────────

  /**
   * Update input state by aggregating all registered input providers.
   * Call once per frame in the game loop.
   * @param {number} dt — delta time in seconds
   */
  update(dt) {
    // Reset frame-local state (edge-triggered flags)
    this._feedStart = false;
    this._feedEnd = false;
    this._toggleCinematic = false;
    this._snapTurn = 0;

    // Reset continuous state
    this._move.set(0, 0, 0);
    this._look.yaw = 0;
    this._look.pitch = 0;

    // ────────────────────────────────────────────────────────
    // Aggregate keyboard/mouse input
    // ────────────────────────────────────────────────────────
    if (this._cameraController) {
      this._updateFromKeyboardMouse(dt);
    }

    // ────────────────────────────────────────────────────────
    // Aggregate touch input (mobile joystick + feed button)
    // ────────────────────────────────────────────────────────
    if (this._joystick || this._feedingInput) {
      this._updateFromTouch(dt);
    }

    // ────────────────────────────────────────────────────────
    // Aggregate XR input (controllers + hand tracking)
    // ────────────────────────────────────────────────────────
    if (this._xrManager) {
      this._updateFromXR(dt);
    }

    // Track state changes for edge detection next frame
    this._lastFeedHeld = this._feedHeld;
    this._lastSnapTurn = this._snapTurn;
  }

  // ─────────────────────────────────────────────────────────────────
  // INTERNAL — Aggregation logic per input mode
  // ─────────────────────────────────────────────────────────────────

  /**
   * Gather input from keyboard and mouse (CameraController).
   * @private
   */
  _updateFromKeyboardMouse(dt) {
    const cam = this._cameraController;

    // Movement from keyboard (WASD)
    // CameraController.keys = { 'w': bool, 'a': bool, 's': bool, 'd': bool, ... }
    const moveForward = cam.keys['w'] || cam.keys['W'] ? -1 : 0;
    const moveBack = cam.keys['s'] || cam.keys['S'] ? 1 : 0;
    const moveLeft = cam.keys['a'] || cam.keys['A'] ? -1 : 0;
    const moveRight = cam.keys['d'] || cam.keys['D'] ? 1 : 0;
    const moveUp = cam.keys[' '] ? 1 : 0;
    const moveDown = cam.keys['c'] || cam.keys['C'] ? -1 : 0;

    this._move.x = moveLeft + moveRight;
    this._move.y = moveUp + moveDown;
    this._move.z = moveForward + moveBack;

    // Clamp to -1..1
    const moveLen = Math.sqrt(
      this._move.x * this._move.x +
      this._move.y * this._move.y +
      this._move.z * this._move.z
    );
    if (moveLen > 1) {
      this._move.multiplyScalar(1 / moveLen);
    }

    // Look from mouse (when pointer locked)
    // CameraController stores target yaw/pitch and applies smoothing each frame
    if (cam.pointerLocked || document.pointerLockElement) {
      this._look.yaw = cam._targetYaw - this._lastYaw ?? 0;
      this._look.pitch = cam._targetPitch - this._lastPitch ?? 0;
      this._lastYaw = cam._targetYaw;
      this._lastPitch = cam._targetPitch;
    }

    // Cinematic toggle (Tab key)
    if (cam.keys['Tab'] && !this._lastToggleCinematic) {
      this._toggleCinematic = true;
    }
    this._lastToggleCinematic = !!cam.keys['Tab'];

    // Feeding input (desktop mouse)
    if (this._feedingInput) {
      const wasFeedingHeld = this._feedHeld;
      this._feedHeld = this._feedingInput.holding;

      if (this._feedHeld && !wasFeedingHeld) {
        this._feedStart = true;
      } else if (!this._feedHeld && wasFeedingHeld) {
        this._feedEnd = true;
      }

      // Update hold position while feeding
      if (this._feedHeld && this._feedingInput.holding) {
        const holdPos = this._feedingInput._getHoldPosition();
        if (holdPos) {
          this._feedPosition.copy(holdPos);
        }
      }
    }
  }

  /**
   * Gather input from touch (virtual joystick + mobile feed button).
   * @private
   */
  _updateFromTouch(dt) {
    // Movement from left virtual joystick
    if (this._joystick && this._joystick.active) {
      const moveAxis = this._joystick.moveAxis;
      this._move.x = moveAxis.x;
      this._move.z = moveAxis.y; // joystick Y is forward/back
      this._move.y = 0;

      // Look from right virtual joystick (delta accumulated each frame)
      const lookDelta = this._joystick.consumeLookDelta();
      // Convert pixel delta to radians (tuned sensitivity)
      const lookSensitivity = 0.004; // pixels to radians
      this._look.yaw = lookDelta.x * lookSensitivity;
      this._look.pitch = lookDelta.y * lookSensitivity;
    }

    // Feeding input (mobile feed button)
    if (this._feedingInput) {
      const wasFeedingHeld = this._feedHeld;
      this._feedHeld = this._feedingInput.holding;

      if (this._feedHeld && !wasFeedingHeld) {
        this._feedStart = true;
      } else if (!this._feedHeld && wasFeedingHeld) {
        this._feedEnd = true;
      }

      // Update hold position while feeding
      if (this._feedHeld && this._feedingInput.holding) {
        const holdPos = this._feedingInput._getHoldPosition();
        if (holdPos) {
          this._feedPosition.copy(holdPos);
        }
      }
    }
  }

  /**
   * Gather input from XR (controllers + hand tracking).
   * @private
   */
  _updateFromXR(dt) {
    const xr = this._xrManager;

    if (!xr.active) return;

    // Movement from left thumbstick (locomotion)
    const session = this.renderer?.xr?.getSession?.();
    if (session) {
      const inputSources = session.inputSources;
      let moveX = 0, moveY = 0;

      for (const source of inputSources) {
        if (!source.gamepad || source.handedness !== 'left') continue;
        const axes = source.gamepad.axes;
        // Typical layout: [LX, LY, RX, RY]
        moveX = Math.abs(axes[0]) > 0.15 ? axes[0] : 0;
        moveY = Math.abs(axes[1]) > 0.15 ? axes[1] : 0;
      }

      this._move.x = moveX;
      this._move.z = -moveY; // negative Y is forward
      this._move.y = 0;
    }

    // Snap turn from right thumbstick
    let turnX = 0;
    if (session) {
      for (const source of session.inputSources) {
        if (!source.gamepad || source.handedness !== 'right') continue;
        const axes = source.gamepad.axes;
        turnX = Math.abs(axes[0]) > 0.15 ? axes[0] : 0;
      }
    }

    const wasSnapping = this._lastSnapTurn !== 0;
    if (Math.abs(turnX) > 0.6 && !wasSnapping) {
      this._snapTurn = turnX > 0 ? -1 : 1;
    }
    this._lastSnapTurn = this._snapTurn;

    // Feeding input from trigger
    const feedResult = xr._updateFeeding?.(dt, this._feedingInput, null);
    if (feedResult) {
      const wasFeedingHeld = this._feedHeld;
      this._feedHeld = feedResult.triggerHeld;

      if (this._feedHeld && !wasFeedingHeld) {
        this._feedStart = true;
      } else if (!this._feedHeld && wasFeedingHeld) {
        this._feedEnd = true;
      }

      if (feedResult.holdPosition) {
        this._feedPosition.copy(feedResult.holdPosition);
      }

      if (feedResult.throwForce) {
        this._feedThrowForce.copy(feedResult.throwForce);
      }
    }
  }
}
