import { describe, it, expect } from 'vitest';
import {
  randomRange,
  randomRangeInt,
  randomInsideSphere,
  randomOnSphere,
  clamp,
  lerp,
  easeInOutQuad,
} from '../src/utils/MathUtils.js';

describe('MathUtils', () => {
  describe('clamp', () => {
    it('returns value when within range', () => {
      expect(clamp(5, 0, 10)).toBe(5);
    });

    it('clamps to min', () => {
      expect(clamp(-5, 0, 10)).toBe(0);
    });

    it('clamps to max', () => {
      expect(clamp(15, 0, 10)).toBe(10);
    });

    it('handles equal min and max', () => {
      expect(clamp(5, 3, 3)).toBe(3);
    });
  });

  describe('lerp', () => {
    it('returns a at t=0', () => {
      expect(lerp(10, 20, 0)).toBe(10);
    });

    it('returns b at t=1', () => {
      expect(lerp(10, 20, 1)).toBe(20);
    });

    it('returns midpoint at t=0.5', () => {
      expect(lerp(0, 100, 0.5)).toBe(50);
    });

    it('extrapolates beyond t=1', () => {
      expect(lerp(0, 10, 2)).toBe(20);
    });
  });

  describe('easeInOutQuad', () => {
    it('returns 0 at t=0', () => {
      expect(easeInOutQuad(0)).toBe(0);
    });

    it('returns 1 at t=1', () => {
      expect(easeInOutQuad(1)).toBe(1);
    });

    it('returns 0.5 at t=0.5', () => {
      expect(easeInOutQuad(0.5)).toBe(0.5);
    });

    it('eases in for first half (slower start)', () => {
      expect(easeInOutQuad(0.25)).toBeLessThan(0.25);
    });

    it('eases out for second half (slower end)', () => {
      expect(easeInOutQuad(0.75)).toBeGreaterThan(0.75);
    });
  });

  describe('randomRange', () => {
    it('returns values within [min, max]', () => {
      for (let i = 0; i < 100; i++) {
        const val = randomRange(5, 10);
        expect(val).toBeGreaterThanOrEqual(5);
        expect(val).toBeLessThanOrEqual(10);
      }
    });

    it('handles negative ranges', () => {
      for (let i = 0; i < 50; i++) {
        const val = randomRange(-10, -5);
        expect(val).toBeGreaterThanOrEqual(-10);
        expect(val).toBeLessThanOrEqual(-5);
      }
    });
  });

  describe('randomRangeInt', () => {
    it('returns integers within [min, max]', () => {
      for (let i = 0; i < 100; i++) {
        const val = randomRangeInt(1, 5);
        expect(Number.isInteger(val)).toBe(true);
        expect(val).toBeGreaterThanOrEqual(1);
        expect(val).toBeLessThanOrEqual(5);
      }
    });
  });

  describe('randomInsideSphere', () => {
    it('returns vectors within radius', () => {
      for (let i = 0; i < 50; i++) {
        const v = randomInsideSphere(5);
        expect(v.length()).toBeLessThanOrEqual(5.001); // small epsilon
      }
    });

    it('returns THREE.Vector3 instances', () => {
      const v = randomInsideSphere(1);
      expect(v).toHaveProperty('x');
      expect(v).toHaveProperty('y');
      expect(v).toHaveProperty('z');
    });
  });

  describe('randomOnSphere', () => {
    it('returns vectors at the given radius', () => {
      for (let i = 0; i < 50; i++) {
        const v = randomOnSphere(10);
        expect(v.length()).toBeCloseTo(10, 1);
      }
    });
  });
});
