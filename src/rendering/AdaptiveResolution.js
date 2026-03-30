/**
 * AdaptiveResolution — Dynamic pixel-ratio scaling based on frame time
 *
 * Monitors a rolling window of frame times and adjusts the renderer's
 * pixel ratio to maintain a target framerate. When the GPU is struggling
 * (large window on 4K monitor), the pixel ratio drops smoothly to reduce
 * fragment load. When headroom is available, it nudges back up.
 *
 * Designed to be invisible to the user — changes are small per step and
 * the visual difference between DPR 1.5 and 1.3 is negligible in motion.
 *
 * Usage:
 *   import { AdaptiveResolution } from './rendering/AdaptiveResolution.js';
 *   const adaptive = new AdaptiveResolution(renderer, {
 *     maxDPR: 2.0,    // upper bound (matches SceneManager's initial cap)
 *     minDPR: 0.75,   // floor to prevent excessive blur
 *   });
 *
 *   // In game loop:
 *   adaptive.update(deltaTime);
 *
 * Toggle via URL: ?adaptiveRes=0 to disable (locks DPR at initial value).
 */

export class AdaptiveResolution {
  /**
   * @param {THREE.WebGLRenderer} renderer
   * @param {Object} [options]
   * @param {number} [options.maxDPR]       - Upper DPR bound (default: current renderer DPR)
   * @param {number} [options.minDPR=0.75]  - Lower DPR bound
   * @param {number} [options.targetFPS=60] - Target framerate
   * @param {number} [options.step=0.05]    - DPR adjustment per evaluation
   * @param {number} [options.windowSize=60] - Number of frames to average over
   * @param {number} [options.evalInterval=0.5] - Seconds between evaluations
   * @param {number} [options.downThreshold=0.9] - Scale down if avg FPS < target * this
   * @param {number} [options.upThreshold=0.97]  - Scale up if avg FPS > target * this
   */
  constructor(renderer, options = {}) {
    this.renderer = renderer;
    this.maxDPR = options.maxDPR ?? renderer.getPixelRatio();
    this.minDPR = options.minDPR ?? 0.75;
    this.targetFPS = options.targetFPS ?? 60;
    this.step = options.step ?? 0.05;
    this.downThreshold = options.downThreshold ?? 0.9;  // drop if < 54 fps
    this.upThreshold = options.upThreshold ?? 0.97;     // recover if > 58 fps
    this.evalInterval = options.evalInterval ?? 0.5;

    this.currentDPR = renderer.getPixelRatio();
    this._accumTime = 0;
    this._accumFrames = 0;
    this._enabled = true;

    // Debounce: don't scale up immediately after scaling down.
    // Wait at least 2 evaluation cycles before allowing upscale.
    this._cooldownAfterDown = 0;
  }

  /**
   * Call once per frame with the raw (unclamped) delta time.
   * @param {number} dt - Frame delta in seconds
   */
  update(dt) {
    if (!this._enabled) return;

    this._accumTime += dt;
    this._accumFrames++;

    if (this._accumTime < this.evalInterval) return;

    const avgDt = this._accumTime / this._accumFrames;
    const avgFPS = 1 / avgDt;

    this._accumTime = 0;
    this._accumFrames = 0;

    if (this._cooldownAfterDown > 0) {
      this._cooldownAfterDown -= 1;
    }

    const downFPS = this.targetFPS * this.downThreshold;
    const upFPS = this.targetFPS * this.upThreshold;

    if (avgFPS < downFPS && this.currentDPR > this.minDPR) {
      // Struggling — reduce resolution
      this.currentDPR = Math.max(this.minDPR, this.currentDPR - this.step);
      this.renderer.setPixelRatio(this.currentDPR);
      this._cooldownAfterDown = 3; // wait 3 eval cycles before scaling back up
    } else if (avgFPS > upFPS && this.currentDPR < this.maxDPR && this._cooldownAfterDown <= 0) {
      // Headroom available — nudge resolution back up
      this.currentDPR = Math.min(this.maxDPR, this.currentDPR + this.step);
      this.renderer.setPixelRatio(this.currentDPR);
    }
  }

  /** Get current effective DPR */
  getDPR() {
    return this.currentDPR;
  }

  /** Enable/disable adaptive scaling */
  setEnabled(enabled) {
    this._enabled = enabled;
  }

  /** Check if adaptive scaling is active */
  isEnabled() {
    return this._enabled;
  }
}
