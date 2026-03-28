/**
 * ModelLoader — preloads GLB models and provides clone factories.
 * Uses Three.js GLTFLoader to load binary glTF files exported from Blender.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { createIBLMaterial, createColorMaterial } from '../rendering/IBLMaterial.js';

const loader = new GLTFLoader();
const cache = {};

/**
 * Load a single GLB file. Returns the full GLTF result.
 */
function loadGLB(url) {
  return new Promise((resolve, reject) => {
    loader.load(
      url,
      (gltf) => resolve(gltf),
      undefined,
      (err) => reject(new Error(`Failed to load ${url}: ${err.message || err}`))
    );
  });
}

/**
 * Prepare a loaded model: apply IBL material to all meshes, enable vertex colors
 * if the geometry has them, and optionally set flat shading.
 */
function prepareMesh(scene) {
  scene.traverse((child) => {
    if (child.isMesh) {
      const hasVertexColors = child.geometry.attributes.color != null;
      if (hasVertexColors) {
        child.material = createIBLMaterial({ flatShading: true });
      } else {
        // Keep original material color if available, apply our style
        const origColor = child.material.color ? child.material.color.getHex() : 0x888888;
        child.material = createColorMaterial(origColor, { flatShading: true });
      }
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });
}

/**
 * Deep clone a loaded GLTF scene, preserving skeleton bindings and sharing materials.
 * Uses SkeletonUtils.clone if the mesh has skinning.
 * Materials are NOT cloned — all instances share the same material per mesh,
 * reducing memory and shader program count.
 */
function cloneModel(source, modelName = null) {
  // Check if model has skinned meshes
  let hasSkin = false;
  source.traverse((child) => {
    if (child.isSkinnedMesh) hasSkin = true;
  });

  let clone;
  if (hasSkin) {
    // Manual skeleton-aware clone
    clone = skeletonClone(source);
  } else {
    clone = source.clone(true);
  }

  // After cloning, restore shared material references instead of using cloned materials.
  // This ensures all instances share the same material per mesh type.
  // Build lists of source and clone meshes for correspondence mapping.
  const sourceMeshes = [];
  const cloneMeshes = [];
  source.traverse((child) => {
    if (child.isMesh) sourceMeshes.push(child);
  });
  clone.traverse((child) => {
    if (child.isMesh) cloneMeshes.push(child);
  });

  // Replace cloned materials with shared source materials
  for (let i = 0; i < cloneMeshes.length && i < sourceMeshes.length; i++) {
    cloneMeshes[i].material = sourceMeshes[i].material;
  }

  return clone;
}

/**
 * Skeleton-aware deep clone (equivalent to SkeletonUtils.clone).
 * Clones the hierarchy, rebuilds skeletons, and rebinds skinned meshes.
 */
function skeletonClone(source) {
  const cloneLookup = new Map();
  const clone = source.clone(true);

  // Build a mapping from source objects to clone objects by traversal order
  const sourceObjects = [];
  const cloneObjects = [];
  source.traverse((obj) => sourceObjects.push(obj));
  clone.traverse((obj) => cloneObjects.push(obj));

  for (let i = 0; i < sourceObjects.length; i++) {
    cloneLookup.set(sourceObjects[i], cloneObjects[i]);
  }

  // Rebind skinned meshes — copy bindMatrix from source (NOT child.matrixWorld,
  // which is stale/identity since the clone hasn't been added to the scene yet).
  clone.traverse((child) => {
    if (child.isSkinnedMesh) {
      const sourceChild = sourceObjects[cloneObjects.indexOf(child)];
      if (sourceChild && sourceChild.skeleton) {
        const sourceBones = sourceChild.skeleton.bones;
        const cloneBones = sourceBones.map((bone) => {
          const cloneBone = cloneLookup.get(bone);
          return cloneBone || bone;
        });
        child.skeleton = new THREE.Skeleton(
          cloneBones,
          sourceChild.skeleton.boneInverses.map((m) => m.clone())
        );
        // Use the SOURCE mesh's bind matrix — it was computed when the model
        // was loaded with the correct world transforms (including Armature's
        // +90°X rotation from Blender→glTF coordinate conversion).
        child.bind(child.skeleton, sourceChild.bindMatrix);
      }
      // Skinned meshes often have stale bounding spheres after clone/rebind,
      // which can cause incorrect frustum culling. Disable it for safety.
      child.frustumCulled = false;
    }
  });

  return clone;
}

/**
 * Model manifest: maps logical names to GLB file paths.
 */
const MODEL_MANIFEST = {
  fish: '/models/fish_rigged.glb',
  dolphin: '/models/dolphin_rigged.glb',
  manatee: '/models/manatee_rigged.glb',
  kelp: '/models/kelp_rigged.glb',
  food: '/models/sphere_fancy.glb',
  foodAlt: '/models/pointy_thing_02.glb',
  logo: '/models/polyFish_logo.glb',
};

/**
 * Preload all models. Call once during init, before creating pools.
 * Returns a map of { name: preparedScene }.
 * Missing models are warned but don't block — fallback to null.
 */
export async function preloadModels(names = null) {
  const toLoad = names || Object.keys(MODEL_MANIFEST);
  const results = {};

  const promises = toLoad.map(async (name) => {
    const url = MODEL_MANIFEST[name];
    if (!url) {
      console.warn(`[ModelLoader] No manifest entry for: ${name}`);
      results[name] = null;
      return;
    }
    try {
      const gltf = await loadGLB(url);
      prepareMesh(gltf.scene);
      // Force world matrix computation so skinned meshes have correct
      // bindMatrix values (needed for skeleton-aware cloning later).
      gltf.scene.updateMatrixWorld(true);
      cache[name] = gltf.scene;
      results[name] = gltf.scene;
      console.log(`[ModelLoader] Loaded: ${name} (${url})`);
    } catch (err) {
      console.warn(`[ModelLoader] Could not load ${name}: ${err.message}. Will use placeholder.`);
      results[name] = null;
    }
  });

  await Promise.all(promises);
  return results;
}

/**
 * Get a clone of a preloaded model by name.
 * Materials are SHARED across all clones (not cloned per instance).
 * This reduces GPU memory and shader program count significantly.
 * Returns null if the model wasn't loaded (caller should use placeholder).
 */
export function getModelClone(name) {
  const source = cache[name];
  if (!source) return null;
  return cloneModel(source, name);
}

/**
 * Get the cached source model (for in-place modification like procedural re-rigging).
 * @param {string} name — model name from manifest
 * @returns {THREE.Object3D|null}
 */
export function getSourceModel(name) {
  return cache[name] || null;
}

/**
 * Check if a model was successfully loaded.
 */
export function hasModel(name) {
  return cache[name] != null;
}
