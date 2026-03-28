/**
 * NarrativeMode — the full ecosystem simulation with narration, staged spawning,
 * food chain, and population monitoring. This is the "main" experience.
 */
import * as THREE from 'three';
import { SceneMode } from './SceneMode.js';
import { CONFIG } from '../config.js';

export class NarrativeMode extends SceneMode {
  constructor() {
    super('narrative');
  }

  async enter(ctx) {
    // Raycast down to find terrain height at camera XZ
    const camX = 0, camZ = 6.44;
    const raycaster = new THREE.Raycaster(
      new THREE.Vector3(camX, 50, camZ),
      new THREE.Vector3(0, -1, 0)
    );
    const meshes = [];
    ctx.scene.traverse(child => { if (child.isMesh) meshes.push(child); });
    const hits = raycaster.intersectObjects(meshes, false);
    const terrainY = hits.length > 0 ? hits[0].point.y : -7.81;
    const eyeHeight = 0.5;

    ctx.camera.position.set(camX, terrainY + eyeHeight, camZ);
    ctx.cameraController.controls.target.set(camX, terrainY + eyeHeight, 0);
    ctx.cameraController.controls.autoRotate = false;

    // Show narrative HUD
    const hud = document.getElementById('hud');
    if (hud) hud.style.display = '';

    // Hide mode-specific UIs
    this._hideEditorUI();
    this._hideViewerUI();

    // Restart the full ecosystem (handles narration, music, staged spawns, initial seed)
    ctx.restartEcosystem();
  }

  async exit(ctx) {
    // Fully stop all audio (music + narration)
    ctx.audioManager.stopAll();

    // Hide narrative HUD
    const hud = document.getElementById('hud');
    if (hud) hud.style.display = 'none';
  }

  update(dt, elapsed, ctx) {
    // All narrative updates are handled in main.js gameLoop
    // (creatures, food, seeds, plants, spawners, narration, population monitor)
  }

  handleKeyDown(e, ctx) {
    if (e.key === 'Backspace') {
      // NarrativeMode: manual restart triggered
      ctx.audioManager.fadeMusic(0, 4);
      ctx.audioManager.playNarration('outro');
      ctx.fadeOverlay.fadeOut(CONFIG.fadeTime).then(() => {
        ctx.restartEcosystem();
        ctx.fadeOverlay.fadeIn(CONFIG.fadeTime);
      });
      return true;
    }
    return false;
  }

  _hideEditorUI() {
    const el = document.getElementById('editor-ui');
    if (el) el.style.display = 'none';
  }

  _hideViewerUI() {
    const el = document.getElementById('viewer-ui');
    if (el) el.style.display = 'none';
  }
}
