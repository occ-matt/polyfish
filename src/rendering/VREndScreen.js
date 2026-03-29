/**
 * VREndScreen - End-of-simulation credits sequence.
 *
 * When the fish population reaches 0, this shows a cinematic ending:
 *   1. The scene fades to near-black (tint sphere for 3D, DOM overlay for screen)
 *   2. "The PolyFish have died." fades in
 *   3. Credits scroll upward (like film credits)
 *   4. Fade to full black, then reload
 *
 * Both desktop and VR use the same DOM overlay for pixel-perfect parity.
 * VR uses WebXR's dom-overlay feature (configured in XRManager) so the
 * HTML/CSS credits render identically on the headset.
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

    // ── Scene tint: inside-out sphere darkens the 3D world ──
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

    // ── DOM overlay (shared by desktop and VR) ──
    _injectCSS();
    this._overlay = null;
    this._fade = null;
    this._scrollContainer = null;
    this._scrollY = 0;

    this._timer = 0;
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

    this._createDOMOverlay();
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

    // In VR, inject into the XR DOM overlay root so the browser composites
    // our HTML on top of the VR scene. On desktop, just append to body.
    const xrOverlay = this._isVR && document.getElementById('xr-dom-overlay');
    const parent = xrOverlay || document.body;
    parent.appendChild(this._overlay);
    this._scrollY = 0;
  }

  // ── Update ──

  update(dt) {
    if (!this.active) return false;
    this._timer += dt;

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

        // Darken the 3D scene in sync
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
        const scrollSpeed = 38; // pixels per second
        this._scrollY += scrollSpeed * dt;
        this._scrollContainer.style.transform = `translateY(-${this._scrollY}px)`;

        // Check if we've scrolled past all content
        const contentHeight = this._scrollContainer.scrollHeight;
        const viewHeight = window.innerHeight;
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
          const t = this._timer / fadeOutDur;
          this._scrollContainer.style.opacity = 1 - t;
        } else if (this._timer < fadeOutDur + holdDur) {
          this._scrollContainer.style.opacity = 0;
        } else if (this._timer < fadeOutDur + holdDur + blackDur) {
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

  dispose() {
    this.tintSphere.geometry.dispose();
    this.tintSphere.material.dispose();
    this.camera.remove(this.tintSphere);

    if (this._overlay && this._overlay.parentNode) {
      this._overlay.parentNode.removeChild(this._overlay);
    }
  }
}
