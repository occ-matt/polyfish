import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { randomRange, randomInsideSphere } from '../utils/MathUtils.js';

export class SpawnerSystem {
  constructor() {
    this.spawners = []; // Array of { position, radius, timer, rate, type }
  }

  addSpawner(position, options = {}) {
    const rate = options.rate || CONFIG.spawner.wasteRate;
    this.spawners.push({
      position: position.clone(),
      radius: options.radius || CONFIG.spawner.radius,
      rate: rate,
      currentRate: rate, // Will be randomized after first spawn
      type: options.type || 'food',
      timer: 0,
      active: true,
    });
  }

  update(dt, callbacks = {}) {
    for (const spawner of this.spawners) {
      if (!spawner.active) continue;
      spawner.timer += dt;
      if (spawner.timer >= spawner.currentRate) {
        spawner.timer = 0;
        // Randomize next spawn interval like Unity
        spawner.currentRate = randomRange(spawner.rate * 0.25, spawner.rate * 1.5);

        const offset = randomInsideSphere(spawner.radius);
        const spawnPos = spawner.position.clone().add(offset);

        // Unity: if spawned below spawner and ejectUp, clamp Y
        if (spawnPos.y < spawner.position.y) {
          spawnPos.y = spawner.position.y;
        }

        if (spawner.type === 'food') {
          // Unity ejection: upward force with some randomness
          const upForce = new THREE.Vector3(
            randomRange(-1, 1),
            randomRange(CONFIG.spawner.upForceMin, CONFIG.spawner.upForceMax),
            randomRange(-1, 1)
          );
          if (callbacks.onSpawnFood) callbacks.onSpawnFood(spawnPos, upForce);
        } else if (spawner.type === 'seed') {
          if (callbacks.onSpawnSeed) callbacks.onSpawnSeed(spawnPos);
        }
      }
    }
  }
}
