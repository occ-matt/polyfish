import { describe, it, expect } from 'vitest';
import {
  getTerrainHeight,
  checkTerrainCollision,
  TERRAIN_Y,
  TERRAIN_SIZE,
  TERRAIN_CENTER_X,
  TERRAIN_CENTER_Z,
} from '../src/utils/Terrain.js';

describe('Terrain', () => {
  it('exports correct constants', () => {
    expect(TERRAIN_Y).toBe(-7.81);
    expect(TERRAIN_SIZE).toBe(512);
    expect(TERRAIN_CENTER_X).toBe(31.74);
    expect(TERRAIN_CENTER_Z).toBe(-105.62);
  });

  describe('getTerrainHeight', () => {
    it('returns a height near base Y at terrain center', () => {
      const h = getTerrainHeight(TERRAIN_CENTER_X, TERRAIN_CENTER_Z);
      // sin(31.74*0.05)*cos(-105.62*0.04)*2 + (-7.81)
      expect(h).toBeGreaterThan(-10);
      expect(h).toBeLessThan(-5);
    });

    it('returns a value within expected range for origin', () => {
      const h = getTerrainHeight(0, 0);
      // Height formula: sin(x*0.05)*cos(z*0.04)*2 - 7.81
      // Range: [-9.81, -5.81]
      expect(h).toBeGreaterThanOrEqual(-9.82);
      expect(h).toBeLessThanOrEqual(-5.80);
    });

    it('clamps to terrain bounds for far-away positions', () => {
      const h1 = getTerrainHeight(10000, 10000);
      // Should be clamped to edge values, still in reasonable range
      expect(h1).toBeGreaterThan(-12);
      expect(h1).toBeLessThan(-3);
    });
  });

  describe('checkTerrainCollision', () => {
    it('detects collision when below terrain surface', () => {
      const surfaceY = getTerrainHeight(0, 0);
      const result = checkTerrainCollision(0, surfaceY - 1, 0);
      expect(result.grounded).toBe(true);
      expect(result.surfaceY).toBeCloseTo(surfaceY);
    });

    it('no collision when above terrain surface', () => {
      const surfaceY = getTerrainHeight(0, 0);
      const result = checkTerrainCollision(0, surfaceY + 5, 0);
      expect(result.grounded).toBe(false);
    });

    it('collision exactly at surface level', () => {
      const surfaceY = getTerrainHeight(5, 5);
      const result = checkTerrainCollision(5, surfaceY, 5);
      expect(result.grounded).toBe(true);
    });
  });
});
