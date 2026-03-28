import * as THREE from 'three';

const _loader = new THREE.TextureLoader();
const _cache = new Map();

/**
 * Load a texture once and cache it for reuse across systems.
 * @param {string} url - Texture URL
 * @returns {THREE.Texture}
 */
export function getSharedTexture(url) {
  if (_cache.has(url)) return _cache.get(url);
  const tex = _loader.load(url);
  _cache.set(url, tex);
  return tex;
}
