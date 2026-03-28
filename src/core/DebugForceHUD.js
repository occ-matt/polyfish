/**
 * DebugForceHUD — camera-attached indicator showing global forces.
 *
 * A small 3D widget parented to the camera so it stays in view like a HUD.
 * Currently shows:
 *   • Ocean current (cyan arrow) — sampled at mid-water-column height
 *   • Buoyancy (green arrow) — constant upward
 *
 * Toggle visibility via debugColliders (backtick key).
 */
import * as THREE from 'three';

// Reusable vectors
const _dir = new THREE.Vector3();

export class DebugForceHUD {
  /**
   * @param {THREE.Camera} camera — the player camera to parent the HUD to
   */
  constructor(camera) {
    this.camera = camera;
    this.visible = false;

    // Container group — lives in camera-local space
    this.group = new THREE.Group();
    // Position in bottom-left of view (camera-local coords)
    // Negative X = left, negative Y = down, negative Z = in front of camera
    this.group.position.set(-0.55, -0.35, -1.2);
    this.camera.add(this.group);

    // ── Background disc for contrast ──
    const discGeo = new THREE.CircleGeometry(0.12, 32);
    const discMat = new THREE.MeshBasicMaterial({
      color: 0x000000, transparent: true, opacity: 0.35,
      side: THREE.DoubleSide, depthTest: false,
    });
    this.disc = new THREE.Mesh(discGeo, discMat);
    this.disc.renderOrder = 998;
    this.group.add(this.disc);

    // ── Current arrow (cyan) ──
    this.currentArrow = this._makeArrow(0x00ffff, 'Current');
    this.group.add(this.currentArrow);

    // ── Buoyancy arrow (green) — always points up ──
    this.buoyancyArrow = this._makeArrow(0x44ff44, 'Buoyancy');
    this.group.add(this.buoyancyArrow);

    // ── Labels ──
    this.labels = this._makeLabels();
    this.group.add(this.labels);

    this.group.visible = false;

    // Current params (mirror VerletChain defaults / config)
    this.currentAmplitude = 0.7;  // matches Plant.js ampVar midpoint
    this.currentSpeed = 0.15;     // base speed (matches VerletChain default)
    this.currentDirection = 0.6;  // dominant flow angle (radians)
    this.currentDirectionBias = 0.7;
    this.buoyancy = 0.4;          // reference buoyancy
  }

  /**
   * Create a cone+line arrow.
   */
  _makeArrow(color, _name) {
    const group = new THREE.Group();

    // Shaft — thin cylinder
    const shaftGeo = new THREE.CylinderGeometry(0.003, 0.003, 1, 4);
    shaftGeo.translate(0, 0.5, 0); // pivot at base
    const shaftMat = new THREE.MeshBasicMaterial({
      color, depthTest: false, transparent: true, opacity: 0.9,
    });
    const shaft = new THREE.Mesh(shaftGeo, shaftMat);
    group.add(shaft);
    group._shaft = shaft;

    // Head — small cone
    const headGeo = new THREE.ConeGeometry(0.012, 0.03, 6);
    const headMat = new THREE.MeshBasicMaterial({
      color, depthTest: false, transparent: true, opacity: 0.9,
    });
    const head = new THREE.Mesh(headGeo, headMat);
    head.position.y = 1.0;
    group.add(head);
    group._head = head;

    group.renderOrder = 999;
    return group;
  }

  /**
   * Tiny text labels using sprites.
   */
  _makeLabels() {
    const group = new THREE.Group();

    // Create label sprites
    const makeLabel = (text, color, offsetY) => {
      const canvas = document.createElement('canvas');
      canvas.width = 128;
      canvas.height = 32;
      const ctx = canvas.getContext('2d');
      ctx.font = 'bold 18px monospace';
      ctx.fillStyle = color;
      ctx.textAlign = 'left';
      ctx.fillText(text, 2, 22);

      const tex = new THREE.CanvasTexture(canvas);
      tex.minFilter = THREE.LinearFilter;
      const mat = new THREE.SpriteMaterial({
        map: tex, depthTest: false, transparent: true,
      });
      const sprite = new THREE.Sprite(mat);
      sprite.scale.set(0.12, 0.03, 1);
      sprite.position.set(0.14, offsetY, 0);
      sprite.renderOrder = 999;
      return sprite;
    };

    group.add(makeLabel('CURRENT', '#00ffff', 0.04));
    group.add(makeLabel('BUOYANCY', '#44ff44', -0.02));
    group.add(makeLabel('FORCES', '#ffffff', 0.10));

    return group;
  }

  /**
   * Toggle visibility (called from debug toggle).
   */
  setVisible(v) {
    this.visible = v;
    this.group.visible = v;
  }

  /**
   * Update arrows each frame.
   * @param {number} time — elapsed time (same as clock.elapsedTime)
   */
  update(time) {
    if (!this.visible) return;

    // ── Compute global current at reference height (mid-column) ──
    const heightFactor = 0.5;
    const amp = heightFactor * heightFactor * this.currentAmplitude;
    const spd = this.currentSpeed;
    const bias = this.currentDirectionBias;
    const dirAngle = this.currentDirection;
    const phase = time * spd + heightFactor * 3.0; // phaseSpan ~3

    // Primary: oscillates along dominant axis (positive ↔ negative)
    const primaryWave = Math.sin(phase) + 0.3 * Math.sin(phase * 0.37 + 1.7);
    const primaryX = Math.cos(dirAngle) * primaryWave * spd;
    const primaryZ = Math.sin(dirAngle) * primaryWave * spd;

    // Secondary: cross-axis sway
    const crossAngle = dirAngle + Math.PI * 0.5;
    const crossWave = Math.sin(phase * 0.7 + 0.5) * 0.4 + Math.sin(phase * 0.25 + 2.1) * 0.2;
    const crossX = Math.cos(crossAngle) * crossWave * spd;
    const crossZ = Math.sin(crossAngle) * crossWave * spd;

    const forceX = (primaryX * bias + crossX * (1.0 - bias)) * amp;
    const forceZ = (primaryZ * bias + crossZ * (1.0 - bias)) * amp;

    // Current arrow — map world XZ force to camera-local XY
    // In camera space: X = right, Y = up. Current flows in world XZ,
    // so we need to undo the camera's yaw to show the arrow relative
    // to the world (like a compass).
    const camYaw = Math.atan2(
      -this.camera.matrixWorld.elements[8],
      this.camera.matrixWorld.elements[0]
    );

    // Rotate force from world to camera-local
    const cosY = Math.cos(-camYaw);
    const sinY = Math.sin(-camYaw);
    const localX = forceX * cosY - forceZ * sinY;
    const localZ = forceX * sinY + forceZ * cosY;

    // Arrow length = force magnitude (clamped for HUD readability)
    const mag = Math.sqrt(localX * localX + localZ * localZ);
    const arrowLen = Math.min(mag * 1.5, 0.1); // max 0.1 in camera-local units

    if (mag > 0.001) {
      // Point the arrow — in camera-local, localX=right, localZ=towards camera
      // We map to XY plane of the HUD: X=right, Y=up
      // World X current → HUD X, World Z current → HUD -Y (Z forward in world = up on screen)
      const angle = Math.atan2(-localZ, localX);
      this.currentArrow.rotation.set(0, 0, angle - Math.PI / 2);
      this.currentArrow.scale.setScalar(arrowLen);
    }

    // ── Buoyancy arrow — always points up in world space ──
    // In camera-local, "world up" depends on camera pitch
    _dir.set(0, 1, 0); // world up
    _dir.applyMatrix4(this.camera.matrixWorldInverse).normalize();
    const buoyAngle = Math.atan2(_dir.x, _dir.y);
    const buoyLen = this.buoyancy * 0.15;
    this.buoyancyArrow.rotation.set(0, 0, -buoyAngle);
    this.buoyancyArrow.scale.setScalar(buoyLen);
  }

  dispose() {
    this.camera.remove(this.group);
  }
}
