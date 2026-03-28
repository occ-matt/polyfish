import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { PhysicsBody } from '../src/core/PhysicsBody.js';

describe('PhysicsBody', () => {
  it('initializes with default values', () => {
    const body = new PhysicsBody();
    expect(body.position.lengthSq()).toBe(0);
    expect(body.velocity.lengthSq()).toBe(0);
    expect(body.mass).toBe(1.0);
    expect(body.drag).toBe(0.1);
    expect(body.useGravity).toBe(false);
    expect(body.frozen).toBe(false);
  });

  it('accepts constructor options', () => {
    const body = new PhysicsBody({ mass: 5, drag: 2, useGravity: true });
    expect(body.mass).toBe(5);
    expect(body.drag).toBe(2);
    expect(body.useGravity).toBe(true);
  });

  describe('forces and impulses', () => {
    it('addForce accumulates forces', () => {
      const body = new PhysicsBody();
      body.addForce(new THREE.Vector3(1, 0, 0));
      body.addForce(new THREE.Vector3(0, 2, 0));
      expect(body.forces.x).toBe(1);
      expect(body.forces.y).toBe(2);
    });

    it('addImpulse directly changes velocity (scaled by mass)', () => {
      const body = new PhysicsBody({ mass: 2 });
      body.addImpulse(new THREE.Vector3(4, 0, 0));
      expect(body.velocity.x).toBe(2); // 4 / mass(2) = 2
    });

    it('frozen body ignores forces and impulses', () => {
      const body = new PhysicsBody({ frozen: true });
      body.addForce(new THREE.Vector3(10, 0, 0));
      body.addImpulse(new THREE.Vector3(10, 0, 0));
      expect(body.forces.x).toBe(0);
      expect(body.velocity.x).toBe(0);
    });
  });

  describe('update', () => {
    it('integrates velocity into position', () => {
      const body = new PhysicsBody({ drag: 0 });
      body.velocity.set(10, 0, 0);
      body.update(1.0);
      expect(body.position.x).toBeCloseTo(10, 1);
    });

    it('applies drag to slow velocity', () => {
      const body = new PhysicsBody({ drag: 1.0 });
      body.velocity.set(10, 0, 0);
      body.update(0.5);
      // After drag: v *= max(0, 1 - 1.0 * 0.5) = 0.5 => v = 5
      // But drag is applied before position integration in the same step
      // Actually: forces applied first, then drag, then position
      expect(body.velocity.x).toBeLessThan(10);
    });

    it('applies gravity when enabled', () => {
      const body = new PhysicsBody({ useGravity: true, drag: 0 });
      body.update(1.0);
      // Gravity is -9.81, applied as force: a = F/m * dt = -9.81 * 1 = -9.81
      expect(body.velocity.y).toBeCloseTo(-9.81, 0);
    });

    it('resets accumulated forces after update', () => {
      const body = new PhysicsBody();
      body.addForce(new THREE.Vector3(5, 0, 0));
      body.update(0.016);
      expect(body.forces.x).toBe(0);
      expect(body.forces.y).toBe(0);
    });

    it('does nothing when frozen', () => {
      const body = new PhysicsBody({ frozen: true });
      body.velocity.set(100, 0, 0);
      const startX = body.position.x;
      body.update(1.0);
      expect(body.position.x).toBe(startX);
    });
  });

  describe('relative forces', () => {
    it('addRelativeForce transforms force by rotation', () => {
      const body = new PhysicsBody();
      // Rotate 90 degrees around Y axis
      body.rotation.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
      body.addRelativeForce(new THREE.Vector3(0, 0, 1)); // local +Z
      // After 90° Y rotation, local +Z → world +X
      expect(body.forces.x).toBeCloseTo(1, 1);
      expect(body.forces.z).toBeCloseTo(0, 1);
    });

    it('addRelativeImpulse transforms impulse by rotation', () => {
      const body = new PhysicsBody({ mass: 1 });
      body.rotation.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
      body.addRelativeImpulse(new THREE.Vector3(0, 0, 1));
      expect(body.velocity.x).toBeCloseTo(1, 1);
      expect(body.velocity.z).toBeCloseTo(0, 1);
    });
  });

  describe('direction helpers', () => {
    it('getForwardDirection returns +Z by default (identity rotation)', () => {
      const body = new PhysicsBody();
      const fwd = body.getForwardDirection();
      expect(fwd.x).toBeCloseTo(0);
      expect(fwd.y).toBeCloseTo(0);
      expect(fwd.z).toBeCloseTo(1);
    });

    it('getRightDirection returns +X by default', () => {
      const body = new PhysicsBody();
      const right = body.getRightDirection();
      expect(right.x).toBeCloseTo(1);
    });

    it('getUpDirection returns +Y by default', () => {
      const body = new PhysicsBody();
      const up = body.getUpDirection();
      expect(up.y).toBeCloseTo(1);
    });
  });

  describe('mesh sync', () => {
    it('syncToMesh copies position and rotation to mesh', () => {
      const body = new PhysicsBody();
      body.position.set(1, 2, 3);
      body.rotation.setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.5);

      const mesh = new THREE.Object3D();
      body.syncToMesh(mesh);

      expect(mesh.position.x).toBe(1);
      expect(mesh.position.y).toBe(2);
      expect(mesh.position.z).toBe(3);
      expect(mesh.quaternion.y).toBeCloseTo(body.rotation.y);
    });

    it('syncFromMesh copies mesh transform to body', () => {
      const body = new PhysicsBody();
      const mesh = new THREE.Object3D();
      mesh.position.set(5, 6, 7);

      body.syncFromMesh(mesh);
      expect(body.position.x).toBe(5);
      expect(body.position.y).toBe(6);
      expect(body.position.z).toBe(7);
    });
  });
});
