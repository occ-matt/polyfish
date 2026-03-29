import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { Food } from '../src/entities/Food.js';

// Minimal mock so preStep doesn't bail on null physicsProxy / joltBodyID
const mockPhysicsProxy = {
  createBody() { return 0; },
  removeBody() {},
  setPosition() {},
  setLinearVelocity() {},
  setGravityFactor() {},
  getPosition() { return { x: 0, y: 0, z: 0 }; },
  getLinearVelocity() { return { x: 0, y: 0, z: 0 }; },
};

/** Activate food with a physics proxy wired up so preStep runs fully. */
function activateWithPhysics(food, pos, force) {
  Food.setPhysicsProxy(mockPhysicsProxy);
  food.activate(pos, force);
  // activate calls _createJoltBody which sets joltBodyID via createBody() → 0
}

describe('Food', () => {
  it('creates with placeholder mesh when no model provided', () => {
    const food = new Food(null);
    expect(food.mesh).toBeInstanceOf(THREE.Mesh);
    expect(food.active).toBe(false);
    expect(food.mesh.visible).toBe(false);
  });

  it('uses provided model mesh', () => {
    const model = new THREE.Group();
    const food = new Food(model);
    expect(food.mesh).toBe(model);
  });

  it('activate() sets up state correctly', () => {
    const food = new Food(null);
    const pos = new THREE.Vector3(1, 2, 3);
    const force = new THREE.Vector3(0, 5, 0);

    food.activate(pos, force);
    expect(food.active).toBe(true);
    expect(food.mesh.visible).toBe(true);
    expect(food.body.position.x).toBe(1);
    expect(food.body.position.y).toBe(2);
    expect(food.lifetime).toBe(0);
  });

  it('deactivate() hides and disables', () => {
    const food = new Food(null);
    food.activate(new THREE.Vector3(0, 0, 0), null);
    food.deactivate();
    expect(food.active).toBe(false);
    expect(food.mesh.visible).toBe(false);
  });

  it('update advances lifetime', () => {
    const food = new Food(null);
    food.activate(new THREE.Vector3(0, 0, 0), null);
    food.update(1.0);
    expect(food.lifetime).toBe(1.0);
  });

  it('deactivates after max lifetime', () => {
    const food = new Food(null);
    food.activate(new THREE.Vector3(0, 0, 0), null);
    food.maxLifetime = 5;
    food.update(6.0);
    expect(food.active).toBe(false);
  });

  it('does not update when inactive', () => {
    const food = new Food(null);
    food.update(1.0);
    expect(food.lifetime).toBe(0);
  });

  it('food does not use gravity (floats)', () => {
    const food = new Food(null);
    expect(food.body.useGravity).toBe(false);
    food.activate(new THREE.Vector3(0, 0, 0), null);
    expect(food.body.useGravity).toBe(false);
  });

  // ── Physics LOD tests ──────────────────────────────────────────

  it('_useJolt defaults to true', () => {
    const food = new Food(null);
    expect(food._useJolt).toBe(true);
  });

  it('preStep advances simple physics regardless of _useJolt', () => {
    const food = new Food(null);
    activateWithPhysics(food, new THREE.Vector3(5, 5, 5), new THREE.Vector3(1, 0, 0));
    const startX = food.body.position.x;

    food._useJolt = false;
    food.preStep(0.1);
    // body.update(dt) should still run, moving position via velocity
    expect(food.body.position.x).not.toBe(startX);
  });

  it('update still runs lifetime/scale/mesh sync when _useJolt is false', () => {
    const food = new Food(null);
    activateWithPhysics(food, new THREE.Vector3(10, 3, 10), null);
    food._useJolt = false;

    // Run preStep to advance body position, then update to sync mesh
    food.preStep(0.5);
    food.update(0.5);

    expect(food.lifetime).toBe(0.5);
    expect(food.active).toBe(true);
    // Mesh position should be synced from body
    expect(food.mesh.position.x).toBe(food.body.position.x);
    expect(food.mesh.position.y).toBe(food.body.position.y);
    expect(food.mesh.position.z).toBe(food.body.position.z);
  });

  it('food reaches full lifetime and deactivates with _useJolt false', () => {
    const food = new Food(null);
    activateWithPhysics(food, new THREE.Vector3(50, 5, 50), null);
    food._useJolt = false;
    food.maxLifetime = 10;

    // Simulate many frames
    for (let i = 0; i < 120; i++) {
      if (!food.active) break;
      food.preStep(0.1);
      food.update(0.1);
    }

    expect(food.active).toBe(false);
    expect(food.lifetime).toBeGreaterThanOrEqual(10);
  });

  it('food count stays consistent across _useJolt transitions', () => {
    // Simulate a pool of food with mixed LOD states
    const foods = [];
    for (let i = 0; i < 20; i++) {
      const f = new Food(null);
      activateWithPhysics(f, new THREE.Vector3(i * 5, 3, 0), null);
      f.maxLifetime = 30;
      foods.push(f);
    }

    // Frame 1: all food uses Jolt
    for (const f of foods) {
      f._useJolt = true;
      f.preStep(0.016);
      f.update(0.016);
    }
    const count1 = foods.filter(f => f.active).length;

    // Frame 2: half the food switches to simple physics
    for (let i = 0; i < foods.length; i++) {
      const f = foods[i];
      if (!f.active) continue;
      f._useJolt = i < 10; // near food uses Jolt, far food doesn't
      f.preStep(0.016);
      f.update(0.016);
    }
    const count2 = foods.filter(f => f.active).length;

    // All food should still be alive (lifetime nowhere near max)
    expect(count1).toBe(20);
    expect(count2).toBe(20);
  });
});
