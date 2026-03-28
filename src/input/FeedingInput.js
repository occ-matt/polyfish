import * as THREE from 'three';
import { VirtualJoystick } from './VirtualJoystick.js';

/**
 * FeedingInput — hold LMB to summon food in front of camera, release to gently
 * lob it forward. Food floats upward like organic matter in the water column.
 *
 * Desktop flow:
 *   mousedown → onHold(position)   — spawn food visible in hand
 *   each frame → update()          — keep held food in front of camera
 *   mouseup   → onRelease(force)   — gentle forward + upward launch
 *
 * Mobile flow:
 *   Dedicated feed button → spawn food + auto-lob forward
 */

const _forward = new THREE.Vector3();
const _holdPos = new THREE.Vector3();
const _holdFwd = new THREE.Vector3();
const _force = new THREE.Vector3();
const _upVec = new THREE.Vector3();

export class FeedingInput {
  constructor(camera, scene) {
    this.camera = camera;
    this.scene = scene;
    this.enabled = true;
    this.holding = false;

    /** Called on mousedown with spawn position. Should return a food reference (or null). */
    this.onHold = null;
    /** Called on mouseup with launch impulse vector. */
    this.onRelease = null;

    // How far in front of the camera to hold the food
    this.holdDistance = 1.25;
    // Launch strength (gentle — 1/4 of previous 8 = 2)
    this.throwStrength = 2;
    // Upward float component
    this.floatUp = 1.5;

    this._isMobile = VirtualJoystick.isTouchDevice();

    this._onMouseDown = this._onMouseDown.bind(this);
    this._onMouseUp = this._onMouseUp.bind(this);

    this._feedButton = null;
  }

  init(canvas) {
    canvas.addEventListener('mousedown', this._onMouseDown);
    canvas.addEventListener('mouseup', this._onMouseUp);

    if (this._isMobile) {
      this._createFeedButton();
      this._initTapToFeed();
    }
  }

  /** Create a floating feed button for mobile */
  _createFeedButton() {
    const btn = document.createElement('button');
    btn.id = 'feed-btn';
    btn.textContent = '🥪';
    btn.style.cssText =
      'position:fixed;bottom:100px;left:50%;transform:translateX(-50%);z-index:9998;' +
      'width:66px;height:66px;border-radius:50%;' +
      'border:1.5px solid rgba(255,255,255,0.18);' +
      'background:radial-gradient(circle at 35% 35%, rgba(255,255,255,0.15) 0%, rgba(255,255,255,0.05) 100%);' +
      'backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);' +
      'box-shadow:inset 0 1px 1px rgba(255,255,255,0.15), 0 2px 8px rgba(0,0,0,0.12);' +
      'font-size:28px;cursor:pointer;touch-action:manipulation;' +
      'display:none;align-items:center;justify-content:center;' +
      'transition:transform 0.1s ease;' +
      '-webkit-tap-highlight-color:transparent;user-select:none;-webkit-user-select:none;' +
      'outline:none;';

    // Track touch state for hold-to-feed (mirrors desktop mousedown/mouseup)
    this._mobileTouchId = null;

    btn.addEventListener('touchstart', (e) => {
      e.stopPropagation(); // don't trigger joystick
      e.preventDefault();
      btn.style.transform = 'translateX(-50%) scale(0.9)';

      // Start holding — spawn food in front of camera
      if (this.enabled && this._mobileTouchId === null) {
        this._mobileTouchId = e.changedTouches[0].identifier;
        this.holding = true;
        const pos = this._getHoldPosition();
        if (this.onHold) this.onHold(pos);
      }
    }, { passive: false });

    btn.addEventListener('touchend', (e) => {
      e.stopPropagation();
      btn.style.transform = 'translateX(-50%) scale(1)';

      // Release — lob food forward (same as desktop mouseup)
      if (this._mobileTouchId !== null) {
        // Check the released touch matches the one that started the hold
        for (const t of e.changedTouches) {
          if (t.identifier === this._mobileTouchId) {
            this._mobileTouchId = null;
            this.holding = false;
            this._mobileRelease();
            break;
          }
        }
      }
    }, { passive: false });

    btn.addEventListener('touchcancel', (e) => {
      btn.style.transform = 'translateX(-50%) scale(1)';
      if (this._mobileTouchId !== null) {
        this._mobileTouchId = null;
        this.holding = false;
        this._mobileRelease();
      }
    }, { passive: false });

    document.body.appendChild(btn);
    this._feedButton = btn;
  }

  /**
   * Tap-to-feed: any quick tap on the screen (not on UI or during a joystick drag)
   * spawns and auto-lobs food. This makes feeding discoverable without requiring
   * the dedicated button.
   */
  _initTapToFeed() {
    const TAP_MAX_MS = 300;    // max duration to count as a tap
    const TAP_MAX_PX = 15;     // max finger movement to count as a tap
    const UI_SELECTOR = '#title-screen, #mode-selector, #dev-panel, #feed-btn, #gyro-toggle, .hud, button, a, input, select';
    const tapStarts = new Map(); // touchId → { x, y, time }

    this._tapTouchStart = (e) => {
      if (!this.enabled) return;
      if (e.target.closest(UI_SELECTOR)) return;
      for (const t of e.changedTouches) {
        tapStarts.set(t.identifier, { x: t.clientX, y: t.clientY, time: performance.now() });
      }
    };

    this._tapTouchEnd = (e) => {
      if (!this.enabled) return;
      for (const t of e.changedTouches) {
        const start = tapStarts.get(t.identifier);
        tapStarts.delete(t.identifier);
        if (!start) continue;

        const dt = performance.now() - start.time;
        const dx = t.clientX - start.x;
        const dy = t.clientY - start.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dt < TAP_MAX_MS && dist < TAP_MAX_PX) {
          // Quick tap detected — spawn + auto-lob food
          const pos = this._getHoldPosition();
          if (this.onHold) this.onHold(pos);
          // Immediate release with forward lob
          this._mobileRelease();
        }
      }
    };

    this._tapTouchCancel = (e) => {
      for (const t of e.changedTouches) tapStarts.delete(t.identifier);
    };

    document.addEventListener('touchstart', this._tapTouchStart, { passive: true });
    document.addEventListener('touchend', this._tapTouchEnd, { passive: true });
    document.addEventListener('touchcancel', this._tapTouchCancel, { passive: true });
  }

  /** Release held food with a gentle forward lob */
  _mobileRelease() {
    _forward.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
    _upVec.set(0, this.floatUp, 0);
    const force = _force.copy(_forward)
      .multiplyScalar(this.throwStrength)
      .add(_upVec);
    if (this.onRelease) this.onRelease(force);
  }

  /** Show mobile feed button */
  showMobileButton() {
    if (this._feedButton) this._feedButton.style.display = 'flex';
  }

  /** Hide mobile feed button */
  hideMobileButton() {
    if (this._feedButton) this._feedButton.style.display = 'none';
  }

  /** Returns the position in front of the camera (reuses temp vector — use immediately). */
  _getHoldPosition() {
    _holdFwd.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
    return _holdPos.copy(this.camera.position)
      .addScaledVector(_holdFwd, this.holdDistance);
  }

  _onMouseDown(event) {
    if (!this.enabled) return;
    // Don't interfere with right-click or middle-click
    if (event.button && event.button !== 0) return;
    // Only feed when pointer is locked (FPS mode active)
    if (!document.pointerLockElement) return;

    this.holding = true;
    const pos = this._getHoldPosition();
    if (this.onHold) {
      this.onHold(pos);
    }
  }

  _onMouseUp(event) {
    if (!this.enabled || !this.holding) return;
    if (event.button && event.button !== 0) return;

    this.holding = false;

    // Launch direction: gently forward + upward float
    _forward.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
    _upVec.set(0, this.floatUp, 0);
    const force = _force.copy(_forward)
      .multiplyScalar(this.throwStrength)
      .add(_upVec);

    if (this.onRelease) {
      this.onRelease(force);
    }
  }

  /**
   * Call every frame. While holding, smoothly tracks food to the hold position.
   * @param {THREE.Object3D|null} heldFood — the food entity being held (needs .body.position)
   * @param {number} dt — delta time for smooth interpolation
   */
  updateHeld(heldFood, dt) {
    if (!this.holding || !heldFood) return;
    const target = this._getHoldPosition();
    // Smooth follow — lerp toward target position
    const lerpFactor = 1 - Math.exp(-12 * (dt || 0.016));
    heldFood.body.position.lerp(target, lerpFactor);
    heldFood.body.velocity.set(0, 0, 0); // no drift while held
    heldFood.mesh.position.copy(heldFood.body.position);
  }

  dispose(canvas) {
    canvas.removeEventListener('mousedown', this._onMouseDown);
    canvas.removeEventListener('mouseup', this._onMouseUp);
    if (this._tapTouchStart) {
      document.removeEventListener('touchstart', this._tapTouchStart);
      document.removeEventListener('touchend', this._tapTouchEnd);
      document.removeEventListener('touchcancel', this._tapTouchCancel);
    }
    if (this._feedButton) {
      this._feedButton.remove();
      this._feedButton = null;
    }
  }
}
