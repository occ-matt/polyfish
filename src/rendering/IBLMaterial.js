import * as THREE from 'three';

/**
 * IBLMaterial
 * Factory functions for creating physically-based materials with IBL support.
 * Simulates the vertex-colored underwater appearance of the original Unity shader.
 * Includes material caching to reduce redundant material instances.
 */

// Material cache: keyed by material parameter hash
const materialCache = new Map();

/**
 * Generate a cache key from material parameters
 * @param {string} type - 'ibl' or 'color'
 * @param {Object} options - Material options
 * @returns {string} Cache key
 */
function generateCacheKey(type, options) {
  const roughness = options.roughness ?? (type === 'ibl' ? 0.85 : 0.7);
  const metalness = options.metalness ?? (type === 'ibl' ? 0.05 : 0.1);
  const envMapIntensity = options.envMapIntensity ?? (type === 'ibl' ? 1.2 : 1.0);
  const hasVertexColors = type === 'ibl';
  const color = type === 'color' ? options.color ?? '0xffffff' : 'vc';

  return `${type}|${hasVertexColors ? 'vc' : 'novc'}|r${roughness}|m${metalness}|env${envMapIntensity}|c${color}`;
}

/**
 * Create a vertex-colored IBL material for low-poly meshes
 * Uses MeshStandardMaterial with vertex colors and environment map for IBL
 * Caches materials to avoid redundant instances.
 * @param {Object} options - Material options (roughness, metalness, envMapIntensity, etc.)
 * @returns {THREE.MeshStandardMaterial}
 */
export function createIBLMaterial(options = {}) {
  const cacheKey = generateCacheKey('ibl', options);

  // Return cached material if it exists
  if (materialCache.has(cacheKey)) {
    return materialCache.get(cacheKey);
  }

  // Create new material
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: options.roughness ?? 0.85,
    metalness: options.metalness ?? 0.05,
    envMapIntensity: options.envMapIntensity ?? 1.2,
    flatShading: true, // Low-poly aesthetic
    ...options,
  });

  // Cache and return
  materialCache.set(cacheKey, material);
  return material;
}

/**
 * Create a color-only material for entities without vertex colors
 * Caches materials to avoid redundant instances.
 * @param {THREE.Color | string | number} color - Material color
 * @param {Object} options - Material options
 * @returns {THREE.MeshStandardMaterial}
 */
export function createColorMaterial(color, options = {}) {
  const optionsWithColor = { ...options, color };
  const cacheKey = generateCacheKey('color', optionsWithColor);

  // Return cached material if it exists
  if (materialCache.has(cacheKey)) {
    return materialCache.get(cacheKey);
  }

  // Create new material
  const material = new THREE.MeshStandardMaterial({
    color,
    roughness: options.roughness ?? 0.7,
    metalness: options.metalness ?? 0.1,
    envMapIntensity: options.envMapIntensity ?? 1.0,
    flatShading: true,
    ...options,
  });

  // Cache and return
  materialCache.set(cacheKey, material);
  return material;
}

/**
 * Clear the material cache
 * Call this for cleanup if needed (e.g., on scene reset)
 */
export function clearMaterialCache() {
  materialCache.clear();
}
