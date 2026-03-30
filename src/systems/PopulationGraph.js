/**
 * PopulationGraph — Live rolling line chart of ecosystem population dynamics.
 *
 * Samples entity counts at a configurable interval and renders a canvas-based
 * line chart with one series per species. Designed for the "tune, play, tune"
 * dev workflow — lets you see the downstream effect of each config tweak in
 * real time.
 *
 * Features:
 * - Rolling window (default 5 min) with auto-scaling Y axis
 * - Color-coded series matching creature tint colors
 * - Current count labels on the right edge
 * - Semi-transparent overlay, bottom-right corner
 * - Toggle visibility with 'G' key (wired externally)
 * - Vertical markers when you call mark() (e.g., on mode switch or config save)
 *
 * Usage:
 *   import { PopulationGraph } from './systems/PopulationGraph.js';
 *   const graph = new PopulationGraph();
 *   document.body.appendChild(graph.dom);
 *
 *   // In game loop:
 *   graph.sample(elapsed, {
 *     fish: fishPool.getActiveCount(),
 *     dolphin: dolphinPool.getActiveCount(),
 *     manatee: manateePool.getActiveCount(),
 *     plant: plantPool.getActiveCount(),
 *     food: foodPool.getActiveCount(),
 *   });
 */

const SERIES = [
  { key: 'fish',    label: 'Fish',    color: '#44aaff' },
  { key: 'dolphin', label: 'Dolphin', color: '#6688cc' },
  { key: 'manatee', label: 'Manatee', color: '#88aa88' },
  { key: 'plant',   label: 'Plant',   color: '#44cc66' },
  { key: 'food',    label: 'Food',    color: '#ccaa44', dashed: true },
];

export class PopulationGraph {
  /**
   * @param {Object} [options]
   * @param {number} [options.width=360]         - Canvas width in CSS pixels
   * @param {number} [options.height=180]        - Canvas height in CSS pixels
   * @param {number} [options.sampleInterval=2]  - Seconds between samples
   * @param {number} [options.windowSeconds=300] - Rolling window duration (5 min)
   */
  constructor(options = {}) {
    this.width = options.width ?? 360;
    this.height = options.height ?? 180;
    this.sampleInterval = options.sampleInterval ?? 2;
    this.windowSeconds = options.windowSeconds ?? 300;

    // Max samples in the rolling window
    this._maxSamples = Math.ceil(this.windowSeconds / this.sampleInterval);

    // Ring buffer: each entry is { t, fish, dolphin, manatee, plant, food }
    this._samples = [];
    this._lastSampleTime = -Infinity;

    // Vertical markers (mode switches, config saves)
    this._markers = []; // { t }

    // Canvas setup (2x for retina sharpness)
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this._dpr = dpr;
    this._canvas = document.createElement('canvas');
    this._canvas.width = this.width * dpr;
    this._canvas.height = this.height * dpr;
    this._canvas.style.width = this.width + 'px';
    this._canvas.style.height = this.height + 'px';
    this._ctx = this._canvas.getContext('2d');

    // Container
    this._dom = document.createElement('div');
    this._dom.id = 'population-graph';
    this._dom.style.cssText =
      'position:fixed;bottom:12px;right:12px;z-index:9999;' +
      'background:rgba(5,12,30,0.85);border-radius:6px;' +
      'border:1px solid rgba(100,150,200,0.3);padding:8px;' +
      'pointer-events:none;display:none;';
    this._dom.appendChild(this._canvas);

    this._visible = false;
  }

  /** The root DOM element to append to the page */
  get dom() { return this._dom; }

  /** Whether the graph is currently visible */
  get visible() { return this._visible; }

  /** Show/hide the graph */
  setVisible(v) {
    this._visible = v;
    this._dom.style.display = v ? 'block' : 'none';
  }

  /** Toggle visibility */
  toggle() { this.setVisible(!this._visible); }

  /**
   * Drop a vertical marker line at the current time.
   * Useful for marking config changes or mode switches.
   */
  mark() {
    if (this._samples.length === 0) return;
    const lastT = this._samples[this._samples.length - 1].t;
    this._markers.push({ t: lastT });
  }

  /**
   * Sample current population counts. Call every frame — the method
   * internally throttles to sampleInterval.
   *
   * @param {number} elapsed - Total elapsed time in seconds
   * @param {Object} counts  - { fish, dolphin, manatee, plant, food }
   */
  sample(elapsed, counts) {
    if (elapsed - this._lastSampleTime < this.sampleInterval) return;
    this._lastSampleTime = elapsed;

    this._samples.push({
      t: elapsed,
      fish: counts.fish ?? 0,
      dolphin: counts.dolphin ?? 0,
      manatee: counts.manatee ?? 0,
      plant: counts.plant ?? 0,
      food: counts.food ?? 0,
    });

    // Trim to rolling window
    if (this._samples.length > this._maxSamples) {
      const excess = this._samples.length - this._maxSamples;
      this._samples.splice(0, excess);
    }

    // Trim markers outside the window
    if (this._samples.length > 0) {
      const windowStart = this._samples[0].t;
      this._markers = this._markers.filter(m => m.t >= windowStart);
    }

    // Redraw
    if (this._visible) this._draw();
  }

  /** @private */
  _draw() {
    const ctx = this._ctx;
    const dpr = this._dpr;
    const W = this.width * dpr;
    const H = this.height * dpr;
    const samples = this._samples;

    ctx.clearRect(0, 0, W, H);

    if (samples.length < 2) {
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.font = `${11 * dpr}px monospace`;
      ctx.textAlign = 'center';
      ctx.fillText('Collecting data...', W / 2, H / 2);
      return;
    }

    // Chart area with padding for labels
    const padL = 32 * dpr;
    const padR = 70 * dpr;  // room for current-value labels
    const padT = 6 * dpr;
    const padB = 16 * dpr;
    const chartW = W - padL - padR;
    const chartH = H - padT - padB;

    // Time range
    const tMin = samples[0].t;
    const tMax = samples[samples.length - 1].t;
    const tRange = Math.max(tMax - tMin, 1);

    // Find Y max across all series
    let yMax = 1;
    for (const s of samples) {
      for (const series of SERIES) {
        yMax = Math.max(yMax, s[series.key]);
      }
    }
    yMax = Math.ceil(yMax * 1.15); // 15% headroom

    // Grid lines
    ctx.strokeStyle = 'rgba(100,150,200,0.12)';
    ctx.lineWidth = dpr;
    const gridLines = 4;
    for (let i = 0; i <= gridLines; i++) {
      const y = padT + chartH * (1 - i / gridLines);
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(padL + chartW, y);
      ctx.stroke();

      // Y-axis label
      const val = Math.round(yMax * i / gridLines);
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.font = `${9 * dpr}px monospace`;
      ctx.textAlign = 'right';
      ctx.fillText(String(val), padL - 4 * dpr, y + 3 * dpr);
    }

    // Time axis label
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.font = `${9 * dpr}px monospace`;
    ctx.textAlign = 'center';
    const windowMin = Math.floor(tRange / 60);
    const windowSec = Math.floor(tRange % 60);
    ctx.fillText(
      windowMin > 0 ? `${windowMin}m ${windowSec}s` : `${windowSec}s`,
      padL + chartW / 2, H - 2 * dpr
    );

    // Vertical markers
    for (const marker of this._markers) {
      const mx = padL + ((marker.t - tMin) / tRange) * chartW;
      ctx.strokeStyle = 'rgba(255,200,60,0.4)';
      ctx.lineWidth = dpr;
      ctx.setLineDash([4 * dpr, 4 * dpr]);
      ctx.beginPath();
      ctx.moveTo(mx, padT);
      ctx.lineTo(mx, padT + chartH);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Draw series lines
    for (const series of SERIES) {
      ctx.strokeStyle = series.color;
      ctx.lineWidth = 1.5 * dpr;
      if (series.dashed) {
        ctx.setLineDash([4 * dpr, 3 * dpr]);
      }

      ctx.beginPath();
      for (let i = 0; i < samples.length; i++) {
        const s = samples[i];
        const x = padL + ((s.t - tMin) / tRange) * chartW;
        const y = padT + chartH * (1 - s[series.key] / yMax);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.setLineDash([]);

      // Current value label at right edge
      const lastVal = samples[samples.length - 1][series.key];
      const lastY = padT + chartH * (1 - lastVal / yMax);

      // Small dot at the end of the line
      ctx.fillStyle = series.color;
      ctx.beginPath();
      ctx.arc(padL + chartW, lastY, 2.5 * dpr, 0, Math.PI * 2);
      ctx.fill();

      // Label
      ctx.fillStyle = series.color;
      ctx.font = `${10 * dpr}px monospace`;
      ctx.textAlign = 'left';
      ctx.fillText(`${series.label} ${lastVal}`, padL + chartW + 6 * dpr, lastY + 3.5 * dpr);
    }
  }

  /** Remove from DOM */
  dispose() {
    this._dom.remove();
  }
}
