import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { SpawnerSystem } from '../src/systems/SpawnerSystem.js';

describe('SpawnerSystem', () => {
  it('starts with no spawners', () => {
    const sys = new SpawnerSystem();
    expect(sys.spawners.length).toBe(0);
  });

  it('addSpawner registers a spawner with defaults', () => {
    const sys = new SpawnerSystem();
    sys.addSpawner(new THREE.Vector3(0, 0, 0));
    expect(sys.spawners.length).toBe(1);
    expect(sys.spawners[0].type).toBe('food');
    expect(sys.spawners[0].active).toBe(true);
  });

  it('spawns food when timer exceeds rate', () => {
    const sys = new SpawnerSystem();
    sys.addSpawner(new THREE.Vector3(0, 0, 0), { rate: 1.0 });

    const onSpawnFood = vi.fn();
    // Update with dt just over the rate
    sys.update(1.1, { onSpawnFood });
    expect(onSpawnFood).toHaveBeenCalledTimes(1);

    // Verify position argument is a Vector3
    const pos = onSpawnFood.mock.calls[0][0];
    expect(pos).toBeInstanceOf(THREE.Vector3);
  });

  it('does not spawn before rate elapsed', () => {
    const sys = new SpawnerSystem();
    sys.addSpawner(new THREE.Vector3(0, 0, 0), { rate: 5.0 });

    const onSpawnFood = vi.fn();
    sys.update(1.0, { onSpawnFood });
    expect(onSpawnFood).not.toHaveBeenCalled();
  });

  it('handles seed spawner type', () => {
    const sys = new SpawnerSystem();
    sys.addSpawner(new THREE.Vector3(0, 0, 0), { rate: 0.5, type: 'seed' });

    const onSpawnSeed = vi.fn();
    sys.update(0.6, { onSpawnSeed });
    expect(onSpawnSeed).toHaveBeenCalledTimes(1);
  });

  it('skips inactive spawners', () => {
    const sys = new SpawnerSystem();
    sys.addSpawner(new THREE.Vector3(0, 0, 0), { rate: 0.1 });
    sys.spawners[0].active = false;

    const onSpawnFood = vi.fn();
    sys.update(10.0, { onSpawnFood });
    expect(onSpawnFood).not.toHaveBeenCalled();
  });

  it('multiple spawners work independently', () => {
    const sys = new SpawnerSystem();
    sys.addSpawner(new THREE.Vector3(0, 0, 0), { rate: 1.0 });
    sys.addSpawner(new THREE.Vector3(5, 0, 0), { rate: 2.0 });

    const onSpawnFood = vi.fn();
    sys.update(1.5, { onSpawnFood });
    // First spawner should fire, second should not
    expect(onSpawnFood).toHaveBeenCalledTimes(1);
  });
});
