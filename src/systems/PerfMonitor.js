/**
 * PerfMonitor — Visual performance monitoring for PolyFish dev mode
 *
 * Combines mrdoob's stats.js (FPS/MS/MB graphs) with a custom panel
 * showing renderer stats, entity counts, and adaptive resolution state.
 *
 * Toggle panels by clicking the stats.js graph.
 * Toggle the entire monitor with ?dev=true URL param.
 *
 * Usage:
 *   import { PerfMonitor } from './systems/PerfMonitor.js';
 *   const perf = new PerfMonitor(renderer);
 *
 *   // In game loop — call begin() at the TOP, end() at the BOTTOM:
 *   perf.begin();
 *   // ... simulation + render ...
 *   perf.end(renderer, pools, { timeScale, adaptiveResolution });
 */

import Stats from 'three/examples/jsm/libs/stats.module.js';

export class PerfMonitor {
  /**
   * @param {HTMLElement} [container] - Parent element for positioning. Defaults to document.body.
   */
  constructor(container) {
    // stats.js — FPS, MS, and (if available) MB panels
    this.stats = new Stats();

    // Position the stats.js panel
    const dom = this.stats.dom;
    dom.style.position = 'static';
    dom.style.display = 'block';

    // Custom info panel — renderer stats, entity counts, perf details
    this._infoEl = document.createElement('pre');
    this._infoEl.style.cssText = `
      margin: 0;
      padding: 6px 8px;
      color: #0f0;
      font-family: 'Courier New', monospace;
      font-size: 11px;
      line-height: 1.5;
      white-space: pre;
      pointer-events: none;
    `;
    this._infoEl.textContent = '...';

    // Wrapper that holds both panels
    this._wrapper = document.createElement('div');
    this._wrapper.id = 'perf-monitor';
    this._wrapper.style.cssText = `
      position: fixed;
      top: 12px;
      left: 12px;
      z-index: 10000;
      background: rgba(0, 0, 0, 0.8);
      border-radius: 4px;
      border: 1px solid rgba(0, 255, 0, 0.2);
      overflow: hidden;
      pointer-events: auto;
    `;
    this._wrapper.appendChild(dom);
    this._wrapper.appendChild(this._infoEl);

    // Sampling state for the info panel (updates at 2 Hz, not every frame)
    this._sampleTimer = 0;
    this._sampleFrames = 0;
    this._sampleInterval = 0.5; // seconds
  }

  /** Get the root DOM element (for appending to dev panel) */
  get dom() {
    return this._wrapper;
  }

  /**
   * Call at the VERY START of the game loop, before any simulation or render.
   * This marks the beginning of the measured frame.
   */
  begin() {
    this.stats.begin();
  }

  /**
   * Call at the VERY END of the game loop, after all rendering is complete.
   * This marks the end of the measured frame and updates the info panel.
   *
   * @param {number} dt - Raw delta time for this frame
   * @param {THREE.WebGLRenderer} renderer - The Three.js renderer (for info.render)
   * @param {Object} pools - Entity pool map { fish, dolphin, manatee, plant, food, seed }
   * @param {Object} [extras] - Optional extra state
   * @param {number} [extras.timeScale] - Current simulation timescale
   * @param {AdaptiveResolution} [extras.adaptiveResolution] - Adaptive DPR scaler
   */
  end(dt, renderer, pools, extras = {}) {
    this.stats.end();

    this._sampleTimer += dt;
    this._sampleFrames++;

    if (this._sampleTimer < this._sampleInterval) return;

    // Read renderer info AFTER render (not reset yet — that happens next frame)
    const info = renderer.info.render;
    const mem = renderer.info.memory;
    const calls = info.calls;
    const tris = info.triangles;
    const geoms = mem.geometries;
    const texs = mem.textures;

    // Effective resolution
    const pr = renderer.getPixelRatio();
    const canvas = renderer.domElement;
    const effectiveW = Math.round(canvas.clientWidth * pr);
    const effectiveH = Math.round(canvas.clientHeight * pr);

    // Entity counts
    const fa = pools.fish?.getActiveCount() ?? 0;
    const da = pools.dolphin?.getActiveCount() ?? 0;
    const ma = pools.manatee?.getActiveCount() ?? 0;
    const pa = pools.plant?.getActiveCount() ?? 0;
    const fo = pools.food?.getActiveCount() ?? 0;
    const se = pools.seed?.getActiveCount() ?? 0;

    // Extras
    const ts = extras.timeScale ?? 1;
    const ar = extras.adaptiveResolution;
    const dpr = ar ? ar.getDPR().toFixed(2) : pr.toFixed(2);

    // Build info text
    let text =
      `Draw: ${calls}  Tris: ${this._fmtK(tris)}\n` +
      `Geom: ${geoms}  Tex: ${texs}\n` +
      `Res: ${effectiveW}×${effectiveH}  DPR: ${dpr}\n` +
      `────────────────\n` +
      `Fish: ${fa}  Dolphin: ${da}\n` +
      `Manatee: ${ma}  Plant: ${pa}\n` +
      `Food: ${fo}  Seed: ${se}`;

    if (ts !== 1) {
      text += `\nTimeScale: ${ts}x`;
    }

    this._infoEl.textContent = text;
    this._sampleTimer = 0;
    this._sampleFrames = 0;
  }

  /** Format number with K suffix for thousands */
  _fmtK(n) {
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
    return String(n);
  }

  /** Remove from DOM and clean up */
  dispose() {
    this._wrapper.remove();
  }
}
