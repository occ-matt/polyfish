import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { Food } from '../src/entities/Food.js';

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
});
