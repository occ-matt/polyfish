/**
 * VREndScreen - End-of-simulation sequence.
 *
 * When the fish population reaches 0, this shows a cinematic ending:
 *   1. A dark tint fades in over the scene
 *   2. "The PolyFish have died." fades in
 *   3. Credits scroll upward (like film credits)
 *   4. Fade to black, then reload
 *
 * Desktop/mobile: Uses a DOM overlay for crisp, centered, always-visible credits.
 * VR: Uses a world-space 3D panel (canvas texture on a plane).
 */
import * as THREE from 'three';

const CREDITS_HTML = `
<div class="end-death-msg">The PolyFish have died.</div>
<div class="end-death-line"></div>
<div class="end-credits-spacer-xl"></div>
<div class="end-logo">PolyFish</div>
<div class="end-subtitle">REMASTERED</div>
<div class="end-credits-spacer-xl"></div>
<div class="end-role">Created by</div>
<div class="end-name">Matt Scott</div>
<div class="end-credits-spacer-lg"></div>
<div class="end-role">Narrated by</div>
<div class="end-name">Phil Scott</div>
<div class="end-credits-spacer-lg"></div>
<div class="end-role">Music</div>
<div class="end-credits-spacer-sm"></div>
<div class="end-music-title">\u201CField of Fireflies\u201D</div>
<div class="end-music-artist">Purrple Cat</div>
<div class="end-music-license">purrplecat.com \u00B7 CC BY-SA 3.0</div>
<div class="end-credits-spacer-sm"></div>
<div class="end-music-title">\u201CWonders\u201D</div>
<div class="end-music-artist">Alex-Productions</div>
<div class="end-music-license">onsound.eu \u00B7 CC BY 3.0</div>
<div class="end-credits-spacer-sm"></div>
<div class="end-music-title">\u201COnce Upon a Time\u201D</div>
<div class="end-music-artist">Alex-Productions</div>
<div class="end-music-license">onsound.eu \u00B7 CC BY 3.0</div>
<div class="end-credits-spacer-lg"></div>
<div class="end-role">Sound Design & Ambience</div>
<div class="end-name">GameMaster Audio</div>
<div class="end-credits-spacer-lg"></div>
<div class="end-role">Built with</div>
<div class="end-credits-spacer-sm"></div>
<div class="end-built-with">Three.js &nbsp;\u00B7&nbsp; Jolt Physics &nbsp;\u00B7&nbsp; Blender &nbsp;\u00B7&nbsp; Claude</div>
<div class="end-credits-spacer-xl"></div>
<div class="end-thanks">Thank you for playing.</div>
<div class="end-credits-spacer-lg"></div>
<div class="end-copyright">\u00A9 2026 The Department of Silly Stuff, LLC</div>
<div class="end-credits-spacer-xl"></div>
`;

// Inject the CSS once
let _cssInjected = false;
function _injectCSS() {
  if (_cssInjected) return;
  _cssInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    .end-overlay {
      position: fixed;
      inset: 0;
      z-index: 1000;
      pointer-events: none;
      display: flex;
      flex-direction: column;
      align-items: center;
      overflow: hidden;
      font-family: "Helvetica Neue", "SF Pro Display", system-ui, -apple-system, sans-serif;
      -webkit-font-smoothing: antialiased;
    }

    .end-fade {
      position: absolute;
      inset: 0;
      background: #000;
      opacity: 0;
      transition: none;
    }

    .end-scroll-container {
      position: relative;
      width: 100%;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding-top: 45vh;
      opacity: 0;
    }

    .end-death-msg {
      font-size: clamp(24px, 4vw, 48px);
      font-weight: 200;
      color: rgba(255, 255, 255, 0.78);
      letter-spacing: 0.08em;
      text-align: center;
      padding: 0 20px;
    }

    .end-death-line {
      width: 60px;
      height: 1px;
      background: rgba(255, 255, 255, 0.15);
      margin: 28px auto 0;
    }

    .end-logo {
      font-family: Georgia, "Times New Roman", serif;
      font-size: clamp(36px, 6vw, 64px);
      font-weight: 500;
      color: #d4a04a;
      text-align: center;
    }

    .end-subtitle {
      font-size: clamp(12px, 1.8vw, 20px);
      font-weight: 300;
      color: rgba(255, 255, 255, 0.3);
      letter-spacing: 0.4em;
      text-align: center;
      margin-top: 4px;
    }

    .end-role {
      font-size: clamp(11px, 1.4vw, 16px);
      font-weight: 400;
      color: rgba(180, 195, 220, 0.5);
      letter-spacing: 0.25em;
      text-transform: uppercase;
      text-align: center;
    }

    .end-name {
      font-size: clamp(20px, 3.2vw, 34px);
      font-weight: 300;
      color: rgba(255, 255, 255, 0.88);
      text-align: center;
      margin-top: 6px;
    }

    .end-music-title {
      font-size: clamp(16px, 2.4vw, 26px);
      font-weight: 300;
      font-style: italic;
      color: rgba(255, 255, 255, 0.7);
      text-align: center;
    }

    .end-music-artist {
      font-size: clamp(12px, 1.6vw, 18px);
      font-weight: 300;
      color: rgba(255, 255, 255, 0.4);
      text-align: center;
      margin-top: 2px;
    }

    .end-music-license {
      font-size: clamp(9px, 1.1vw, 13px);
      font-weight: 300;
      color: rgba(255, 255, 255, 0.2);
      text-align: center;
      margin-top: 2px;
    }

    .end-built-with {
      font-size: clamp(14px, 2vw, 22px);
      font-weight: 300;
      color: rgba(255, 255, 255, 0.55);
      text-align: center;
    }

    .end-thanks {
      font-size: clamp(22px, 3.6vw, 40px);
      font-weight: 200;
      color: rgba(255, 255, 255, 0.65);
      text-align: center;
    }

    .end-copyright {
      font-size: clamp(10px, 1.2vw, 15px);
      font-weight: 300;
      color: rgba(255, 255, 255, 0.2);
      text-align: center;
    }

    .end-credits-spacer-sm { height: clamp(12px, 2vh, 20px); }
    .end-credits-spacer    { height: clamp(24px, 4vh, 40px); }
    .end-credits-spacer-lg { height: clamp(36px, 6vh, 60px); }
    .end-credits-spacer-xl { height: clamp(50px, 8vh, 80px); }
  `;
  document.head.appendChild(style);
}

// ── VR-specific constants (3D panel fallback) ──
const CANVAS_W = 1024;
const CANVAS_H = 4096;
const PANEL_W = 4.0;
const PANEL_H = 16.0;
const DEATH_MSG_Y = 420;
const GAP_AFTER_DEATH = 500;

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
    this._phase = 'idle';
    this._isVR = false;

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

    // ── DOM overlay (desktop/mobile) ──
    _injectCSS();
    this._overlay = null;
    this._fade = null;
    this._scrollContainer = null;
    this._scrollY = 0;

    // ── VR 3D panel (created lazily if needed) ──
    this.panel = null;
    this.finalePanel = null;
    this._tex = null;

    this._timer = 0;
    this._tintTarget = 0;
    this._scrollOffset = 0;
  }

  /**
   * Start the end sequence.
   */
  start() {
    if (this.active) return;
    this.active = true;
    this._phase = 'stopping';
    this._timer = 0;
    this._isVR = !!(this.renderer?.xr?.isPresenting);

    if (this._isVR) {
      this._createVRPanels();
    } else {
      this._createDOMOverlay();
    }
  }

  // ── DOM overlay setup ──

  _createDOMOverlay() {
    this._overlay = document.createElement('div');
    this._overlay.className = 'end-overlay';

    this._fade = document.createElement('div');
    this._fade.className = 'end-fade';
    this._overlay.appendChild(this._fade);

    this._scrollContainer = document.createElement('div');
    this._scrollContainer.className = 'end-scroll-container';
    this._scrollContainer.innerHTML = CREDITS_HTML;
    this._overlay.appendChild(this._scrollContainer);

    document.body.appendChild(this._overlay);
    this._scrollY = 0;
  }

  // ── VR 3D panel setup ──

  _createVRPanels() {
    // Main credits panel
    const canvas = document.createElement('canvas');
    canvas.width = CANVAS_W;
    canvas.height = CANVAS_H;
    this._contentBottomY = this._drawVRCanvas(canvas);

    const tex = new THREE.CanvasTexture(canvas);
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
    this.scene.add(this.panel);

    // Finale panel
    const finaleCanvas = document.createElement('canvas');
    finaleCanvas.width = 1024;
    finaleCanvas.height = 256;
    this._drawFinaleCanvas(finaleCanvas);

    const finaleTex = new THREE.CanvasTexture(finaleCanvas);
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
    this.finalePanel = new THREE.Mesh(
      new THREE.PlaneGeometry(3.5, 0.875),
      finaleMat
    );
    this.finalePanel.renderOrder = 920;
    this.finalePanel.visible = false;
    this.scene.add(this.finalePanel);

    this._tex = tex;

    this._deathMsgWorldOffset = (PANEL_H / 2) - (DEATH_MSG_Y / CANVAS_H) * PANEL_H;
    const contentBottomWorld = (PANEL_H / 2) - (this._contentBottomY / CANVAS_H) * PANEL_H;
    this._maxScroll = this._deathMsgWorldOffset - contentBottomWorld + 3.0;
  }

  // ── Update ──

  update(dt) {
    if (!this.active) return false;
    this._timer += dt;

    if (this._isVR) {
      return this._updateVR(dt);
    } else {
      return this._updateDOM(dt);
    }
  }

  // ── DOM update (desktop/mobile) ──

  _updateDOM(dt) {
    switch (this._phase) {
      case 'stopping':
        // Brief pause
        if (this._timer > 0.8) {
          this._phase = 'fading';
          this._timer = 0;
        }
        return false;

      case 'fading': {
        // Fade to ~88% black over 3s with ease-out
        const progress = Math.min(this._timer / 3.0, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        this._fade.style.opacity = eased * 0.88;

        // Also fade the 3D tint sphere for consistent look
        this.tintSphere.visible = true;
        this.tintSphere.material.opacity = eased * 0.88;

        if (this._timer > 3.0) {
          this._fade.style.opacity = 0.88;
          this.tintSphere.material.opacity = 0.88;
          this._phase = 'reveal';
          this._timer = 0;
        }
        return false;
      }

      case 'reveal': {
        // Fade in the credits text over 2s, then hold for 2.5s
        const t = Math.min(this._timer / 2.0, 1);
        this._scrollContainer.style.opacity = t * t; // ease-in

        if (this._timer > 4.5) {
          this._scrollContainer.style.opacity = 1;
          this._phase = 'scrolling';
          this._timer = 0;
          this._scrollY = 0;
        }
        return false;
      }

      case 'scrolling': {
        // Scroll the credits upward
        const scrollSpeed = 38; // pixels per second — gentle pace
        this._scrollY += scrollSpeed * dt;
        this._scrollContainer.style.transform = `translateY(-${this._scrollY}px)`;

        // Check if we've scrolled past all content
        const contentHeight = this._scrollContainer.scrollHeight;
        const viewHeight = window.innerHeight;
        // Stop when the last element has scrolled past center
        if (this._scrollY > contentHeight - viewHeight * 0.3) {
          this._phase = 'finale';
          this._timer = 0;
        }
        return false;
      }

      case 'finale': {
        // Fade out credits, then fade to full black
        const fadeOutDur = 2.0;
        const holdDur = 2.0;
        const blackDur = 3.0;

        if (this._timer < fadeOutDur) {
          // Fade out credits
          const t = this._timer / fadeOutDur;
          this._scrollContainer.style.opacity = 1 - t;
        } else if (this._timer < fadeOutDur + holdDur) {
          // Hold on dark scene
          this._scrollContainer.style.opacity = 0;
        } else if (this._timer < fadeOutDur + holdDur + blackDur) {
          // Fade to full black
          const t = (this._timer - fadeOutDur - holdDur) / blackDur;
          this._fade.style.opacity = 0.88 + t * 0.12; // 0.88 → 1.0
          this.tintSphere.material.opacity = 0.88 + t * 0.12;
        } else {
          // Done — reload
          this._phase = 'done';
          console.log('[VREndScreen] End sequence complete - reloading');
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

      case 'done':
        return true;

      default:
        return false;
    }
  }

  // ── VR update (3D panels) ──

  _updateVR(dt) {
    switch (this._phase) {
      case 'stopping':
        if (this._timer > 0.8) {
          this._phase = 'tinting';
          this._timer = 0;
          this.tintSphere.visible = true;
          this._tintTarget = 0.88;
        }
        return false;

      case 'tinting': {
        const tintMat = this.tintSphere.material;
        const progress = Math.min(this._timer / 3.0, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        tintMat.opacity = eased * this._tintTarget;
        this._trackCamera();
        if (this._timer > 3.0) {
          tintMat.opacity = this._tintTarget;
          this._trackCamera();
          this._phase = 'fade-in';
          this._timer = 0;
          this.panel.visible = true;
        }
        return false;
      }

      case 'fade-in': {
        const mat = this.panel.material;
        if (this._timer < 2.0) {
          const t = this._timer / 2.0;
          mat.opacity = t * t;
        } else {
          mat.opacity = 1;
        }
        if (this._timer > 4.5) {
          this._phase = 'scrolling';
          this._timer = 0;
          this._scrollOffset = 0;
        }
        return false;
      }

      case 'scrolling': {
        const scrollSpeed = 0.28;
        this._scrollOffset += scrollSpeed * dt;
        this.panel.position.y = this._panelBaseY + this._scrollOffset;
        if (this._scrollOffset >= this._maxScroll) {
          this._phase = 'crossfade';
          this._timer = 0;
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
          this.finalePanel.lookAt(_camWorldPos.x, _camWorldPos.y, _camWorldPos.z);
          this.finalePanel.visible = true;
        }
        return false;
      }

      case 'crossfade': {
        const crossDur = 2.5;
        const t = Math.min(this._timer / crossDur, 1);
        const eased = t * t * (3 - 2 * t);
        this.panel.material.opacity = 1 - eased;
        this.finalePanel.material.opacity = eased;
        if (t >= 1) this.panel.visible = false;
        if (this._timer > crossDur + 3.0) {
          this._phase = 'fade-out';
          this._timer = 0;
        }
        return false;
      }

      case 'fade-out': {
        const tintMat = this.tintSphere.material;
        tintMat.opacity = Math.min(tintMat.opacity + dt * 0.35, 1.0);
        this.finalePanel.material.opacity = Math.max(0, 1 - this._timer / 3);
        if (this._timer > 4) {
          this._phase = 'done';
          console.log('[VREndScreen] End sequence complete - ending VR and reloading');
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

      case 'done':
        return true;

      default:
        return false;
    }
  }

  _trackCamera() {
    this.camera.getWorldPosition(_camWorldPos);
    this.camera.getWorldDirection(_camWorldDir);
    _camWorldDir.y = 0;
    _camWorldDir.normalize();

    const distance = 5.0;
    const panelX = _camWorldPos.x + _camWorldDir.x * distance;
    const panelZ = _camWorldPos.z + _camWorldDir.z * distance;
    const panelY = _camWorldPos.y - this._deathMsgWorldOffset;

    this.panel.position.set(panelX, panelY, panelZ);
    this.panel.lookAt(_camWorldPos.x, panelY, _camWorldPos.z);
    this._panelBaseY = panelY;
  }

  // ── VR canvas drawing ──

  _drawVRCanvas(canvas) {
    const ctx = canvas.getContext('2d');
    const w = CANVAS_W;
    const h = CANVAS_H;

    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, w, h);

    const grad = ctx.createRadialGradient(w / 2, h / 4, 0, w / 2, h / 4, w * 0.8);
    grad.addColorStop(0, 'rgba(20, 18, 14, 0.3)');
    grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
    ctx.font = '200 52px "Helvetica Neue", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    this._drawSpacedText(ctx, 'The PolyFish have died.', w / 2, DEATH_MSG_Y, 3);

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(w / 2 - 120, DEATH_MSG_Y + 50);
    ctx.lineTo(w / 2 + 120, DEATH_MSG_Y + 50);
    ctx.stroke();

    let y = DEATH_MSG_Y + GAP_AFTER_DEATH;
    const lines = [
      { text: 'PolyFish', style: 'logo' },
      { text: 'Remastered', style: 'subtitle' },
      { text: '', style: 'spacer-lg' },
      { text: 'Created by', style: 'role' },
      { text: 'Matt Scott', style: 'name' },
      { text: '', style: 'spacer-lg' },
      { text: 'Narrated by', style: 'role' },
      { text: 'Phil Scott', style: 'name' },
      { text: '', style: 'spacer-lg' },
      { text: 'Music', style: 'role' },
      { text: '', style: 'spacer-sm' },
      { text: '\u201CField of Fireflies\u201D', style: 'music-title' },
      { text: 'Purrple Cat', style: 'music-artist' },
      { text: 'purrplecat.com \u00B7 CC BY-SA 3.0', style: 'music-license' },
      { text: '', style: 'spacer-sm' },
      { text: '\u201CWonders\u201D', style: 'music-title' },
      { text: 'Alex-Productions', style: 'music-artist' },
      { text: 'onsound.eu \u00B7 CC BY 3.0', style: 'music-license' },
      { text: '', style: 'spacer-sm' },
      { text: '\u201COnce Upon a Time\u201D', style: 'music-title' },
      { text: 'Alex-Productions', style: 'music-artist' },
      { text: 'onsound.eu \u00B7 CC BY 3.0', style: 'music-license' },
      { text: '', style: 'spacer-lg' },
      { text: 'Sound Design & Ambience', style: 'role' },
      { text: 'GameMaster Audio', style: 'name' },
      { text: '', style: 'spacer-lg' },
      { text: 'Built with', style: 'role' },
      { text: '', style: 'spacer-sm' },
      { text: 'Three.js  \u00B7  Jolt Physics  \u00B7  Blender  \u00B7  Claude', style: 'built-with' },
      { text: '', style: 'spacer-xl' },
      { text: 'Thank you for playing.', style: 'thanks' },
      { text: '', style: 'spacer-lg' },
      { text: '\u00A9 2026 The Department of Silly Stuff, LLC', style: 'copyright' },
    ];

    for (const line of lines) {
      switch (line.style) {
        case 'logo':
          ctx.fillStyle = '#d4a04a';
          ctx.font = '500 72px Georgia, "Times New Roman", serif';
          ctx.textAlign = 'center';
          ctx.fillText(line.text, w / 2, y);
          y += 24;
          break;
        case 'subtitle':
          ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
          ctx.font = '300 22px "Helvetica Neue", system-ui, sans-serif';
          this._drawSpacedText(ctx, line.text.toUpperCase(), w / 2, y, 8);
          y += 70;
          break;
        case 'role':
          ctx.fillStyle = 'rgba(180, 195, 220, 0.45)';
          ctx.font = '400 18px "Helvetica Neue", system-ui, sans-serif';
          this._drawSpacedText(ctx, line.text.toUpperCase(), w / 2, y, 6);
          y += 38;
          break;
        case 'name':
          ctx.fillStyle = 'rgba(255, 255, 255, 0.88)';
          ctx.font = '300 38px "Helvetica Neue", system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(line.text, w / 2, y);
          y += 52;
          break;
        case 'music-title':
          ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
          ctx.font = 'italic 300 30px "Helvetica Neue", system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(line.text, w / 2, y);
          y += 36;
          break;
        case 'music-artist':
          ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
          ctx.font = '300 22px "Helvetica Neue", system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(line.text, w / 2, y);
          y += 28;
          break;
        case 'music-license':
          ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
          ctx.font = '300 16px "Helvetica Neue", system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(line.text, w / 2, y);
          y += 30;
          break;
        case 'built-with':
          ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
          ctx.font = '300 26px "Helvetica Neue", system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(line.text, w / 2, y);
          y += 50;
          break;
        case 'thanks':
          ctx.fillStyle = 'rgba(255, 255, 255, 0.65)';
          ctx.font = '200 44px "Helvetica Neue", system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(line.text, w / 2, y);
          y += 60;
          break;
        case 'copyright':
          ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
          ctx.font = '300 18px "Helvetica Neue", system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(line.text, w / 2, y);
          y += 40;
          break;
        case 'spacer-sm': y += 20; break;
        case 'spacer': y += 45; break;
        case 'spacer-lg': y += 70; break;
        case 'spacer-xl': y += 100; break;
      }
    }
    return y;
  }

  _drawFinaleCanvas(canvas) {
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
    ctx.font = '200 52px "Helvetica Neue", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    this._drawSpacedText(ctx, 'The PolyFish have died.', w / 2, h / 2, 3);
  }

  _drawSpacedText(ctx, text, x, y, spacing) {
    const chars = text.split('');
    let totalWidth = 0;
    for (const ch of chars) totalWidth += ctx.measureText(ch).width + spacing;
    totalWidth -= spacing;
    let curX = x - totalWidth / 2;
    ctx.textAlign = 'left';
    for (const ch of chars) {
      ctx.fillText(ch, curX, y);
      curX += ctx.measureText(ch).width + spacing;
    }
    ctx.textAlign = 'center';
  }

  dispose() {
    this.tintSphere.geometry.dispose();
    this.tintSphere.material.dispose();
    this.camera.remove(this.tintSphere);

    if (this.panel) {
      this.panel.geometry.dispose();
      this.panel.material.map?.dispose();
      this.panel.material.dispose();
      this.scene.remove(this.panel);
    }
    if (this.finalePanel) {
      this.finalePanel.geometry.dispose();
      this.finalePanel.material.map?.dispose();
      this.finalePanel.material.dispose();
      this.scene.remove(this.finalePanel);
    }
    if (this._overlay && this._overlay.parentNode) {
      this._overlay.parentNode.removeChild(this._overlay);
    }
  }
}
