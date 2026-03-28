import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { ProceduralRotation } from '../src/systems/ProceduralAnim.js';

describe('ProceduralRotation', () => {
  function makeTarget() {
    return new THREE.Object3D();
  }

  it('stores rest quaternion on construction', () => {
    const target = makeTarget();
    target.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.5);
    const pr = new ProceduralRotation(target, {});
    expect(pr.restQuaternion.equals(target.quaternion)).toBe(true);
  });

  it('oscillates the target quaternion during update', () => {
    const target = makeTarget();
    const initial = target.quaternion.clone();
    const pr = new ProceduralRotation(target, {
      frequency: 1.0,
      amplitude: 1.0,
      rotationLimit: 30,
    });

    pr.update(0.25); // quarter period
    // Quaternion should have changed from initial rest pose
    expect(target.quaternion.equals(initial)).toBe(false);
  });

  it('stop() restores rest pose', () => {
    const target = makeTarget();
    const pr = new ProceduralRotation(target, {
      frequency: 1.0,
      amplitude: 1.0,
      rotationLimit: 30,
    });

    const restCopy = pr.restQuaternion.clone();
    pr.update(0.5);
    pr.stop();

    expect(target.quaternion.x).toBeCloseTo(restCopy.x, 5);
    expect(target.quaternion.y).toBeCloseTo(restCopy.y, 5);
    expect(target.quaternion.z).toBeCloseTo(restCopy.z, 5);
    expect(target.quaternion.w).toBeCloseTo(restCopy.w, 5);
  });

  it('startMoving() sets target intensity to 1', () => {
    const target = makeTarget();
    const pr = new ProceduralRotation(target, {
      frequency: 0.2,
      amplitude: 0.6,
    });

    pr.startMoving();
    expect(pr.targetIntensity).toBe(1);
  });

  it('stopMoving() restores original values', () => {
    const target = makeTarget();
    const pr = new ProceduralRotation(target, {
      frequency: 0.2,
      amplitude: 0.6,
    });

    pr.startMoving();
    pr.stopMoving();
    expect(pr.amplitude).toBe(0.6);
    expect(pr.frequency).toBe(0.2);
  });

  it('does nothing when disabled', () => {
    const target = makeTarget();
    const pr = new ProceduralRotation(target, {
      frequency: 1.0,
      amplitude: 1.0,
      rotationLimit: 30,
    });

    pr.enabled = false;
    const before = target.quaternion.clone();
    pr.update(1.0);
    expect(target.quaternion.equals(before)).toBe(true);
  });
});
