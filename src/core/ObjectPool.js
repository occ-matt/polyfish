/**
 * Generic object pool for efficient object reuse
 * Ported from Unity's ObjectPoolerScript
 *
 * Maintains a tracked `active` array so callers can iterate without
 * scanning the full pool every frame.  Items that self-deactivate
 * (set `.active = false` without calling release()) are cleaned up
 * lazily via `forEachActive()`.
 */
export class ObjectPool {
  constructor(options = {}) {
    this.factory = options.factory || (() => ({}));
    this.initialSize = options.initialSize || 10;
    this.canGrow = options.canGrow !== false;
    this.onActivate = options.onActivate || (() => {});
    this.onDeactivate = options.onDeactivate || (() => {});

    this.pool = [];
    this.active = [];

    this.initialize();
  }

  /**
   * Initialize the pool with the specified number of items
   */
  initialize() {
    for (let i = 0; i < this.initialSize; i++) {
      const item = this.factory();
      item.active = false;
      this.pool.push(item);
    }
  }

  /**
   * Get an item from the pool, or create a new one if allowed
   */
  get() {
    let item = null;

    // Find first inactive item
    for (let i = 0; i < this.pool.length; i++) {
      if (!this.pool[i].active) {
        item = this.pool[i];
        break;
      }
    }

    // If no inactive item and we can grow, create a new one
    if (!item && this.canGrow) {
      item = this.factory();
      item.active = false;
      this.pool.push(item);
    }

    if (item) {
      item.active = true;
      // Guard against duplicate active entries: if this item was deactivated
      // mid-frame but not yet pruned by forEachActive, it's still in active[].
      // Remove the stale entry before re-adding to prevent double-update bugs
      // (e.g. food rendered twice at same position with different rotations).
      const staleIdx = this.active.indexOf(item);
      if (staleIdx !== -1) {
        const last = this.active.length - 1;
        if (staleIdx !== last) this.active[staleIdx] = this.active[last];
        this.active.length = last;
      }
      this.active.push(item);
      this.onActivate(item);
    }

    return item;
  }

  /**
   * Release an item back to the pool
   */
  release(item) {
    if (item && item.active) {
      item.active = false;
      const idx = this.active.indexOf(item);
      if (idx !== -1) {
        // Swap with last element for O(1) removal
        const last = this.active.length - 1;
        if (idx !== last) {
          this.active[idx] = this.active[last];
        }
        this.active.length = last;
      }
      this.onDeactivate(item);
    }
  }

  /**
   * Iterate over active items, calling fn(item) for each.
   * Automatically removes items that have self-deactivated (item.active === false).
   * Safe to call even if items deactivate during iteration (iterates backwards).
   */
  forEachActive(fn) {
    const arr = this.active;
    for (let i = arr.length - 1; i >= 0; i--) {
      const item = arr[i];
      if (!item.active) {
        // Item self-deactivated — remove from active list (swap-remove)
        const last = arr.length - 1;
        if (i !== last) {
          arr[i] = arr[last];
        }
        arr.length = last;
        continue;
      }
      fn(item);
    }
  }

  /**
   * Get array of all active items (returns the live array — no copy).
   * Call forEachActive() first if you need stale entries pruned.
   */
  getActiveItems() {
    return this.active;
  }

  /**
   * Get count of active items.
   * Returns tracked length (may include stale entries until next forEachActive).
   */
  getActiveCount() {
    return this.active.length;
  }

  /**
   * Iterate over all active items with a callback function.
   * Delegates to forEachActive for stale-entry cleanup.
   */
  forEach(fn) {
    this.forEachActive(fn);
  }

  /**
   * Release all active items back to the pool
   */
  releaseAll() {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const item = this.active[i];
      if (item.active) {
        item.active = false;
        this.onDeactivate(item);
      }
    }
    this.active.length = 0;
  }

  /**
   * Get total pool size (active + inactive)
   */
  getTotalSize() {
    return this.pool.length;
  }

  /**
   * Fully destroy the pool: deactivate all items, remove meshes from the scene,
   * and clear internal arrays. Call this for a clean teardown before rebuilding.
   * @param {THREE.Scene} scene — The scene to remove meshes from.
   */
  destroyAll(scene) {
    // Deactivate all active items (cleans up Jolt bodies, debug visuals, etc.)
    for (const item of this.pool) {
      if (item.active && typeof item.deactivate === 'function') {
        item.deactivate();
      }
    }
    this.active.length = 0;

    // Remove meshes from the scene
    for (const item of this.pool) {
      if (item.mesh && item.mesh.parent === scene) {
        scene.remove(item.mesh);
      }
    }

    // Clear pool array
    this.pool.length = 0;
  }
}
