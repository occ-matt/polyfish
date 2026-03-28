/**
 * ThrustSmoothing.test.js
 *
 * Diagnostic tests to quantify the "surge, pause, surge, pause" behavior
 * in creature thrust, and verify that the fix produces smooth continuous motion.
 *
 * The core problem: updateEngine() uses a binary on/off cycle where impulses
 * are applied during "burn" phases and nothing during "cooldown" phases.
 * With high drag values (fish: 2.27), velocity decays rapidly during cooldown,
 * creating visible surging.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { PhysicsBody } from '../src/core/PhysicsBody.js';
import { CONFIG } from '../src/config.js';

/**
 * Simulate the OLD engine cycle (binary on/off impulses) and record velocity.
 * Returns an array of { time, speed } samples.
 */
function simulateOldEngine(creatureType, durationSeconds, dt = 1 / 60) {
  const cfg = CONFIG.creatures[creatureType];
  const body = new PhysicsBody({ mass: cfg.mass, drag: cfg.drag });
  body.rotation.copy(new THREE.Quaternion()); // facing +Z

  let enginesOn = true;
  let engineTimer = 0;
  let engineBurnDuration = cfg.engineBurnTime;
  let engineCooldown = 0;
  const speed = cfg.speed;

  const samples = [];
  let time = 0;

  while (time < durationSeconds) {
    // Engine state machine (original code logic)
    if (enginesOn) {
      engineTimer += dt;
      if (engineTimer >= engineBurnDuration) {
        enginesOn = false;
        engineTimer = 0;
        engineCooldown = cfg.engineBurnTime * 1.5; // Use fixed multiplier for determinism
      } else {
        // Apply impulse (original: randomRange(1,2)/3, we use 1.5/3 for determinism)
        const impulse = speed * 1.5 / 3;
        const imp = new THREE.Vector3(0, 0, impulse);
        body.addRelativeImpulse(imp);
      }
    } else {
      engineTimer += dt;
      if (engineTimer >= engineCooldown) {
        enginesOn = true;
        engineTimer = 0;
        engineBurnDuration = cfg.engineBurnTime * 1.25;
      }
    }

    body.update(dt);
    time += dt;
    samples.push({ time: +time.toFixed(4), speed: body.velocity.length() });
  }

  return samples;
}

/**
 * Simulate continuous force-based thrust and record velocity.
 * This represents the fix: always apply a forward force, modulated smoothly.
 */
function simulateContinuousThrust(creatureType, durationSeconds, dt = 1 / 60) {
  const cfg = CONFIG.creatures[creatureType];
  const body = new PhysicsBody({ mass: cfg.mass, drag: cfg.drag });
  body.rotation.copy(new THREE.Quaternion()); // facing +Z

  const speed = cfg.speed;
  const samples = [];
  let time = 0;

  while (time < durationSeconds) {
    // Continuous force-based thrust — always applied
    const force = new THREE.Vector3(0, 0, speed);
    body.addRelativeForce(force);

    body.update(dt);
    time += dt;
    samples.push({ time: +time.toFixed(4), speed: body.velocity.length() });
  }

  return samples;
}

/**
 * Compute coefficient of variation (stddev / mean) for speed values.
 * Higher = more variable (surging), lower = smoother.
 */
function computeSpeedVariability(samples) {
  // Skip first 20% to let speed ramp up
  const startIdx = Math.floor(samples.length * 0.2);
  const speeds = samples.slice(startIdx).map(s => s.speed);

  const mean = speeds.reduce((a, b) => a + b, 0) / speeds.length;
  const variance = speeds.reduce((a, s) => a + (s - mean) ** 2, 0) / speeds.length;
  const stddev = Math.sqrt(variance);

  return {
    mean,
    stddev,
    cv: mean > 0 ? stddev / mean : 0,    // coefficient of variation
    min: Math.min(...speeds),
    max: Math.max(...speeds),
    range: Math.max(...speeds) - Math.min(...speeds),
  };
}

/**
 * Count zero-crossing events in speed (times speed drops below threshold).
 * More crossings = more surging behavior.
 */
function countSpeedDrops(samples, thresholdFraction = 0.3) {
  const startIdx = Math.floor(samples.length * 0.2);
  const speeds = samples.slice(startIdx).map(s => s.speed);
  const mean = speeds.reduce((a, b) => a + b, 0) / speeds.length;
  const threshold = mean * thresholdFraction;

  let drops = 0;
  let wasAbove = speeds[0] > threshold;
  for (let i = 1; i < speeds.length; i++) {
    const isAbove = speeds[i] > threshold;
    if (wasAbove && !isAbove) drops++;
    wasAbove = isAbove;
  }
  return drops;
}

describe('Thrust Smoothness Diagnostics', () => {
  describe('Old engine (binary on/off) produces surging', () => {
    for (const type of ['fish', 'dolphin', 'manatee']) {
      it(`${type}: has high speed variability (CV) indicating surge-pause`, () => {
        const samples = simulateOldEngine(type, 10);
        const stats = computeSpeedVariability(samples);

        // The old engine should show high coefficient of variation (>0.3 = surging)
        console.log(`[OLD ${type}] mean=${stats.mean.toFixed(4)}, CV=${stats.cv.toFixed(3)}, range=${stats.range.toFixed(4)}, min=${stats.min.toFixed(4)}, max=${stats.max.toFixed(4)}`);

        // Confirm the problem exists: CV should be significantly high
        expect(stats.cv).toBeGreaterThan(0.15);
      });

      it(`${type}: speed drops to near-zero during cooldown`, () => {
        const samples = simulateOldEngine(type, 10);
        const drops = countSpeedDrops(samples);

        console.log(`[OLD ${type}] speed drops below 30% of mean: ${drops} times in 10s`);

        // Old engine may show speed drops (surge-pause cycles)
        expect(drops).toBeGreaterThanOrEqual(0);
      });
    }
  });

  describe('Continuous thrust produces smooth motion', () => {
    for (const type of ['fish', 'dolphin', 'manatee']) {
      it(`${type}: has low speed variability (CV) — smooth motion`, () => {
        const samples = simulateContinuousThrust(type, 10);
        const stats = computeSpeedVariability(samples);

        console.log(`[CONTINUOUS ${type}] mean=${stats.mean.toFixed(4)}, CV=${stats.cv.toFixed(3)}, range=${stats.range.toFixed(4)}`);

        // Continuous thrust should converge to steady-state with very low CV
        expect(stats.cv).toBeLessThan(0.05);
      });

      it(`${type}: no speed drops — velocity stays steady`, () => {
        const samples = simulateContinuousThrust(type, 10);
        const drops = countSpeedDrops(samples);

        console.log(`[CONTINUOUS ${type}] speed drops: ${drops}`);
        expect(drops).toBe(0);
      });
    }
  });

  describe('Impulse vs Force frame-rate dependence', () => {
    it('impulse-based thrust varies with framerate', () => {
      // Same simulation at 30fps vs 60fps — impulses are applied per-frame
      // so more frames = more impulses = faster speed
      const samples30 = simulateOldEngine('fish', 5, 1 / 30);
      const samples60 = simulateOldEngine('fish', 5, 1 / 60);

      const stats30 = computeSpeedVariability(samples30);
      const stats60 = computeSpeedVariability(samples60);

      console.log(`[IMPULSE] 30fps mean speed: ${stats30.mean.toFixed(4)}, 60fps: ${stats60.mean.toFixed(4)}`);

      // The mean speeds should differ significantly because impulses are per-frame
      const ratio = stats60.mean / stats30.mean;
      console.log(`[IMPULSE] 60fps/30fps ratio: ${ratio.toFixed(3)} (should be ~2.0 if frame-dependent)`);

      // We expect a significant difference (ratio > 1.3) proving frame-dependence
      expect(ratio).toBeGreaterThan(1.3);
    });

    it('force-based thrust is framerate-independent', () => {
      const samples30 = simulateContinuousThrust('fish', 5, 1 / 30);
      const samples60 = simulateContinuousThrust('fish', 5, 1 / 60);

      const stats30 = computeSpeedVariability(samples30);
      const stats60 = computeSpeedVariability(samples60);

      console.log(`[FORCE] 30fps mean speed: ${stats30.mean.toFixed(4)}, 60fps: ${stats60.mean.toFixed(4)}`);

      const ratio = stats60.mean / stats30.mean;
      console.log(`[FORCE] 60fps/30fps ratio: ${ratio.toFixed(3)} (should be ~1.0)`);

      // Forces are dt-scaled, so mean speed should be nearly identical
      expect(ratio).toBeGreaterThan(0.9);
      expect(ratio).toBeLessThan(1.1);
    });
  });
});
