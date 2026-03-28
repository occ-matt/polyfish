/**
 * HUD System - Manages the heads-up display for population counters
 * Tracks species discovery, updates population counts with animations
 */
import * as THREE from 'three';

export class HUDSystem {
  constructor() {
    // DOM element reference
    this.hudElement = document.getElementById('population-counter');

    // Timers
    this.hudTimer = 0;
    this.debugTimer = 0;
    this.perfTimer = 0;
    this.perfFrameCount = 0;

    // Species discovery state - only show in HUD once the player's camera has seen one
    this._frustum = new THREE.Frustum();
    this._projScreenMatrix = new THREE.Matrix4();
    this.speciesSeen = { plant: false, fish: false, manatee: false, dolphin: false };

    // Track which species were in the HUD last frame (for new-species animation)
    this.speciesInHud = { plant: false, fish: false, manatee: false, dolphin: false };

    // Track previous counts for count-bump animation
    this.prevCounts = { plant: -1, fish: -1, manatee: -1, dolphin: -1 };

    // HUD fade-in flag
    this.hudFadedIn = false;

    // Debug logging (enable via ?debug URL param)
    this._debugLog = new URLSearchParams(window.location.search).has('debug');
  }

  /**
   * Reset all species discovery state and animations
   */
  reset() {
    this.speciesSeen.plant = false;
    this.speciesSeen.fish = false;
    this.speciesSeen.manatee = false;
    this.speciesSeen.dolphin = false;
    this.speciesInHud.plant = false;
    this.speciesInHud.fish = false;
    this.speciesInHud.manatee = false;
    this.speciesInHud.dolphin = false;
    this.prevCounts.plant = -1;
    this.prevCounts.fish = -1;
    this.prevCounts.manatee = -1;
    this.prevCounts.dolphin = -1;
    this.hudFadedIn = false;
    if (this.hudElement) this.hudElement.classList.add('hud-hidden');
  }

  /**
   * Check if any active entity in a pool is inside the camera frustum.
   * @param {ObjectPool} pool - The object pool to check
   * @param {THREE.Camera} camera - The camera to use for frustum culling
   * @returns {boolean} True if any entity in the pool is visible to the camera
   */
  isAnyInFrustum(pool, camera) {
    let found = false;
    pool.forEachActive(entity => {
      if (found) return;
      const pos = entity.mesh ? entity.mesh.position : entity.position;
      if (pos && this._frustum.containsPoint(pos)) found = true;
    });
    return found;
  }

  /**
   * Update the HUD display with current population counts
   * @param {number} dt - Delta time since last frame
   * @param {Object} pools - Object containing { fishPool, dolphinPool, manateePool, plantPool }
   * @param {THREE.Camera} camera - The active camera
   * @returns {Object} Population counts { fish, dolphin, manatee, plant }
   */
  update(dt, pools, camera) {
    this.hudTimer += dt;
    this.debugTimer += dt;

    // Return population counts even if not updating display (for VR HUD)
    if (this.hudTimer < 0.75) {
      return {
        fish: pools.fishPool.getActiveCount(),
        dolphin: pools.dolphinPool.getActiveCount(),
        manatee: pools.manateePool.getActiveCount(),
        plant: pools.plantPool.getActiveCount(),
        speciesSeen: this.speciesSeen,
      };
    }
    this.hudTimer = 0;

    // Update frustum from current camera
    this._projScreenMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this._frustum.setFromProjectionMatrix(this._projScreenMatrix);

    // Check for newly spotted species
    if (!this.speciesSeen.plant && this.isAnyInFrustum(pools.plantPool, camera)) this.speciesSeen.plant = true;
    if (!this.speciesSeen.fish && this.isAnyInFrustum(pools.fishPool, camera)) this.speciesSeen.fish = true;
    if (!this.speciesSeen.manatee && this.isAnyInFrustum(pools.manateePool, camera)) this.speciesSeen.manatee = true;
    if (!this.speciesSeen.dolphin && this.isAnyInFrustum(pools.dolphinPool, camera)) this.speciesSeen.dolphin = true;

    const fishAlive = pools.fishPool.getActiveCount();
    const dolphinAlive = pools.dolphinPool.getActiveCount();
    const manateeAlive = pools.manateePool.getActiveCount();
    const plantActive = pools.plantPool.getActiveCount();

    if (this.hudElement) {
      // Fade the whole HUD in on first species discovery
      if (!this.hudFadedIn && (this.speciesSeen.plant || this.speciesSeen.fish || this.speciesSeen.manatee || this.speciesSeen.dolphin)) {
        this.hudFadedIn = true;
        this.hudElement.classList.remove('hud-hidden');
      }

      // Order of appearance: PolyPlants - PolyFish - Polytees - Polyphins
      const items = [
        { key: 'plant',   seen: this.speciesSeen.plant,   color: '#8fa', label: 'PolyPlants', count: plantActive },
        { key: 'fish',    seen: this.speciesSeen.fish,    color: '#f93', label: 'PolyFish',   count: fishAlive },
        { key: 'manatee', seen: this.speciesSeen.manatee, color: '#c9a', label: 'Polytees',   count: manateeAlive },
        { key: 'dolphin', seen: this.speciesSeen.dolphin, color: '#68c', label: 'Polyphins',  count: dolphinAlive },
      ];

      // Check if the visible species list changed (need full DOM rebuild)
      const visibleKeys = items.filter(i => i.seen).map(i => i.key).join(',');
      const prevVisibleKeys = items.filter(i => this.speciesInHud[i.key]).map(i => i.key).join(',');
      const speciesListChanged = visibleKeys !== prevVisibleKeys;

      if (speciesListChanged) {
        // Full rebuild - new species appeared
        let html = '';
        let first = true;
        for (const item of items) {
          if (!item.seen) continue;
          const isNew = !this.speciesInHud[item.key];
          if (!first) html += '<span class="pop-separator"></span>';
          const itemClass = isNew ? 'pop-item pop-new' : 'pop-item';
          html += `<span class="${itemClass}" data-species="${item.key}"><span class="pop-dot" style="background:${item.color}"></span><span class="pop-label">${item.label}</span><span class="pop-count" data-count="${item.key}">${item.count}</span></span>`;
          this.speciesInHud[item.key] = true;
          this.prevCounts[item.key] = item.count;
          first = false;
        }
        this.hudElement.innerHTML = html;
      } else {
        // Incremental update - only patch count text, no DOM rebuild
        for (const item of items) {
          if (!item.seen) continue;
          const countEl = this.hudElement.querySelector(`[data-count="${item.key}"]`);
          if (!countEl) continue;
          if (this.prevCounts[item.key] !== item.count) {
            countEl.textContent = item.count;
            // Re-trigger bump animation
            countEl.classList.remove('pop-count-bump');
            void countEl.offsetWidth; // force reflow
            countEl.classList.add('pop-count-bump');
            this.prevCounts[item.key] = item.count;
          }
        }
      }
    }

    if (this._debugLog && this.debugTimer > 5) {
      this.debugTimer = 0;
      const foodActive = pools.foodPool.getActiveCount();
      const seedActive = pools.seedPool.getActiveCount();
      console.log(`[PolyFish] Fish:${fishAlive} Dolphin:${dolphinAlive} Manatee:${manateeAlive} | Food:${foodActive} Seed:${seedActive} Plant:${plantActive}`);
    }

    // Return population data for VR HUD (includes species discovery state)
    return {
      fish: fishAlive,
      dolphin: dolphinAlive,
      manatee: manateeAlive,
      plant: plantActive,
      speciesSeen: this.speciesSeen,
    };
  }
}
