/**
 * SceneModeManager — coordinates switching between scene modes.
 * Handles clean enter/exit transitions and entity deactivation between modes.
 */
import fadeOverlay from '../rendering/FadeOverlay.js';

export class SceneModeManager {
  constructor() {
    this.modes = new Map();
    this.currentMode = null;
    this.switching = false;
  }

  register(mode) {
    this.modes.set(mode.name, mode);
  }

  async switchMode(name, ctx) {
    if (this.switching) return;
    if (this.currentMode?.name === name) return;

    const next = this.modes.get(name);
    if (!next) {
      console.warn(`[ModeManager] Unknown mode: ${name}`);
      return;
    }

    this.switching = true;
    // console.log(`[ModeManager] Switching to: ${name}`);

    // Quick fade out
    await fadeOverlay.fadeOut(0.3);

    // Exit current mode
    if (this.currentMode) {
      await this.currentMode.exit(ctx);
      this.currentMode.active = false;
    }

    // Deactivate all entities between modes
    this._deactivateAll(ctx);

    // Enter new mode
    this.currentMode = next;
    next.active = true;
    await next.enter(ctx);

    // Update UI highlight
    this._updateUI(name);

    // Fade back in
    await fadeOverlay.fadeIn(0.3);
    this.switching = false;
  }

  update(dt, elapsed, ctx) {
    if (this.currentMode?.active && !this.switching) {
      this.currentMode.update(dt, elapsed, ctx);
    }
  }

  /** Deactivate every entity in every pool for a clean slate. */
  _deactivateAll(ctx) {
    for (const { pool } of ctx.allCreaturePools) {
      for (const c of pool.pool) {
        if (c.active) c.deactivate();
      }
    }
    for (const f of ctx.foodPool.pool) {
      if (f.active) f.deactivate();
    }
    for (const s of ctx.seedPool.pool) {
      if (s.active) s.deactivate();
    }
    for (const p of ctx.plantPool.pool) {
      if (p.active) p.deactivate();
    }
  }

  _updateUI(name) {
    document.querySelectorAll('#mode-selector button').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === name);
    });
    // Update mode label
    const label = document.getElementById('mode-label');
    if (label) label.textContent = name;
  }
}
