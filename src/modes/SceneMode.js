/**
 * SceneMode — base class for all scene modes.
 * Subclasses implement enter/exit/update to control what's active.
 */
export class SceneMode {
  constructor(name) {
    this.name = name;
    this.active = false;
  }

  /** Called when this mode becomes active. ctx = shared context object. */
  async enter(ctx) {}

  /** Called when leaving this mode. Clean up mode-specific state. */
  async exit(ctx) {}

  /** Per-frame update (only called while mode is active). */
  update(dt, elapsed, ctx) {}

  /** Mode-specific key handler. Return true if handled. */
  handleKeyDown(e, ctx) { return false; }
}
