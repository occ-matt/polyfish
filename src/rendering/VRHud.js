/**
 * VRHud - Premium dive-watch style HUD on the left controller.
 *
 * Renders a population counter as a sleek holographic display attached
 * to the left controller. Uses the same species names, colors, discovery
 * state, and data format as the non-VR HUDSystem (PolyPlants, PolyFish,
 * Polytees, Polyphins) to maintain visual consistency across modes.
 *
 * Only shows species after they've been discovered (frustum-based detection
 * from HUDSystem.speciesSeen), matching the non-VR progressive reveal.
 *
 * Billboards toward the camera each frame so it's always readable.
 *
 * Attach after controllers are connected so we know which is the left hand.
 */
import * as THREE from 'three';

const CANVAS_W = 320;
const CANVAS_H = 240;

const _camWorldPos = new THREE.Vector3();
const _meshWorldPos = new THREE.Vector3();

// Match non-VR HUD species order and naming
const SPECIES_CONFIG = [
  { key: 'plant',   label: 'PolyPlants', color: '#88ffaa', dotColor: '#88ffaa' },
  { key: 'fish',    label: 'PolyFish',   color: '#ff9933', dotColor: '#ff9933' },
  { key: 'manatee', label: 'Polytees',   color: '#cc99aa', dotColor: '#cc99aa' },
  { key: 'dolphin', label: 'Polyphins',  color: '#6688cc', dotColor: '#6688cc' },
];

export class VRHud {
  /**
   * @param {THREE.Group} controller - The left controller (target ray space)
   */
  constructor(controller) {
    this.controller = controller;

    // Canvas for rendering the population text
    this.canvas = document.createElement('canvas');
    this.canvas.width = CANVAS_W;
    this.canvas.height = CANVAS_H;
    this.ctx = this.canvas.getContext('2d');

    // Texture from canvas
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;

    // Material: frosted glass look, always visible (no depth test so terrain can't hide it)
    const material = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      opacity: 0.92,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    // Slightly larger panel for the redesigned layout
    const geometry = new THREE.PlaneGeometry(0.09, 0.068);
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.renderOrder = 800; // render above scene geometry

    // Position offset from controller: left and down-left to avoid obstruction
    this.mesh.position.set(-0.08, 0.0, 0.08);

    // Attach to controller
    controller.add(this.mesh);

    // Store last population data to avoid redrawing if unchanged
    this._lastPopulationData = null;
    this.mesh.visible = false;
  }

  /**
   * Update the HUD with new population data.
   * @param {Object} populationData - { fish, dolphin, manatee, plant, speciesSeen }
   */
  update(populationData) {
    if (this._lastPopulationData &&
        JSON.stringify(this._lastPopulationData) === JSON.stringify(populationData)) {
      return;
    }

    this._lastPopulationData = { ...populationData };
    this._redrawCanvas(populationData);
    this.texture.needsUpdate = true;
  }

  /**
   * Billboard the watch face toward the camera each frame.
   * @param {THREE.Camera} camera - the XR camera (or user camera)
   */
  billboard(camera) {
    if (!this.mesh.visible || !camera) return;

    this.mesh.getWorldPosition(_meshWorldPos);
    camera.getWorldPosition(_camWorldPos);

    this.mesh.lookAt(_camWorldPos);
  }

  /**
   * Redraw the canvas with premium frosted glass UI.
   * Only shows species that have been discovered (matching non-VR behavior).
   */
  _redrawCanvas(populationData) {
    const { fish = 0, dolphin = 0, manatee = 0, plant = 0, speciesSeen } = populationData;
    const ctx = this.ctx;
    const w = CANVAS_W;
    const h = CANVAS_H;

    // Clear to fully transparent
    ctx.clearRect(0, 0, w, h);

    // Determine which species to show (progressive discovery)
    const counts = { plant, fish, manatee, dolphin };
    const visibleSpecies = SPECIES_CONFIG.filter(s => {
      // Show if speciesSeen says it's discovered, or fallback to show all if no discovery data
      if (!speciesSeen) return true;
      return speciesSeen[s.key];
    });

    // Nothing discovered yet - hide the HUD entirely
    if (visibleSpecies.length === 0) {
      return;
    }

    // Dynamic layout sizing based on visible species count
    const rowH = 50;
    const pad = 8;
    const topPad = 12;
    const bottomPad = 12;
    const totalContentH = visibleSpecies.length * rowH;
    const bgH = totalContentH + topPad + bottomPad;
    const bgW = w - pad * 2;
    const radius = 20;

    // Frosted glass background - sized to fit visible species only
    ctx.fillStyle = 'rgba(10, 20, 40, 0.55)';
    this._roundRect(ctx, pad, pad, bgW, bgH, radius);
    ctx.fill();

    // Subtle border
    ctx.strokeStyle = 'rgba(120, 180, 255, 0.2)';
    ctx.lineWidth = 1.5;
    this._roundRect(ctx, pad, pad, bgW, bgH, radius);
    ctx.stroke();

    // Species rows
    const leftPad = 28;
    const rightPad = w - 28;
    const startY = pad + topPad;

    for (let i = 0; i < visibleSpecies.length; i++) {
      const { key, label, color, dotColor } = visibleSpecies[i];
      const count = counts[key] || 0;
      const cy = startY + i * rowH + rowH / 2;

      // Status indicator dot with glow
      ctx.shadowColor = dotColor;
      ctx.shadowBlur = 6;
      ctx.fillStyle = dotColor;
      ctx.beginPath();
      ctx.arc(leftPad + 6, cy, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;

      // Species label - matching non-VR names
      ctx.fillStyle = 'rgba(210, 225, 245, 0.9)';
      ctx.font = '400 20px -apple-system, "SF Pro Text", "Helvetica Neue", sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, leftPad + 20, cy);

      // Count - right-aligned, bold, in species color
      ctx.fillStyle = color;
      ctx.font = '600 26px -apple-system, "SF Pro Display", "Helvetica Neue", sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(count.toString(), rightPad - 8, cy);
    }
  }

  /**
   * Draw a rounded rectangle path.
   */
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

  /**
   * Show or hide the HUD.
   */
  setVisible(visible) {
    this.mesh.visible = visible;
  }

  /**
   * Clean up resources.
   */
  dispose() {
    this.texture.dispose();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    if (this.controller) {
      this.controller.remove(this.mesh);
    }
  }
}
