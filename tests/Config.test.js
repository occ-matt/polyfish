import { describe, it, expect } from 'vitest';
import { CONFIG } from '../src/config.js';

describe('CONFIG', () => {
  it('has all three creature types defined', () => {
    expect(CONFIG.creatures.fish).toBeDefined();
    expect(CONFIG.creatures.dolphin).toBeDefined();
    expect(CONFIG.creatures.manatee).toBeDefined();
  });

  it('creature configs have required fields', () => {
    const requiredFields = [
      'speed', 'lookTime', 'engineBurnTime', 'foodTag',
      'foodToReproduce', 'mass', 'drag', 'mouthRadius', 'scale',
    ];
    for (const type of ['fish', 'dolphin', 'manatee']) {
      for (const field of requiredFields) {
        expect(CONFIG.creatures[type][field], `${type}.${field}`).toBeDefined();
      }
    }
  });

  it('food chain is correct (fish→food, dolphin→fish, manatee→plant)', () => {
    expect(CONFIG.creatures.fish.foodTag).toBe('food');
    expect(CONFIG.creatures.dolphin.foodTag).toBe('creature_fish');
    expect(CONFIG.creatures.manatee.foodTag).toBe('plant');
  });

  it('pool sizes are positive integers', () => {
    for (const [key, val] of Object.entries(CONFIG.poolSizes)) {
      expect(val, `poolSizes.${key}`).toBeGreaterThan(0);
      expect(Number.isInteger(val), `poolSizes.${key} is integer`).toBe(true);
    }
  });

  it('boundary values are sensible', () => {
    expect(CONFIG.boundary.radius).toBeGreaterThan(0);
    expect(CONFIG.boundary.yMin).toBeLessThan(CONFIG.boundary.yMax);
  });

  it('narration timeline is ordered', () => {
    const { intro, polyfishIntro, manateeIntro, dolphinIntro } = CONFIG.narration;
    expect(intro).toBeLessThan(polyfishIntro);
    expect(polyfishIntro).toBeLessThan(manateeIntro);
    expect(manateeIntro).toBeLessThan(dolphinIntro);
  });

  it('all creatures have metabolism enabled', () => {
    expect(CONFIG.creatures.fish.hasMetabolism).toBe(true);
    expect(CONFIG.creatures.dolphin.hasMetabolism).toBe(true);
    expect(CONFIG.creatures.manatee.hasMetabolism).toBe(true);
  });
});
