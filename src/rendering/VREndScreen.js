/**
 * VREndScreen - In-VR end-of-simulation sequence.
 *
 * When the fish population reaches 0, this shows a cinematic ending:
 *   1. A dark tint fades in over the scene (inside-out sphere on camera)
 *   2. "The PolyFish have died." fades in at eye level
 *   3. The panel scrolls upward - the death message rises out of view while
 *      credits scroll up from below on the same dark canvas (like film credits)
 *   4. Fade to black, then reload the page (exits VR, restarts)
 *
 * Everything is drawn on a single tall canvas/panel so the death message and
 * credits flow as one continuous piece. The panel is placed in world space
 * (not locked to camera) so it feels like a floating screen in the environment.
 */
import * as THREE from 'three';

const CREDITS_LINES = [
  { text: 'PolyFish', style: 'logo' },
  { text: 'Remastered', style: 'subtitle' },
  { text: '', style: 'spacer' },
  { text: 'Created by', style: 'role' },
  { text: 'Matt Scott', style: 'name' },
  { text: '', style: 'spacer' },
  { text: 'Narrated by', style: 'role' },
  { text: 'Phil Scott', style: 'name' },
  { text: '', style: 'spacer' },
  { text: 'Music', style: 'role' },
  { text: '"Field of Fireflies" by Purrple Cat', style: 'name' },
  { text: 'purrplecat.com - CC BY-SA 3.0', style: 'detail' },
  { text: '"Wonders" by Alex-Productions', style: 'name' },
  { text: 'onsound.eu - CC BY 3.0', style: 'detail' },
  { text: '"Once Upon a Time" by Alex-Productions', style: 'name' },
  { text: 'onsound.eu - CC BY 3.0', style: 'detail' },
  { text: '', style: 'spacer' },
  { text: 'Sound Effects & Ambience', style: 'role' },
  { text: 'GameMaster Audio', style: 'name' },
  { text: '', style: 'spacer' },
  { text: 'Built With', style: 'role' },
  { text: 'Three.js', style: 'name' },
  { text: 'Jolt Physics', style: 'name' },
  { text: 'Claude by Anthropic', style: 'name' },
  { text: '', style: 'spacer' },
  { text: '', style: 'spacer' },
  { text: 'Thanks for Playing!', style: 'thanks' },
  { text: '', style: 'spacer' },
  { text: '\u00A9 2026 The Department of Silly Stuff, LLC', style: 'copyright' },
];

// Canvas pixel dimensions. Panel world-size is derived from these.
const CANVAS_W = 1024;
const CANVAS_H = 4096;

// World-space panel size (1:4 ratio matching canvas).
const PANEL_W = 6.0;
const PANEL_H = 24.0;

// How far from canvas top the death message is drawn (in pixels).
// This controls where in the panel the death message sits initially.
const DEATH_MSG_Y = 500;

// Pixels of blank space between death message and first credits line.
const GAP_AFTER_DEATH = 350;

const _camWorldPos = new THREE.Vector3();
const _camWorldDir = new THREE.Vector3();

export class VREndScreen {
  /**
   * @param {THREE.Scene} scene
   * @param {THREE.Camera} camera
   * @param {THREE.WebGLRenderer} renderer
   */
  constructor(scene, camera, renderer) {
    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer || null;
    this.active = false;
    this._phase = 'idle'; // idle | stopping | tinting | fade-in | scrolling | crossfade | fade-out | done

    // ── Scene tint: inside-out sphere stays on camera ──
    const tintGeo = new THREE.SphereGeometry(0.5, 32, 16);
    const tintMat = new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0,
      side: THREE.BackSide,
      depthTest: false,
      depthWrite: false,
    });
    this.tintSphere = new THREE.Mesh(tintGeo, tintMat);
    this.tintSphere.renderOrder = 900;
    this.tintSphere.visible = false;
    camera.add(this.tintSphere);

    // ── Unified panel: death message + credits on one canvas ──
    this.canvas = document.createElement('canvas');
    this.canvas.width = CANVAS_W;
    this.canvas.height = CANVAS_H;
    this._contentBottomY = this._drawCanvas();

    const tex = new THREE.CanvasTexture(this.canvas);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;

    const panelMat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      opacity: 0,
      depthTest: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    this.panel = new THREE.Mesh(
      new THREE.PlaneGeometry(PANEL_W, PANEL_H),
      panelMat
    );
    this.panel.renderOrder = 910;
    this.panel.visible = false;
    scene.add(this.panel);

    // ── Finale death message panel (crossfades in as credits fade out) ──
    this._finaleCanvas = document.createElement('canvas');
    this._finaleCanvas.width = 1024;
    this._finaleCanvas.height = 256;
    this._drawFinaleMessage();

    const finaleTex = new THREE.CanvasTexture(this._finaleCanvas);
    finaleTex.minFilter = THREE.LinearFilter;
    finaleTex.magFilter = THREE.LinearFilter;

    const finaleMat = new THREE.MeshBasicMaterial({
      map: finaleTex,
      transparent: true,
      opacity: 0,
      depthTest: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    // 4m wide, 1m tall (4:1 ratio matching 1024:256 canvas)
    this.finalePanel = new THREE.Mesh(
      new THREE.PlaneGeometry(4.0, 1.0),
      finaleMat
    );
    this.finalePanel.renderOrder = 920;
    this.finalePanel.visible = false;
    scene.add(this.finalePanel);

    this._tex = tex;
    this._timer = 0;
    this._tintTarget = 0;
    this._scrollOffset = 0;

    // The death message is at DEATH_MSG_Y pixels from the top of the canvas.
    // Convert to world-space offset from panel center (panel center = 0).
    // Canvas top maps to +PANEL_H/2, canvas bottom maps to -PANEL_H/2.
    this._deathMsgWorldOffset = (PANEL_H / 2) - (DEATH_MSG_Y / CANVAS_H) * PANEL_H;

    // How far the panel must scroll so the last content line clears eye level.
    // _contentBottomY is in canvas pixels from the top.
    const contentBottomWorld = (PANEL_H / 2) - (this._contentBottomY / CANVAS_H) * PANEL_H;
    // We need contentBottomWorld to rise above eye level (which starts aligned
    // with the death message). Total scroll = deathMsgOffset - contentBottomWorld
    // plus a bit extra so the bottom text has time to be read.
    this._maxScroll = this._deathMsgWorldOffset - contentBottomWorld + 3.0;
  }

  /**
   * Start the VR end sequence.
   */
  start() {
    if (this.active) return;
    this.active = true;
    this._phase = 'stopping';
    this._timer = 0;
  }

  /**
   * Track camera gaze direction and position the panel in front of the user.
   * Called each frame during tinting so the panel appears wherever the user
   * is looking when it becomes visible.
   */
  _trackCamera() {
    this.camera.getWorldPosition(_camWorldPos);
    this.camera.getWorldDirection(_camWorldDir);
    // Use only horizontal forward direction (ignore pitch)
    _camWorldDir.y = 0;
    _camWorldDir.normalize();

    const distance = 5.0;
    const panelX = _camWorldPos.x + _camWorldDir.x * distance;
    const panelZ = _camWorldPos.z + _camWorldDir.z * distance;

    // Position panel so the death message text is at eye level.
    // The death message is _deathMsgWorldOffset above the panel center,
    // so panel center goes that far below eye level.
    const panelY = _camWorldPos.y - this._deathMsgWorldOffset;

    this.panel.position.set(panelX, panelY, panelZ);
    this.panel.lookAt(_camWorldPos.x, panelY, _camWorldPos.z);

    // Store for later (scrolling phase doesn't re-track)
    this._panelBaseY = panelY;
  }

  /**
   * Update every frame. Drives the full end sequence.
   * @param {number} dt - delta time in seconds
   * @returns {boolean} true when the sequence is complete
   */
  update(dt) {
    if (!this.active) return false;
    this._timer += dt;

    switch (this._phase) {
      case 'stopping':
        return this._updateStopping(dt);
      case 'tinting':
        return this._updateTinting(dt);
      case 'fade-in':
        return this._updateFadeIn(dt);
      case 'scrolling':
        return this._updateScrolling(dt);
      case 'crossfade':
        return this._updateCrossfade(dt);
      case 'fade-out':
        return this._updateFadeOut(dt);
      case 'done':
        return true;
      default:
        return false;
    }
  }

  _updateStopping(_dt) {
    if (this._timer > 0.5) {
      this._phase = 'tinting';
      this._timer = 0;
      this.tintSphere.visible = true;
      this._tintTarget = 0.65;
    }
    return false;
  }

  _updateTinting(_dt) {
    const tintMat = this.tintSphere.material;
    tintMat.opacity = Math.min(
      tintMat.opacity + _dt * (this._tintTarget / 3),
      this._tintTarget
    );

    // Track camera so panel appears wherever user is looking
    this._trackCamera();

    if (this._timer > 3) {
      this._trackCamera(); // Final lock
      this._phase = 'fade-in';
      this._timer = 0;
      this.panel.visible = true;
    }
    return false;
  }

  _updateFadeIn(_dt) {
    const mat = this.panel.material;

    // Fade in over 1.5s, then hold for 2s so user can read the death message
    if (this._timer < 1.5) {
      mat.opacity = this._timer / 1.5;
    } else {
      mat.opacity = 1;
    }

    if (this._timer > 3.5) {
      // Done holding, start scrolling
      this._phase = 'scrolling';
      this._timer = 0;
      this._scrollOffset = 0;
    }
    return false;
  }

  _updateScrolling(dt) {
    const scrollSpeed = 0.4; // meters per second
    this._scrollOffset += scrollSpeed * dt;

    // Move panel upward from its base position
    this.panel.position.y = this._panelBaseY + this._scrollOffset;

    if (this._scrollOffset >= this._maxScroll) {
      // Credits have all scrolled past - crossfade to death message
      this._phase = 'crossfade';
      this._timer = 0;

      // Position the finale panel at eye level, same X/Z as the credits panel
      this.camera.getWorldPosition(_camWorldPos);
      this.camera.getWorldDirection(_camWorldDir);
      _camWorldDir.y = 0;
      _camWorldDir.normalize();
      const dist = 5.0;
      this.finalePanel.position.set(
        _camWorldPos.x + _camWorldDir.x * dist,
        _camWorldPos.y,
        _camWorldPos.z + _camWorldDir.z * dist
      );
      this.finalePanel.lookAt(
        _camWorldPos.x,
        _camWorldPos.y,
        _camWorldPos.z
      );
      this.finalePanel.visible = true;
    }
    return false;
  }

  _updateCrossfade(dt) {
    // Credits panel fades out while the finale death message fades in (2s)
    const crossDur = 2.0;
    const t = Math.min(this._timer / crossDur, 1);

    this.panel.material.opacity = 1 - t;
    this.finalePanel.material.opacity = t;

    if (t >= 1) {
      this.panel.visible = false;
    }

    // Hold the finale message for 2s after crossfade completes, then fade out
    if (this._timer > crossDur + 2.0) {
      this._phase = 'fade-out';
      this._timer = 0;
    }
    return false;
  }

  _updateFadeOut(dt) {
    // Fade tint sphere to full black, fade out the finale panel
    const tintMat = this.tintSphere.material;
    tintMat.opacity = Math.min(tintMat.opacity + dt * 0.5, 1.0);

    const finaleMat = this.finalePanel.material;
    finaleMat.opacity = Math.max(0, 1 - this._timer / 2);

    if (this._timer > 3) {
      this._phase = 'done';
      console.log('[VREndScreen] End sequence complete - ending VR and reloading');
      // End the XR session cleanly before reloading to prevent the
      // "blank ocean floor" issue where the page reloads while still
      // in VR and the new session starts before the scene is ready.
      const session = this.renderer?.xr?.getSession();
      if (session) {
        session.end()
          .then(() => location.reload())
          .catch(() => location.reload());
      } else {
        location.reload();
      }
      return true;
    }
    return false;
  }

  // ── Canvas drawing ──

  /**
   * Draw the unified canvas: death message at top, credits below.
   * Returns the Y pixel position of the last content line (for scroll calc).
   */
  _drawCanvas() {
    const ctx = this.canvas.getContext('2d');
    const w = CANVAS_W;
    const h = CANVAS_H;

    // Pure black opaque background. This prevents the grey/transparent
    // artifacts that occurred with the slightly blue-tinted background,
    // and blends seamlessly with the black tint sphere behind it.
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, w, h);

    // ── Death message ──
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.font = '300 64px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('The PolyFish have died.', w / 2, DEATH_MSG_Y);

    // ── Credits ──
    let y = DEATH_MSG_Y + GAP_AFTER_DEATH;

    for (const line of CREDITS_LINES) {
      switch (line.style) {
        case 'logo':
          ctx.fillStyle = '#e8a840';
          ctx.font = '600 80px Georgia, "Times New Roman", serif';
          ctx.textAlign = 'center';
          ctx.fillText(line.text, w / 2, y);
          y += 30;
          break;
        case 'subtitle':
          ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
          ctx.font = '400 28px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(line.text.toUpperCase(), w / 2, y);
          y += 80;
          break;
        case 'role':
          ctx.fillStyle = 'rgba(180, 200, 230, 0.6)';
          ctx.font = '400 24px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(line.text.toUpperCase(), w / 2, y);
          y += 40;
          break;
        case 'name':
          ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
          ctx.font = '300 44px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(line.text, w / 2, y);
          y += 56;
          break;
        case 'detail':
          ctx.fillStyle = 'rgba(200, 200, 200, 0.4)';
          ctx.font = '300 22px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(line.text, w / 2, y);
          y += 36;
          break;
        case 'thanks':
          ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
          ctx.font = '300 52px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(line.text, w / 2, y);
          y += 70;
          break;
        case 'copyright':
          ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
          ctx.font = '300 22px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(line.text, w / 2, y);
          y += 50;
          break;
        case 'spacer':
          y += 50;
          break;
      }
    }

    return y;
  }

  /**
   * Draw the finale death message (shown during crossfade at the end).
   * Black background so it blends with the tint sphere.
   */
  _drawFinaleMessage() {
    const ctx = this._finaleCanvas.getContext('2d');
    const w = this._finaleCanvas.width;
    const h = this._finaleCanvas.height;

    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, w, h);

    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.font = '300 64px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('The PolyFish have died.', w / 2, h / 2);
  }

  /**
   * Clean up all GPU resources.
   */
  dispose() {
    this.tintSphere.geometry.dispose();
    this.tintSphere.material.dispose();
    this.camera.remove(this.tintSphere);

    this.panel.geometry.dispose();
    this.panel.material.map.dispose();
    this.panel.material.dispose();
    this.scene.remove(this.panel);

    this.finalePanel.geometry.dispose();
    this.finalePanel.material.map.dispose();
    this.finalePanel.material.dispose();
    this.scene.remove(this.finalePanel);
  }
}
