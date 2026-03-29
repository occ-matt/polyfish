/**
 * VREndScreen - End-of-simulation credits sequence.
 *
 * When the fish population reaches 0, this shows a cinematic ending:
 *   1. The scene fades to near-black (tint sphere for 3D, DOM fade for screen)
 *   2. "The PolyFish have died." fades in
 *   3. Credits scroll upward (like film credits)
 *   4. Fade to full black, then reload
 *
 * Desktop/mobile: DOM overlay with CSS-based scrolling credits.
 * VR: If dom-overlay is granted, uses the same DOM path. Otherwise, falls
 *     back to a high-res canvas texture on a 3D billboard that mirrors
 *     every CSS value from the DOM version for visual parity.
 */
import * as THREE from 'three';

// ── Shared credits content ──

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

// ── DOM CSS (desktop / VR dom-overlay) ──

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

// ── VR canvas fallback: credits drawn to match DOM CSS exactly ──
// All sizes use the CSS max-clamp values (the "desktop at full width" look).
// Canvas is 2048px wide to stay crisp on headset displays.

const VR_CW = 2048;
const VR_CH = 8192;
const SANS = '"Helvetica Neue", system-ui, sans-serif';
const SERIF = 'Georgia, "Times New Roman", serif';

/**
 * Structured credits data — each entry maps to a DOM class.
 * Font sizes are the max values from clamp() in the CSS.
 */
const VR_CREDITS = [
  { text: 'The PolyFish have died.', style: 'death-msg' },
  { style: 'death-line' },
  { style: 'spacer-xl' },
  { text: 'PolyFish', style: 'logo' },
  { text: 'REMASTERED', style: 'subtitle' },
  { style: 'spacer-xl' },
  { text: 'Created by', style: 'role' },
  { text: 'Matt Scott', style: 'name' },
  { style: 'spacer-lg' },
  { text: 'Narrated by', style: 'role' },
  { text: 'Phil Scott', style: 'name' },
  { style: 'spacer-lg' },
  { text: 'Music', style: 'role' },
  { style: 'spacer-sm' },
  { text: '\u201CField of Fireflies\u201D', style: 'music-title' },
  { text: 'Purrple Cat', style: 'music-artist' },
  { text: 'purrplecat.com \u00B7 CC BY-SA 3.0', style: 'music-license' },
  { style: 'spacer-sm' },
  { text: '\u201CWonders\u201D', style: 'music-title' },
  { text: 'Alex-Productions', style: 'music-artist' },
  { text: 'onsound.eu \u00B7 CC BY 3.0', style: 'music-license' },
  { style: 'spacer-sm' },
  { text: '\u201COnce Upon a Time\u201D', style: 'music-title' },
  { text: 'Alex-Productions', style: 'music-artist' },
  { text: 'onsound.eu \u00B7 CC BY 3.0', style: 'music-license' },
  { style: 'spacer-lg' },
  { text: 'Sound Design & Ambience', style: 'role' },
  { text: 'GameMaster Audio', style: 'name' },
  { style: 'spacer-lg' },
  { text: 'Built with', style: 'role' },
  { style: 'spacer-sm' },
  { text: 'Three.js  \u00B7  Jolt Physics  \u00B7  Blender  \u00B7  Claude', style: 'built-with' },
  { style: 'spacer-xl' },
  { text: 'Thank you for playing.', style: 'thanks' },
  { style: 'spacer-lg' },
  { text: '\u00A9 2026 The Department of Silly Stuff, LLC', style: 'copyright' },
  { style: 'spacer-xl' },
];

/**
 * Style table — maps each style name to font, color, spacing, and
 * vertical advance. Values match the DOM CSS max-clamp values.
 */
const VR_STYLES = {
  'death-msg':     { font: `200 48px ${SANS}`, color: 'rgba(255,255,255,0.78)', spacing: 0.08, advance: 80 },
  'death-line':    { advance: 50 }, // special: draws a line
  'logo':          { font: `500 64px ${SERIF}`, color: '#d4a04a', advance: 80 },
  'subtitle':      { font: `300 20px ${SANS}`, color: 'rgba(255,255,255,0.3)', spacing: 0.4, advance: 40 },
  'role':          { font: `400 16px ${SANS}`, color: 'rgba(180,195,220,0.5)', spacing: 0.25, upper: true, advance: 38 },
  'name':          { font: `300 34px ${SANS}`, color: 'rgba(255,255,255,0.88)', advance: 52 },
  'music-title':   { font: `italic 300 26px ${SANS}`, color: 'rgba(255,255,255,0.7)', advance: 40 },
  'music-artist':  { font: `300 18px ${SANS}`, color: 'rgba(255,255,255,0.4)', advance: 30 },
  'music-license': { font: `300 13px ${SANS}`, color: 'rgba(255,255,255,0.2)', advance: 26 },
  'built-with':    { font: `300 22px ${SANS}`, color: 'rgba(255,255,255,0.55)', advance: 50 },
  'thanks':        { font: `200 40px ${SANS}`, color: 'rgba(255,255,255,0.65)', advance: 60 },
  'copyright':     { font: `300 15px ${SANS}`, color: 'rgba(255,255,255,0.2)', advance: 40 },
  'spacer-sm':     { advance: 20 },
  'spacer':        { advance: 40 },
  'spacer-lg':     { advance: 60 },
  'spacer-xl':     { advance: 80 },
};

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
    this._useVRPanel = false; // true when dom-overlay not available

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

    // ── DOM overlay (desktop / VR with dom-overlay) ──
    _injectCSS();
    this._overlay = null;
    this._fade = null;
    this._scrollContainer = null;
    this._scrollY = 0;

    // ── VR 3D panel fallback (canvas texture with UV scrolling) ──
    this._panel = null;
    this._panelTex = null;
    this._scrollOffset = 0;
    this._contentBottomY = 0;
    this._maxScroll = 0;
    this._uvViewport = 0;
    this._uvStartOffset = 0;

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

    // Check if dom-overlay was granted
    const session = this.renderer?.xr?.getSession();
    const hasDomOverlay = !!(session?.domOverlay?.type);
    this._useVRPanel = this._isVR && !hasDomOverlay;

    console.log(`[VREndScreen] start – isVR=${this._isVR}, domOverlay=${hasDomOverlay}, useVRPanel=${this._useVRPanel}`);

    if (this._useVRPanel) {
      this._createVRPanel();
    } else {
      this._createDOMOverlay();
    }
  }

  // ── DOM overlay setup (desktop or VR with dom-overlay) ──

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

  // ── VR 3D panel fallback ──

  _createVRPanel() {
    const canvas = document.createElement('canvas');
    canvas.width = VR_CW;
    canvas.height = VR_CH;
    this._contentBottomY = this._drawVRCanvas(canvas);

    const tex = new THREE.CanvasTexture(canvas);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;

    // UV scrolling: the panel shows a viewport-sized slice of the full canvas.
    // Panel is a comfortable 4m × 3m at 5m distance (~34° vertical FOV).
    // The texture repeat.y controls how much of the canvas is visible.
    const PANEL_W = 4.0;
    const PANEL_H = 3.0;
    const fullPanelH = PANEL_W * (VR_CH / VR_CW); // 16m if showing full canvas
    const viewportRatio = PANEL_H / fullPanelH;    // ~0.1875
    tex.repeat.set(1.0, viewportRatio);

    // Position the death message at 45% from top of the viewport (matching
    // CSS padding-top: 45vh). In Three.js UV: 0=bottom, 1=top of texture.
    // Death message is at canvas Y = 0.45 * VR_CH → UV y = 1 - 0.45 = 0.55
    const DEATH_UV = 1.0 - 0.45;
    // To place death msg at 45% from top of viewport (= 55% from bottom):
    // deathUV = offset.y + 0.55 * viewportRatio  →  offset.y = deathUV - 0.55 * vr
    const startOffset = DEATH_UV - 0.55 * viewportRatio;
    tex.offset.set(0, startOffset);
    this._uvViewport = viewportRatio;
    this._uvStartOffset = startOffset;

    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      opacity: 0,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this._panel = new THREE.Mesh(new THREE.PlaneGeometry(PANEL_W, PANEL_H), mat);
    this._panel.renderOrder = 910;
    this._panel.visible = false;
    this.scene.add(this._panel);

    this._panelTex = tex;

    // Scroll limits in UV space: scroll until the last credit line
    // is near the top of the viewport
    const contentBottomUV = 1.0 - (this._contentBottomY / VR_CH);
    const endOffset = Math.max(contentBottomUV - 0.1 * viewportRatio, 0);
    this._maxScroll = startOffset - endOffset;

    // Position panel in front of camera gaze
    this._positionPanel();
  }

  _positionPanel() {
    this.camera.getWorldPosition(_camWorldPos);
    this.camera.getWorldDirection(_camWorldDir);
    _camWorldDir.y = 0;
    _camWorldDir.normalize();

    const distance = 5.0;
    this._panel.position.set(
      _camWorldPos.x + _camWorldDir.x * distance,
      _camWorldPos.y,
      _camWorldPos.z + _camWorldDir.z * distance
    );
    this._panel.lookAt(_camWorldPos);
  }

  /**
   * Draw credits onto a canvas, matching DOM CSS values precisely.
   * Returns the Y coordinate of the last drawn element (content bottom).
   */
  _drawVRCanvas(canvas) {
    const ctx = canvas.getContext('2d');
    const w = VR_CW;
    const h = VR_CH;

    // Black background
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, w, h);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Start at ~45% from top (matching CSS padding-top: 45vh)
    let y = h * 0.45;

    for (const entry of VR_CREDITS) {
      const s = VR_STYLES[entry.style];
      if (!s) continue;

      // Spacer — just advance Y
      if (!entry.text && entry.style !== 'death-line') {
        y += s.advance;
        continue;
      }

      // Death line — draw a thin horizontal line
      if (entry.style === 'death-line') {
        ctx.strokeStyle = 'rgba(255,255,255,0.15)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(w / 2 - 30, y + 28);
        ctx.lineTo(w / 2 + 30, y + 28);
        ctx.stroke();
        y += s.advance;
        continue;
      }

      // Set font and color
      ctx.font = s.font;
      ctx.fillStyle = s.color;

      const text = s.upper ? entry.text.toUpperCase() : entry.text;

      if (s.spacing) {
        // Simulate CSS letter-spacing (em-based)
        this._drawSpacedText(ctx, text, w / 2, y, s.font, s.spacing);
      } else {
        ctx.textAlign = 'center';
        ctx.fillText(text, w / 2, y);
      }

      y += s.advance;
    }

    return y;
  }

  /**
   * Draw text with em-based letter-spacing (matching CSS letter-spacing).
   */
  _drawSpacedText(ctx, text, x, y, font, emSpacing) {
    // Parse font size from the font string to compute pixel spacing
    const sizeMatch = font.match(/(\d+)px/);
    const fontSize = sizeMatch ? parseInt(sizeMatch[1], 10) : 16;
    const pxSpacing = fontSize * emSpacing;

    const chars = text.split('');
    let totalWidth = 0;
    for (const ch of chars) totalWidth += ctx.measureText(ch).width + pxSpacing;
    totalWidth -= pxSpacing;

    let curX = x - totalWidth / 2;
    ctx.textAlign = 'left';
    for (const ch of chars) {
      ctx.fillText(ch, curX, y);
      curX += ctx.measureText(ch).width + pxSpacing;
    }
    ctx.textAlign = 'center';
  }

  // ── Update ──

  update(dt) {
    if (!this.active) return false;
    this._timer += dt;

    if (this._useVRPanel) {
      return this._updateVR(dt);
    }
    return this._updateDOM(dt);
  }

  // ── DOM update (desktop / VR with dom-overlay) ──

  _updateDOM(dt) {
    switch (this._phase) {
      case 'stopping':
        if (this._timer > 0.8) {
          this._phase = 'fading';
          this._timer = 0;
        }
        return false;

      case 'fading': {
        const progress = Math.min(this._timer / 3.0, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        this._fade.style.opacity = eased * 0.88;

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
        const t = Math.min(this._timer / 2.0, 1);
        this._scrollContainer.style.opacity = t * t;
        if (this._timer > 4.5) {
          this._scrollContainer.style.opacity = 1;
          this._phase = 'scrolling';
          this._timer = 0;
          this._scrollY = 0;
        }
        return false;
      }

      case 'scrolling': {
        const scrollSpeed = 38;
        this._scrollY += scrollSpeed * dt;
        this._scrollContainer.style.transform = `translateY(-${this._scrollY}px)`;

        const contentHeight = this._scrollContainer.scrollHeight;
        const viewHeight = window.innerHeight;
        if (this._scrollY > contentHeight - viewHeight * 0.3) {
          this._phase = 'finale';
          this._timer = 0;
        }
        return false;
      }

      case 'finale': {
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
          this._fade.style.opacity = 0.88 + t * 0.12;
          this.tintSphere.material.opacity = 0.88 + t * 0.12;
        } else {
          this._phase = 'done';
          console.log('[VREndScreen] End sequence complete - reloading');
          this._endAndReload();
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

  // ── VR update (3D canvas panel) ──
  // Same phase names and timings as DOM path for consistency.

  _updateVR(dt) {
    switch (this._phase) {
      case 'stopping':
        if (this._timer > 0.8) {
          this._phase = 'fading';
          this._timer = 0;
          this.tintSphere.visible = true;
        }
        return false;

      case 'fading': {
        const progress = Math.min(this._timer / 3.0, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        this.tintSphere.material.opacity = eased * 0.88;

        if (this._timer > 3.0) {
          this.tintSphere.material.opacity = 0.88;
          this._panel.visible = true;
          this._phase = 'reveal';
          this._timer = 0;
        }
        return false;
      }

      case 'reveal': {
        const t = Math.min(this._timer / 2.0, 1);
        this._panel.material.opacity = t * t;
        if (this._timer > 4.5) {
          this._panel.material.opacity = 1;
          this._phase = 'scrolling';
          this._timer = 0;
          this._scrollOffset = 0;
        }
        return false;
      }

      case 'scrolling': {
        // Scroll UV offset downward to reveal credits (like film reel).
        // Target ~35s total scroll to match DOM credits pacing.
        const scrollSpeed = this._maxScroll / 35.0;
        this._scrollOffset += scrollSpeed * dt;
        this._panelTex.offset.y = this._uvStartOffset - this._scrollOffset;

        // Keep panel facing the camera as user turns head in VR
        this.camera.getWorldPosition(_camWorldPos);
        this._panel.lookAt(_camWorldPos);

        if (this._scrollOffset >= this._maxScroll) {
          this._phase = 'finale';
          this._timer = 0;
        }
        return false;
      }

      case 'finale': {
        const fadeOutDur = 2.0;
        const holdDur = 2.0;
        const blackDur = 3.0;

        if (this._timer < fadeOutDur) {
          const t = this._timer / fadeOutDur;
          this._panel.material.opacity = 1 - t;
        } else if (this._timer < fadeOutDur + holdDur) {
          this._panel.material.opacity = 0;
          this._panel.visible = false;
        } else if (this._timer < fadeOutDur + holdDur + blackDur) {
          const t = (this._timer - fadeOutDur - holdDur) / blackDur;
          this.tintSphere.material.opacity = 0.88 + t * 0.12;
        } else {
          this._phase = 'done';
          console.log('[VREndScreen] End sequence complete - reloading');
          this._endAndReload();
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

  _endAndReload() {
    const session = this.renderer?.xr?.getSession();
    if (session) {
      session.end()
        .then(() => location.reload())
        .catch(() => location.reload());
    } else {
      location.reload();
    }
  }

  dispose() {
    this.tintSphere.geometry.dispose();
    this.tintSphere.material.dispose();
    this.camera.remove(this.tintSphere);

    if (this._panel) {
      this._panel.geometry.dispose();
      this._panel.material.map?.dispose();
      this._panel.material.dispose();
      this.scene.remove(this._panel);
    }

    if (this._overlay && this._overlay.parentNode) {
      this._overlay.parentNode.removeChild(this._overlay);
    }
  }
}
