/**
 * VRControllerHints - Floating glass-panel tutorial hints on VR controllers.
 *
 * Shows labeled hints pointing to each controller button/input. Each hint
 * is a semi-transparent glass panel with text and a thin line connecting
 * it to the relevant button location. Hints fade out once the player
 * performs the associated action.
 *
 * Hints:
 *   Left controller:  "Move" (thumbstick), "Feed" (trigger)
 *   Right controller: "Turn" (thumbstick), "Feed" (trigger)
 *
 * All geometry is attached to the controller grip space (where the visual
 * model lives) so it tracks the controller position and rotation.
 */
import * as THREE from 'three';

const _camWorldPos = new THREE.Vector3();
const _panelWorldPos = new THREE.Vector3();

// ── Hint definitions ────────────────────────────────────────────────
// Positions are in grip-space coordinates.
// Quest 3 Touch Plus grip space: origin at center of handle grip,
// +Y is up along the controller body, -Z is forward (toward buttons/stick).
// Physical measurements from Quest 3 Touch Plus controller:
//   thumbstick: ~4.5cm above grip, ~3cm forward of grip origin
//   trigger:    ~1.5cm below grip, ~4cm forward

const HINT_DEFS = {
  leftMove: {
    label: 'Move',
    sublabel: 'Left Stick',
    hand: 'left',
    // Quest 3 thumbstick: above grip origin, forward (negative Z)
    buttonPos: new THREE.Vector3(0, 0.045, -0.03),
    panelOffset: new THREE.Vector3(-0.08, 0.04, -0.01),
    action: 'move',
  },
  leftFeed: {
    label: 'Feed',
    sublabel: 'Trigger',
    hand: 'left',
    // Trigger is below and forward of grip origin
    buttonPos: new THREE.Vector3(0, -0.015, -0.04),
    panelOffset: new THREE.Vector3(-0.08, -0.04, -0.03),
    action: 'feed',
  },
  rightTurn: {
    label: 'Turn',
    sublabel: 'Right Stick',
    hand: 'right',
    // Quest 3 thumbstick: same layout as left
    buttonPos: new THREE.Vector3(0, 0.045, -0.03),
    panelOffset: new THREE.Vector3(0.08, 0.04, -0.01),
    action: 'turn',
  },
  rightFeed: {
    label: 'Feed',
    sublabel: 'Trigger',
    hand: 'right',
    buttonPos: new THREE.Vector3(0, -0.015, -0.04),
    panelOffset: new THREE.Vector3(0.08, -0.04, -0.03),
    action: 'feed',
  },
};

const FADE_DURATION = 1.5; // seconds to fade out after action used

export class VRControllerHints {
  constructor() {
    // Map of hintKey -> { group, panel, line, state, opacity }
    this._hints = new Map();
    // Track which actions have been completed
    this._completed = new Set();
    // Parent grips by handedness
    this._grips = { left: null, right: null };
    this._handedness = {}; // controllerIndex -> handedness
  }

  /**
   * Attach hints to controller grips once we know handedness.
   * @param {number} controllerIndex
   * @param {string} handedness - 'left' or 'right'
   * @param {THREE.Group} grip - the controller grip space
   */
  attachToController(controllerIndex, handedness, grip) {
    if (handedness !== 'left' && handedness !== 'right') return;

    this._grips[handedness] = grip;
    this._handedness[controllerIndex] = handedness;

    // Create hints for this hand
    for (const [key, def] of Object.entries(HINT_DEFS)) {
      if (def.hand !== handedness) continue;
      if (this._hints.has(key)) continue; // already created
      if (this._completed.has(def.action)) continue; // already done

      const hint = this._createHint(def);
      grip.add(hint.group);
      this._hints.set(key, hint);
    }
  }

  /**
   * Detach hints from a controller (on disconnect).
   */
  detachController(controllerIndex) {
    const hand = this._handedness[controllerIndex];
    if (!hand) return;

    for (const [key, hint] of this._hints.entries()) {
      const def = HINT_DEFS[key];
      if (def.hand === hand) {
        hint.group.parent?.remove(hint.group);
        this._disposeHint(hint);
        this._hints.delete(key);
      }
    }
    this._grips[hand] = null;
    delete this._handedness[controllerIndex];
  }

  /**
   * Mark an action as completed - triggers fade out on matching hints.
   * @param {'move'|'turn'|'feed'} action
   */
  markCompleted(action) {
    if (this._completed.has(action)) return;
    this._completed.add(action);

    // Start fading all hints for this action
    for (const [key, hint] of this._hints.entries()) {
      const def = HINT_DEFS[key];
      if (def.action === action && hint.state === 'visible') {
        hint.state = 'fading';
        hint.fadeTimer = 0;
      }
    }
  }

  /**
   * Call every frame to update fade animations and billboard panels toward camera.
   * @param {number} dt - delta time in seconds
   * @param {THREE.Camera} [camera] - XR camera for billboard orientation
   */
  update(dt, camera) {
    for (const [key, hint] of this._hints.entries()) {
      if (hint.state === 'fading') {
        hint.fadeTimer += dt;
        const t = Math.min(hint.fadeTimer / FADE_DURATION, 1);
        const opacity = 1 - t;
        this._setHintOpacity(hint, opacity);
        if (t >= 1) {
          hint.state = 'hidden';
          hint.group.visible = false;
        }
      }

      // Billboard panel toward camera (same technique as VRHud)
      if (camera && hint.state !== 'hidden' && hint.panel.visible) {
        hint.panel.getWorldPosition(_panelWorldPos);
        camera.getWorldPosition(_camWorldPos);
        hint.panel.lookAt(_camWorldPos);
      }
    }
  }

  /**
   * Check if all hints have been dismissed.
   */
  get allCompleted() {
    return this._completed.has('move') &&
           this._completed.has('turn') &&
           this._completed.has('feed');
  }

  // ── Internal ──────────────────────────────────────────────────────

  _createHint(def) {
    const group = new THREE.Group();
    group.name = `hint-${def.label}-${def.hand}`;

    // ── Glass panel ──
    const panelW = 0.055;
    const panelH = 0.03;
    const panelGeo = new THREE.PlaneGeometry(panelW, panelH);

    // Create canvas texture for text
    const canvas = document.createElement('canvas');
    canvas.width = 220;
    canvas.height = 120;
    const ctx = canvas.getContext('2d');

    // Glass background
    ctx.fillStyle = 'rgba(20, 40, 70, 0.7)';
    this._roundRect(ctx, 0, 0, canvas.width, canvas.height, 16);
    ctx.fill();

    // Border
    ctx.strokeStyle = 'rgba(120, 180, 255, 0.6)';
    ctx.lineWidth = 3;
    this._roundRect(ctx, 2, 2, canvas.width - 4, canvas.height - 4, 14);
    ctx.stroke();

    // Label text
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 42px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(def.label, canvas.width / 2, canvas.height * 0.38);

    // Sublabel
    ctx.fillStyle = 'rgba(160, 200, 255, 0.85)';
    ctx.font = '26px sans-serif';
    ctx.fillText(def.sublabel, canvas.width / 2, canvas.height * 0.72);

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;

    const panelMat = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      opacity: 1.0,
      depthTest: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    const panel = new THREE.Mesh(panelGeo, panelMat);
    const panelPos = def.buttonPos.clone().add(def.panelOffset);
    panel.position.copy(panelPos);
    // Billboard orientation is applied each frame in update() via lookAt,
    // matching the VRHud dive-watch pattern. No static rotation needed.
    group.add(panel);

    // ── Pointer line from panel to button ──
    const linePoints = [
      def.buttonPos.clone(),
      panelPos.clone(),
    ];
    const lineGeo = new THREE.BufferGeometry().setFromPoints(linePoints);
    const lineMat = new THREE.LineBasicMaterial({
      color: 0x88bbff,
      transparent: true,
      opacity: 0.7,
      depthTest: true,
      depthWrite: false,
    });
    const line = new THREE.Line(lineGeo, lineMat);
    group.add(line);

    // ── Small dot at the button location ──
    const dotGeo = new THREE.SphereGeometry(0.003, 8, 8);
    const dotMat = new THREE.MeshBasicMaterial({
      color: 0x88bbff,
      transparent: true,
      opacity: 0.9,
      depthTest: true,
      depthWrite: false,
    });
    const dot = new THREE.Mesh(dotGeo, dotMat);
    dot.position.copy(def.buttonPos);
    group.add(dot);

    return {
      group,
      panel,
      panelMat,
      line,
      lineMat,
      dot,
      dotMat,
      texture,
      canvas,
      state: 'visible', // 'visible' | 'fading' | 'hidden'
      fadeTimer: 0,
      opacity: 1,
    };
  }

  _setHintOpacity(hint, opacity) {
    hint.opacity = opacity;
    hint.panelMat.opacity = opacity;
    hint.lineMat.opacity = opacity * 0.7;
    hint.dotMat.opacity = opacity * 0.9;
  }

  _roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  _disposeHint(hint) {
    hint.panel.geometry.dispose();
    hint.panelMat.dispose();
    hint.texture.dispose();
    hint.line.geometry.dispose();
    hint.lineMat.dispose();
    hint.dot.geometry.dispose();
    hint.dotMat.dispose();
  }

  dispose() {
    for (const [key, hint] of this._hints.entries()) {
      hint.group.parent?.remove(hint.group);
      this._disposeHint(hint);
    }
    this._hints.clear();
  }
}
