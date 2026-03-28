/**
 * Terrain height utility.
 * Must match the height formula used in main.js createPlaceholderTerrain().
 *
 * Unity terrain: 512×512 at position (-224.26, -7.81, -150.38).
 * Three.js (Z-flipped) center: (31.74, -7.81, -105.62).
 * Base height: -7.81 (Unity terrain Y position).
 *
 * Height formula:  y = sin(x * 0.05) * cos(z * 0.04) * 2.0 - 7.81
 * Range: roughly -9.81 to -5.81
 */

const TERRAIN_SIZE = 512;
const TERRAIN_HALF = TERRAIN_SIZE / 2;

// Unity terrain center in Three.js coordinates
const TERRAIN_CENTER_X = 31.74;
const TERRAIN_CENTER_Z = -105.62;
const TERRAIN_BASE_Y = -7.81;

/**
 * Get the terrain height at a given world (x, z) position.
 * Returns the Y value of the terrain surface at that point.
 * Outside the terrain bounds, returns the edge height.
 */
export function getTerrainHeight(x, z) {
  // Clamp to terrain bounds (world-space, accounting for terrain center offset)
  const localX = x - TERRAIN_CENTER_X;
  const localZ = z - TERRAIN_CENTER_Z;
  const cx = Math.max(-TERRAIN_HALF, Math.min(TERRAIN_HALF, localX)) + TERRAIN_CENTER_X;
  const cz = Math.max(-TERRAIN_HALF, Math.min(TERRAIN_HALF, localZ)) + TERRAIN_CENTER_Z;
  return Math.sin(cx * 0.05) * Math.cos(cz * 0.04) * 2.0 + TERRAIN_BASE_Y;
}

/** Terrain base Y (Unity terrain position Y). */
export const TERRAIN_Y = TERRAIN_BASE_Y;

/**
 * Check if a position is at or below the terrain surface.
 * Returns { grounded, surfaceY } where grounded is true if y <= surfaceY.
 */
export function checkTerrainCollision(x, y, z) {
  const surfaceY = getTerrainHeight(x, z);
  return {
    grounded: y <= surfaceY,
    surfaceY,
  };
}

/**
 * Compute the terrain surface normal at a given (x, z) via finite differences.
 * Returns a normalized THREE-compatible {x, y, z} object.
 */
export function getTerrainNormal(x, z) {
  const eps = 0.1;
  const hC = getTerrainHeight(x, z);
  const hX = getTerrainHeight(x + eps, z);
  const hZ = getTerrainHeight(x, z + eps);
  // Tangent vectors along X and Z
  // tX = (eps, hX-hC, 0), tZ = (0, hZ-hC, eps)
  // normal = cross(tZ, tX) then normalize
  const nx = -(hX - hC) / eps;
  const nz = -(hZ - hC) / eps;
  const ny = 1;
  const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
  return { x: nx / len, y: ny / len, z: nz / len };
}

/** Terrain size and center — useful for spawn bounds checks. */
export { TERRAIN_SIZE, TERRAIN_CENTER_X, TERRAIN_CENTER_Z };
