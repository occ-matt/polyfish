/**
 * Quick test to verify VFXManager imports and instantiation work
 */
import * as THREE from 'three';
import VFXManager from './src/rendering/VFXManager.js';

try {
  console.log('Testing VFXManager...');

  // Create a mock scene
  const scene = new THREE.Scene();

  // Instantiate VFXManager
  const vfxManager = new VFXManager(scene);
  console.log('✓ VFXManager created successfully');

  // Test emit methods
  const testPos = new THREE.Vector3(0, 0, 0);
  vfxManager.emitFoodEaten(testPos);
  console.log('✓ emitFoodEaten works');

  vfxManager.emitCreatureEaten(testPos);
  console.log('✓ emitCreatureEaten works');

  vfxManager.emitPlantEaten(testPos);
  console.log('✓ emitPlantEaten works');

  vfxManager.emitBirth(testPos);
  console.log('✓ emitBirth works');

  vfxManager.emitDeath(testPos);
  console.log('✓ emitDeath works');

  vfxManager.emitDecompose(testPos);
  console.log('✓ emitDecompose works');

  vfxManager.emitFoodDrop(testPos);
  console.log('✓ emitFoodDrop works');

  // Test update
  vfxManager.update(0.016);
  console.log('✓ update works');

  // Test VR mode
  vfxManager.setVRMode(true);
  console.log('✓ setVRMode works');

  console.log('\nAll VFXManager tests passed!');
  process.exit(0);
} catch (error) {
  console.error('✗ Test failed:', error);
  process.exit(1);
}
