/**
 * DesktopHints — Glass-style on-screen hints for desktop players.
 *
 *  • WASD ghost keys in the bottom-left (fade out after first movement)
 *  • Space/Shift keys for swim up/down (appear after WASD fades)
 *  • "Click to Feed" prompt (fades in after first fish, out after first feed)
 *  • Aquarium mode: glass [Tab] key + 🐠/🤿 icon in bottom-right
 */

import { VirtualJoystick } from './VirtualJoystick.js';
import { CameraController } from './CameraController.js';

export class DesktopHints {
  constructor() {
    this._container = null;
    this._wasdEl = null;
    this._swimEl = null;
    this._feedPrompt = null;
    this._aquariumEl = null;
    this._disposed = false;

    // Track whether hints have been dismissed
    this._wasdDismissed = false;
    this._swimShown = false;
    this._feedDismissed = false;
    this._feedShown = false;
  }

  /**
   * @param {object} opts
   * @param {import('./CameraController').CameraController} opts.cameraController
   * @param {import('./FeedingInput').FeedingInput} opts.feedingInput
   */
  init(opts) {
    // Don't show on mobile — they have their own controls
    if (VirtualJoystick.isTouchDevice()) return;

    this._cameraController = opts.cameraController;
    this._feedingInput = opts.feedingInput;

    this._injectStyles();
    this._createContainer();
    this._createWASD();
    this._createSwimKeys();
    this._createFeedPrompt();
    this._createAquariumHint();

    // Listen for movement keys to dismiss the ghost keys, then show swim keys
    const K = CameraController.KEYS;
    const moveKeys = new Set([K.forward, K.back, K.left, K.right].flatMap(k => [k.toLowerCase(), k.toUpperCase()]));
    const swimKeys = new Set([K.swimUp, K.swimDown].flatMap(k => [k, k.toLowerCase(), k.toUpperCase(), ' ']));
    this._onKeyDown = (e) => {
      if (!this._wasdDismissed && moveKeys.has(e.key)) {
        this._wasdDismissed = true;
        if (this._wasdEl) {
          this._wasdEl.classList.add('dh-fade-out');
          // Show swim keys after WASD fades
          setTimeout(() => this._showSwimKeys(), 1800);
        }
      }
      // Dismiss swim keys on actual swim keys
      if (this._swimShown && swimKeys.has(e.key)) {
        if (this._swimEl && !this._swimEl.classList.contains('dh-fade-out')) {
          this._swimEl.classList.add('dh-fade-out');
        }
      }
      // Update aquarium hint when Tab is pressed (CameraController handles the actual toggle)
      if (e.key === 'Tab') {
        setTimeout(() => this._updateAquariumState(), 50);
      }
    };
    document.addEventListener('keydown', this._onKeyDown);

    // Listen for mouse click (feeding) to dismiss the feed prompt
    this._onMouseDown = () => {
      if (this._feedShown && !this._feedDismissed && document.pointerLockElement) {
        this._feedDismissed = true;
        if (this._feedPrompt) this._feedPrompt.classList.add('dh-fade-out');
      }
    };
    document.addEventListener('mousedown', this._onMouseDown);
  }

  _injectStyles() {
    if (document.getElementById('desktop-hints-styles')) return;
    const style = document.createElement('style');
    style.id = 'desktop-hints-styles';
    style.textContent = `
      .dh-container {
        position: fixed;
        inset: 0;
        z-index: 9998;
        pointer-events: none;
      }

      /* ── Glass key cap ── */
      .dh-key {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 42px;
        height: 42px;
        border-radius: 8px;
        border: 1.5px solid rgba(255, 255, 255, 0.18);
        background: radial-gradient(
          circle at 35% 35%,
          rgba(255, 255, 255, 0.14) 0%,
          rgba(255, 255, 255, 0.04) 100%
        );
        backdrop-filter: blur(4px);
        -webkit-backdrop-filter: blur(4px);
        box-shadow:
          inset 0 1px 1px rgba(255, 255, 255, 0.12),
          0 2px 6px rgba(0, 0, 0, 0.10);
        color: rgba(255, 255, 255, 0.55);
        font: 600 15px/1 system-ui, sans-serif;
        text-transform: uppercase;
        user-select: none;
      }
      .dh-key-wide {
        width: auto;
        padding: 0 14px;
        font-size: 12px;
        letter-spacing: 0.5px;
      }

      /* ── WASD cluster layout ── */
      .dh-wasd {
        position: fixed;
        bottom: 60px;
        left: 40px;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 4px;
        transition: opacity 1.0s ease;
      }
      .dh-wasd-row {
        display: flex;
        gap: 4px;
      }
      .dh-hint-label {
        margin-top: 6px;
        font: 10px/1 system-ui, sans-serif;
        color: rgba(255, 255, 255, 0.35);
        letter-spacing: 0.5px;
        text-transform: uppercase;
      }

      /* ── Swim keys (Space/Shift) ── */
      .dh-swim {
        position: fixed;
        bottom: 60px;
        left: 40px;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 4px;
        opacity: 0;
        transition: opacity 1.0s ease;
      }
      .dh-swim.dh-swim-visible {
        opacity: 1;
      }
      .dh-swim-row {
        display: flex;
        gap: 6px;
        align-items: center;
      }
      .dh-swim-arrow {
        font-size: 14px;
        color: rgba(255, 255, 255, 0.35);
      }

      /* ── Feed prompt ── */
      .dh-feed-prompt {
        position: fixed;
        bottom: 140px;
        left: 50%;
        transform: translateX(-50%);
        font: 500 16px/1 system-ui, sans-serif;
        color: rgba(255, 255, 255, 0.55);
        letter-spacing: 0.5px;
        text-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
        white-space: nowrap;
        opacity: 0;
        transition: opacity 1.5s ease;
      }
      .dh-feed-prompt.dh-visible {
        opacity: 1;
      }

      /* ── Aquarium hint (Tab key + icon) ── */
      .dh-aquarium {
        position: fixed;
        bottom: 60px;
        right: 40px;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 6px;
      }
      .dh-aquarium-row {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .dh-aquarium-icon {
        font-size: 22px;
        line-height: 1;
      }

      /* ── Shared fade-out ── */
      .dh-fade-out {
        opacity: 0 !important;
        transition: opacity 1.5s ease !important;
        pointer-events: none !important;
      }
    `;
    document.head.appendChild(style);
  }

  _createContainer() {
    this._container = document.createElement('div');
    this._container.className = 'dh-container';
    document.body.appendChild(this._container);
  }

  _createWASD() {
    const K = CameraController.KEYS;
    const wasd = document.createElement('div');
    wasd.className = 'dh-wasd';

    // Top row: forward
    const topRow = document.createElement('div');
    topRow.className = 'dh-wasd-row';
    topRow.appendChild(this._makeKey(K.forward));
    wasd.appendChild(topRow);

    // Bottom row: left, back, right
    const botRow = document.createElement('div');
    botRow.className = 'dh-wasd-row';
    botRow.appendChild(this._makeKey(K.left));
    botRow.appendChild(this._makeKey(K.back));
    botRow.appendChild(this._makeKey(K.right));
    wasd.appendChild(botRow);

    // Label
    const label = document.createElement('div');
    label.className = 'dh-hint-label';
    label.textContent = 'move';
    wasd.appendChild(label);

    this._container.appendChild(wasd);
    this._wasdEl = wasd;
  }

  _createSwimKeys() {
    const K = CameraController.KEYS;
    const swim = document.createElement('div');
    swim.className = 'dh-swim';

    // Swim up row: ↑ [key]
    const upRow = document.createElement('div');
    upRow.className = 'dh-swim-row';
    const upArrow = document.createElement('span');
    upArrow.className = 'dh-swim-arrow';
    upArrow.textContent = '↑';
    upRow.appendChild(upArrow);
    upRow.appendChild(this._makeKey(K.swimUp, true));
    swim.appendChild(upRow);

    // Swim down row: ↓ [key]
    const downRow = document.createElement('div');
    downRow.className = 'dh-swim-row';
    const downArrow = document.createElement('span');
    downArrow.className = 'dh-swim-arrow';
    downArrow.textContent = '↓';
    downRow.appendChild(downArrow);
    downRow.appendChild(this._makeKey(K.swimDown, true));
    swim.appendChild(downRow);

    // Label
    const label = document.createElement('div');
    label.className = 'dh-hint-label';
    label.textContent = 'swim up / down';
    swim.appendChild(label);

    this._container.appendChild(swim);
    this._swimEl = swim;
  }

  _showSwimKeys() {
    if (this._swimShown || this._disposed) return;
    this._swimShown = true;
    if (this._swimEl) this._swimEl.classList.add('dh-swim-visible');
  }

  _makeKey(letter, wide = false) {
    const key = document.createElement('div');
    key.className = 'dh-key' + (wide ? ' dh-key-wide' : '');
    key.textContent = letter;
    return key;
  }

  _createFeedPrompt() {
    const prompt = document.createElement('div');
    prompt.className = 'dh-feed-prompt';
    prompt.textContent = 'Click to Feed';
    this._container.appendChild(prompt);
    this._feedPrompt = prompt;
  }

  _createAquariumHint() {
    const el = document.createElement('div');
    el.className = 'dh-aquarium';

    // Row: [key] 🐠
    const K = CameraController.KEYS;
    const row = document.createElement('div');
    row.className = 'dh-aquarium-row';
    row.appendChild(this._makeKey(K.toggle, true));
    const icon = document.createElement('span');
    icon.className = 'dh-aquarium-icon';
    icon.textContent = '🐠';
    row.appendChild(icon);
    el.appendChild(row);

    // Label
    const label = document.createElement('div');
    label.className = 'dh-hint-label';
    label.textContent = 'watch';
    el.appendChild(label);

    this._container.appendChild(el);
    this._aquariumEl = el;
    this._aquariumIcon = icon;
    this._aquariumLabelEl = label;
  }

  _updateAquariumState() {
    if (!this._cameraController || !this._aquariumEl) return;
    const isAquarium = this._cameraController.mode === 'screensaver';

    // Swap icon and label
    this._aquariumIcon.textContent = isAquarium ? '🤿' : '🐠';
    this._aquariumLabelEl.textContent = isAquarium ? 'dive' : 'watch';

    // Hide movement hints in aquarium mode
    if (this._wasdEl && !this._wasdDismissed) {
      this._wasdEl.style.opacity = isAquarium ? '0' : '';
    }
    if (this._swimEl && this._swimShown) {
      this._swimEl.style.opacity = isAquarium ? '0' : '';
    }
    if (this._feedPrompt && !this._feedDismissed) {
      if (isAquarium) {
        this._feedPrompt.classList.remove('dh-visible');
      } else if (this._feedShown) {
        this._feedPrompt.classList.add('dh-visible');
      }
    }
  }

  /** Call when the first fish has spawned — triggers "Click to Feed" fade-in */
  showFeedPrompt() {
    if (this._feedShown || this._feedDismissed || this._disposed) return;
    this._feedShown = true;
    if (this._feedPrompt && this._cameraController?.mode !== 'screensaver') {
      this._feedPrompt.classList.add('dh-visible');
    }
  }

  /** Hide all hints (e.g. during title screen) */
  hide() {
    if (this._container) this._container.style.display = 'none';
  }

  /** Show hints */
  show() {
    if (this._container) this._container.style.display = '';
  }

  dispose() {
    this._disposed = true;
    if (this._onKeyDown) document.removeEventListener('keydown', this._onKeyDown);
    if (this._onMouseDown) document.removeEventListener('mousedown', this._onMouseDown);
    if (this._container) this._container.remove();
    const style = document.getElementById('desktop-hints-styles');
    if (style) style.remove();
  }
}
