import { CONFIG } from '../config.js';
import sceneManager from './SceneManager.js';

/**
 * FadeOverlay
 * Manages fade transitions using an HTML overlay element and scene fog animation.
 * Provides smooth visual transitions between scenes.
 */
class FadeOverlay {
  constructor() {
    this.overlay = null;
    this.isAnimating = false;
  }

  /**
   * Initialize the fade overlay
   * Retrieves the #fade-overlay DOM element and sets initial state
   */
  init() {
    this.overlay = document.getElementById('fade-overlay');
    if (!this.overlay) {
      console.warn('FadeOverlay: #fade-overlay element not found in DOM');
      return;
    }

    // Set initial state: fully opaque (black)
    this.overlay.style.opacity = '1';
    this.overlay.style.transition = 'none'; // No transition initially
  }

  /**
   * Set overlay opacity directly
   * @param {number} value - Opacity value (0-1)
   */
  setOpacity(value) {
    if (this.overlay) {
      this.overlay.style.opacity = Math.max(0, Math.min(1, value));
    }
  }

  /**
   * Fade from black to transparent
   * Also animates fog density for immersive effect
   * @param {number} duration - Duration in milliseconds
   * @returns {Promise} Resolves when fade is complete
   */
  fadeIn(duration) {
    return new Promise((resolve) => {
      if (!this.overlay) {
        resolve();
        return;
      }

      this.isAnimating = true;
      const startTime = Date.now();
      const initialFogDensity = sceneManager.getScene().fog?.density ?? 0.015;

      const animate = () => {
        const elapsed = Date.now() - startTime;
        const progress = Math.min(1, elapsed / duration);

        // Fade overlay (from opaque to transparent)
        this.setOpacity(1 - progress);

        // Animate fog density (slightly decrease for reveal effect)
        const scene = sceneManager.getScene();
        if (scene.fog) {
          scene.fog.density = initialFogDensity * (1 - progress * 0.1);
        }

        if (progress < 1) {
          requestAnimationFrame(animate);
        } else {
          this.isAnimating = false;
          resolve();
        }
      };

      animate();
    });
  }

  /**
   * Fade from transparent to black
   * Also animates fog density for immersive effect
   * @param {number} duration - Duration in milliseconds
   * @returns {Promise} Resolves when fade is complete
   */
  fadeOut(duration) {
    return new Promise((resolve) => {
      if (!this.overlay) {
        resolve();
        return;
      }

      this.isAnimating = true;
      const startTime = Date.now();
      const initialFogDensity = sceneManager.getScene().fog?.density ?? 0.015;

      const animate = () => {
        const elapsed = Date.now() - startTime;
        const progress = Math.min(1, elapsed / duration);

        // Fade overlay (from transparent to opaque)
        this.setOpacity(progress);

        // Animate fog density (slightly increase for vignette effect)
        const scene = sceneManager.getScene();
        if (scene.fog) {
          scene.fog.density = initialFogDensity * (1 + progress * 0.1);
        }

        if (progress < 1) {
          requestAnimationFrame(animate);
        } else {
          this.isAnimating = false;
          resolve();
        }
      };

      animate();
    });
  }
}

// Export singleton instance
export default new FadeOverlay();
