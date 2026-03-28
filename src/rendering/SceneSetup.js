/**
 * SceneSetup - Terrain and water surface creation.
 * Extracted from main.js to reduce file size.
 */
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { applyCaustics } from './CausticShader.js';
import waterSurface from './WaterSurface.js';
import { getTerrainHeight, TERRAIN_SIZE } from '../utils/Terrain.js';
import GS from '../core/GameState.js';

/**
 * Unity terrain: 512x512 at position (-224.26, -7.81, -150.38), scale (1,1,1).
 * Three.js center (Z-flipped): (31.74, -7.81, -105.62).
 */
export function createPlaceholderTerrain(scene, useHiResTerrain) {
  const size = 512;
  const segments = useHiResTerrain ? 200 : 80;
  let geo = new THREE.PlaneGeometry(size, size, segments, segments);
  geo.rotateX(-Math.PI / 2);

  // Apply height displacement before converting to non-indexed
  const posAttr = geo.attributes.position;
  for (let i = 0; i < posAttr.count; i++) {
    const x = posAttr.getX(i);
    const z = posAttr.getZ(i);
    const worldX = x + 31.74;
    const worldZ = z + (-105.62);
    const y = Math.sin(worldX * 0.05) * Math.cos(worldZ * 0.04) * 2.0 + (-7.81);
    posAttr.setY(i, y);
  }

  // Non-indexed for faceted look
  geo = geo.toNonIndexed();
  geo.computeVertexNormals();

  // Muted olive-brown vertex colors with RGBA - edge fade to transparent
  const count = geo.attributes.position.count;
  const posArr = geo.attributes.position;
  const colors = new Float32Array(count * 4);
  const halfSize = size / 2;
  const fadeStart = 0.6;

  for (let f = 0; f < count; f += 3) {
    const r = 0.35 + Math.random() * 0.08;
    const g = 0.39 + Math.random() * 0.08;
    const b = 0.30 + Math.random() * 0.08;

    for (let v = 0; v < 3; v++) {
      const idx = f + v;
      const vx = posArr.getX(idx);
      const vz = posArr.getZ(idx);
      const distFrac = Math.max(Math.abs(vx), Math.abs(vz)) / halfSize;
      const alpha = distFrac < fadeStart
        ? 1.0
        : 1.0 - (distFrac - fadeStart) / (1.0 - fadeStart);

      colors[idx * 4]     = r;
      colors[idx * 4 + 1] = g;
      colors[idx * 4 + 2] = b;
      colors[idx * 4 + 3] = Math.max(0, alpha);
    }
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 4));

  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.9,
    metalness: 0.05,
    flatShading: true,
    transparent: true,
    depthWrite: true,
  });
  applyCaustics(mat);

  const terrain = new THREE.Mesh(geo, mat);
  terrain.receiveShadow = true;
  terrain.position.set(31.74, 0, -105.62);
  scene.add(terrain);
}

/**
 * Create the ocean surface - visible as a bright, rippling plane from below.
 */
export function createWaterSurface(scene, useHiResTerrain, useWaterAnim) {
  const size = 200;
  const segments = useHiResTerrain ? 120 : 50;
  let geo = new THREE.PlaneGeometry(size, size, segments, segments);
  geo.rotateX(Math.PI / 2);

  const posAttr = geo.attributes.position;
  for (let i = 0; i < posAttr.count; i++) {
    const jitterY = (Math.random() - 0.5) * 0.5;
    posAttr.setY(i, posAttr.getY(i) + jitterY);
    posAttr.setX(i, posAttr.getX(i) + (Math.random() - 0.5) * 0.4);
    posAttr.setZ(i, posAttr.getZ(i) + (Math.random() - 0.5) * 0.4);
  }

  geo = geo.toNonIndexed();
  geo.computeVertexNormals();

  const count = geo.attributes.position.count;
  const posArr = geo.attributes.position;
  const colors = new Float32Array(count * 4);
  const halfSize = size / 2;
  const fadeStart = 0.35;

  for (let f = 0; f < count; f += 3) {
    const r = 0.25 + Math.random() * 0.20;
    const g = 0.50 + Math.random() * 0.25;
    const b = 0.60 + Math.random() * 0.25;

    for (let v = 0; v < 3; v++) {
      const idx = f + v;
      const vx = posArr.getX(idx);
      const vz = posArr.getZ(idx);
      const distFrac = Math.max(Math.abs(vx), Math.abs(vz)) / halfSize;
      const alpha = distFrac < fadeStart
        ? 1.0
        : 1.0 - (distFrac - fadeStart) / (1.0 - fadeStart);

      colors[idx * 4]     = r;
      colors[idx * 4 + 1] = g;
      colors[idx * 4 + 2] = b;
      colors[idx * 4 + 3] = Math.max(0, alpha);
    }
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 4));

  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    metalness: 0.4,
    roughness: 0.15,
    transparent: true,
    opacity: 0.75,
    side: THREE.FrontSide,
    depthWrite: false,
    flatShading: true,
    envMapIntensity: 1.5,
  });

  GS.oceanSurfaceMesh = new THREE.Mesh(geo, mat);
  const waveAmp = 1.25 * CONFIG.waterSurface.noiseStrength;
  const microExtra = waveAmp * 0.18;
  GS.oceanSurfaceMesh.position.set(0, CONFIG.surfaceY + waveAmp + microExtra, 0);
  GS.oceanSurfaceMesh.renderOrder = 999;
  GS.oceanSurfaceMesh.layers.enable(1);
  scene.add(GS.oceanSurfaceMesh);

  const underLight = new THREE.DirectionalLight(0xaaddff, 2.5);
  underLight.position.set(0, -10, 0);
  underLight.target.position.set(0, 10, 0);
  underLight.layers.set(1);
  scene.add(underLight);
  scene.add(underLight.target);

  if (useWaterAnim) {
    waterSurface.register(GS.oceanSurfaceMesh);
  }
}
