/**
 * VirtualJoystick — touch-based dual joystick overlay for mobile.
 *
 * Creates two translucent circular joysticks:
 *   LEFT  — movement (forward/back/strafe)
 *   RIGHT — camera look (yaw/pitch)
 *
 * Glass-style idle indicators sit in the lower corners so players know
 * the controls exist. On touch, the active joystick appears at the finger
 * position and the idle ghost fades out. Returns normalized X/Y values
 * (-1 to 1) for each stick.
 */

export class VirtualJoystick {
  constructor() {
    /** @type {{ x: number, y: number }} Normalized left stick output */
    this.moveAxis = { x: 0, y: 0 };
    /** @type {{ x: number, y: number }} Right stick delta (pixels since last read) */
    this.lookDelta = { x: 0, y: 0 };

    this._sticks = { left: null, right: null };
    this._container = null;
    this._active = false;

    // Joystick visual config
    this._baseRadius = 50;  // outer ring radius
    this._knobRadius = 22;  // inner knob radius
    this._maxDrag = 40;     // max distance knob can travel from center
  }

  /** Detect if we're on a touch device */
  static isTouchDevice() {
    return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  }

  /** Create DOM elements and attach touch listeners */
  init() {
    if (!VirtualJoystick.isTouchDevice()) return;
    this._active = true;

    // Inject CSS for glass effect + animations
    this._injectStyles();

    // Container covers full screen, passes non-joystick taps through
    this._container = document.createElement('div');
    this._container.id = 'joystick-container';
    this._container.style.cssText =
      'position:fixed;inset:0;z-index:9998;pointer-events:none;touch-action:none;';
    document.body.appendChild(this._container);

    // Create left and right joystick zones
    this._createZone('left');
    this._createZone('right');

    // Touch event handlers on the whole document
    this._onTouchStart = this._onTouchStart.bind(this);
    this._onTouchMove = this._onTouchMove.bind(this);
    this._onTouchEnd = this._onTouchEnd.bind(this);

    document.addEventListener('touchstart', this._onTouchStart, { passive: false });
    document.addEventListener('touchmove', this._onTouchMove, { passive: false });
    document.addEventListener('touchend', this._onTouchEnd, { passive: false });
    document.addEventListener('touchcancel', this._onTouchEnd, { passive: false });
  }

  get active() { return this._active; }

  _injectStyles() {
    if (document.getElementById('joystick-styles')) return;
    const style = document.createElement('style');
    style.id = 'joystick-styles';
    style.textContent = `
      .joystick-ghost {
        position: fixed;
        bottom: 60px;
        width: 90px;
        height: 90px;
        border-radius: 50%;
        pointer-events: none;
        transition: opacity 0.25s ease;
        /* Glass effect */
        background: radial-gradient(
          circle at 35% 35%,
          rgba(255, 255, 255, 0.15) 0%,
          rgba(255, 255, 255, 0.05) 50%,
          rgba(255, 255, 255, 0.02) 100%
        );
        border: 1.5px solid rgba(255, 255, 255, 0.18);
        box-shadow:
          inset 0 1px 1px rgba(255, 255, 255, 0.15),
          0 2px 8px rgba(0, 0, 0, 0.12);
        backdrop-filter: blur(4px);
        -webkit-backdrop-filter: blur(4px);
      }
      .joystick-ghost-left {
        left: 40px;
      }
      .joystick-ghost-right {
        right: 40px;
      }
      .joystick-ghost-knob {
        position: absolute;
        top: 50%;
        left: 50%;
        width: 36px;
        height: 36px;
        border-radius: 50%;
        transform: translate(-50%, -50%);
        background: radial-gradient(
          circle at 40% 40%,
          rgba(255, 255, 255, 0.22) 0%,
          rgba(255, 255, 255, 0.08) 100%
        );
        border: 1px solid rgba(255, 255, 255, 0.2);
        box-shadow: inset 0 1px 2px rgba(255, 255, 255, 0.12);
      }
      .joystick-ghost-label {
        position: absolute;
        bottom: -20px;
        left: 50%;
        transform: translateX(-50%);
        font: 10px/1 system-ui, sans-serif;
        color: rgba(255, 255, 255, 0.35);
        white-space: nowrap;
        letter-spacing: 0.5px;
        text-transform: uppercase;
      }
      .joystick-ghost.hidden {
        opacity: 0;
      }
    `;
    document.head.appendChild(style);
  }

  _createZone(side) {
    // Invisible zone covering left or right half of screen
    const zone = document.createElement('div');
    zone.style.cssText =
      `position:fixed;top:0;${side}:0;width:50%;height:100%;pointer-events:auto;touch-action:none;`;
    this._container.appendChild(zone);

    // Active base ring (hidden until touch)
    const base = document.createElement('div');
    base.style.cssText =
      `position:fixed;width:${this._baseRadius * 2}px;height:${this._baseRadius * 2}px;` +
      `border-radius:50%;border:1.5px solid rgba(255,255,255,0.25);` +
      `background:radial-gradient(circle at 35% 35%, rgba(255,255,255,0.12) 0%, rgba(255,255,255,0.03) 100%);` +
      `backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);` +
      `box-shadow:inset 0 1px 1px rgba(255,255,255,0.1), 0 2px 8px rgba(0,0,0,0.1);` +
      `display:none;pointer-events:none;transform:translate(-50%,-50%);` +
      `transition:opacity 0.15s ease;`;

    // Active knob
    const knob = document.createElement('div');
    knob.style.cssText =
      `position:fixed;width:${this._knobRadius * 2}px;height:${this._knobRadius * 2}px;` +
      `border-radius:50%;` +
      `background:radial-gradient(circle at 40% 40%, rgba(255,255,255,0.35) 0%, rgba(255,255,255,0.12) 100%);` +
      `border:1px solid rgba(255,255,255,0.3);` +
      `box-shadow:inset 0 1px 2px rgba(255,255,255,0.15), 0 1px 4px rgba(0,0,0,0.1);` +
      `display:none;pointer-events:none;transform:translate(-50%,-50%);` +
      `transition:opacity 0.15s ease;`;

    this._container.appendChild(base);
    this._container.appendChild(knob);

    // Ghost idle indicator — always visible in the corner
    const ghost = document.createElement('div');
    ghost.className = `joystick-ghost joystick-ghost-${side}`;

    const ghostKnob = document.createElement('div');
    ghostKnob.className = 'joystick-ghost-knob';
    ghost.appendChild(ghostKnob);

    const label = document.createElement('div');
    label.className = 'joystick-ghost-label';
    label.textContent = side === 'left' ? 'move' : 'look';
    ghost.appendChild(label);

    this._container.appendChild(ghost);

    this._sticks[side] = {
      zone,
      base,
      knob,
      ghost,
      touchId: null,
      originX: 0,
      originY: 0,
      currentX: 0,
      currentY: 0,
    };
  }

  _onTouchStart(e) {
    // Don't intercept touches on UI elements (buttons, HUD, etc.)
    if (e.target.closest('#title-screen, #mode-selector, #dev-panel, #feed-btn, #gyro-toggle, .hud, button, a, input, select')) return;

    for (const touch of e.changedTouches) {
      const side = touch.clientX < window.innerWidth / 2 ? 'left' : 'right';
      const stick = this._sticks[side];

      // Only one finger per stick
      if (stick.touchId !== null) continue;

      stick.touchId = touch.identifier;
      stick.originX = touch.clientX;
      stick.originY = touch.clientY;
      stick.currentX = touch.clientX;
      stick.currentY = touch.clientY;

      // Show active joystick at touch origin, hide ghost
      stick.base.style.display = 'block';
      stick.base.style.left = touch.clientX + 'px';
      stick.base.style.top = touch.clientY + 'px';
      stick.knob.style.display = 'block';
      stick.knob.style.left = touch.clientX + 'px';
      stick.knob.style.top = touch.clientY + 'px';
      stick.ghost.classList.add('hidden');

      e.preventDefault();
    }
  }

  _onTouchMove(e) {
    for (const touch of e.changedTouches) {
      for (const side of ['left', 'right']) {
        const stick = this._sticks[side];
        if (stick.touchId !== touch.identifier) continue;

        const dx = touch.clientX - stick.originX;
        const dy = touch.clientY - stick.originY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const clamped = Math.min(dist, this._maxDrag);
        const angle = Math.atan2(dy, dx);

        const knobX = stick.originX + Math.cos(angle) * clamped;
        const knobY = stick.originY + Math.sin(angle) * clamped;

        stick.knob.style.left = knobX + 'px';
        stick.knob.style.top = knobY + 'px';

        if (side === 'left') {
          // Normalize to -1..1
          this.moveAxis.x = (Math.cos(angle) * clamped) / this._maxDrag;
          this.moveAxis.y = (Math.sin(angle) * clamped) / this._maxDrag;
        } else {
          // Right stick: accumulate delta for look
          this.lookDelta.x += touch.clientX - stick.currentX;
          this.lookDelta.y += touch.clientY - stick.currentY;
        }

        stick.currentX = touch.clientX;
        stick.currentY = touch.clientY;

        e.preventDefault();
      }
    }
  }

  _onTouchEnd(e) {
    for (const touch of e.changedTouches) {
      for (const side of ['left', 'right']) {
        const stick = this._sticks[side];
        if (stick.touchId !== touch.identifier) continue;

        stick.touchId = null;
        stick.base.style.display = 'none';
        stick.knob.style.display = 'none';
        // Fade ghost back in
        stick.ghost.classList.remove('hidden');

        if (side === 'left') {
          this.moveAxis.x = 0;
          this.moveAxis.y = 0;
        }
      }
    }
  }

  /** Read and reset the look delta (call once per frame) */
  consumeLookDelta() {
    const dx = this.lookDelta.x;
    const dy = this.lookDelta.y;
    this.lookDelta.x = 0;
    this.lookDelta.y = 0;
    return { x: dx, y: dy };
  }

  /** Hide joysticks (e.g. during title screen) */
  hide() {
    if (this._container) this._container.style.display = 'none';
  }

  /** Show joysticks */
  show() {
    if (this._container) this._container.style.display = '';
  }

  dispose() {
    if (!this._active) return;
    document.removeEventListener('touchstart', this._onTouchStart);
    document.removeEventListener('touchmove', this._onTouchMove);
    document.removeEventListener('touchend', this._onTouchEnd);
    document.removeEventListener('touchcancel', this._onTouchEnd);
    if (this._container) this._container.remove();
    const style = document.getElementById('joystick-styles');
    if (style) style.remove();
  }
}
