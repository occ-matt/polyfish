import * as THREE from 'three';

/**
 * Returns a random float between min and max (inclusive)
 */
export function randomRange(min, max) {
  return Math.random() * (max - min) + min;
}

/**
 * Returns a random integer between min and max (inclusive)
 */
export function randomRangeInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Returns a random point inside a sphere of given radius
 */
export function randomInsideSphere(radius) {
  const u = Math.random();
  const v = Math.random();
  const w = Math.random();

  const r = radius * Math.cbrt(u);
  const theta = 2 * Math.PI * v;
  const phi = Math.acos(2 * w - 1);

  const x = r * Math.sin(phi) * Math.cos(theta);
  const y = r * Math.sin(phi) * Math.sin(theta);
  const z = r * Math.cos(phi);

  return new THREE.Vector3(x, y, z);
}

/**
 * Returns a random point on the surface of a sphere of given radius
 */
export function randomOnSphere(radius) {
  const u = Math.random();
  const v = Math.random();

  const theta = 2 * Math.PI * u;
  const phi = Math.acos(2 * v - 1);

  const x = radius * Math.sin(phi) * Math.cos(theta);
  const y = radius * Math.sin(phi) * Math.sin(theta);
  const z = radius * Math.cos(phi);

  return new THREE.Vector3(x, y, z);
}

/**
 * Clamps a value between min and max
 */
export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/**
 * Linear interpolation between a and b
 */
export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/**
 * Ease-in-out quadratic interpolation
 * Smooth acceleration and deceleration
 */
export function easeInOutQuad(t) {
  return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
}

/**
 * Ease-out cubic interpolation (fast start, gentle stop).
 * Used for spawn scale-in, grow/shrink animations, and camera transitions.
 * @param {number} t - Progress 0..1
 * @returns {number} Eased value 0..1
 */
export function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

/**
 * Squared distance between two {x,y,z} objects.
 * Avoids the sqrt cost of full distance when only comparison is needed.
 * @param {Object} a - First position with x, y, z
 * @param {Object} b - Second position with x, y, z
 * @returns {number} Squared Euclidean distance
 */
export function distSq(a, b) {
  const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

/**
 * Returns a random unit direction on a sphere (uniform distribution).
 * Writes x, y, z onto a reusable scratch object to avoid GC pressure
 * in hot loops (particle systems, etc.).
 * @param {Object} [target] - Object with x, y, z properties. Defaults to internal scratch.
 * @returns {Object} The target with x, y, z set to the random direction.
 */
const _sphereDir = { x: 0, y: 0, z: 0 };
export function randomSphericalDirection(target = _sphereDir) {
  const theta = Math.random() * Math.PI * 2;
  const phi = Math.acos(2 * Math.random() - 1);
  const sinPhi = Math.sin(phi);
  target.x = sinPhi * Math.cos(theta);
  target.y = sinPhi * Math.sin(theta);
  target.z = Math.cos(phi);
  return target;
}
