/**
 * Water surface wave height utility.
 * Computes wave displacement at any given (x, z) position.
 *
 * Two versions:
 *   - getMacroWaveHeight() — smooth, low-frequency swell (for camera/creature bobbing)
 *   - getFullWaveHeight() — includes micro detail (for advanced uses)
 *
 * The macro wave is extracted from the vertex shader's wave formula,
 * using only the low-frequency components for smooth bobbing.
 */

import { CONFIG } from '../config.js';

/**
 * Get the macro (low-frequency, smooth) wave height at position (x, z).
 * This is used for syncing player camera and creature positions with water surface.
 *
 * Macro wave = broad rolling swells (3 overlapping waves at different angles/speeds)
 * Excludes micro chop detail for a cleaner bob effect.
 *
 * @param {number} x - World X position
 * @param {number} z - World Z position
 * @param {number} time - Elapsed time in seconds
 * @returns {number} Vertical displacement (in units)
 */
export function getMacroWaveHeight(x, z, time) {
  const { noiseSpeed, noiseScale, noiseStrength } = CONFIG.waterSurface;
  const amplitude = 1.25 * noiseStrength;

  // These wave parameters match the vertex shader exactly
  const speed = noiseSpeed;
  const scale = noiseScale;
  const amp = amplitude;

  // Wave 1: along X axis
  const wave1Input = (time * speed + x) * scale;
  const sin1 = Math.sin(wave1Input);

  // Wave 2: along Z axis at different speed/scale
  const wave2Input = (time * speed * 0.7 + z) * scale * 1.3;
  const sin2 = Math.sin(wave2Input);

  // Wave 3: diagonal for extra chop
  const wave3Input = (time * speed * 0.5 + x * 0.7 + z * 0.7) * scale * 0.8;
  const sin3 = Math.sin(wave3Input);

  // === MACRO MOTION — broad rolling swells ===
  const macroDisp = (sin1 * 0.5 + sin2 * 0.35 + sin3 * 0.15) * amp;

  return macroDisp;
}

/**
 * Get the full wave height including micro detail.
 * This matches the vertex shader exactly (macro + micro).
 *
 * @param {number} x - World X position
 * @param {number} z - World Z position
 * @param {number} time - Elapsed time in seconds
 * @returns {number} Vertical displacement (in units)
 */
export function getFullWaveHeight(x, z, time) {
  const { noiseSpeed, noiseScale, noiseStrength } = CONFIG.waterSurface;
  const amplitude = 1.25 * noiseStrength;

  const speed = noiseSpeed;
  const scale = noiseScale;
  const amp = amplitude;

  // ── MACRO MOTION ──
  const wave1Input = (time * speed + x) * scale;
  const sin1 = Math.sin(wave1Input);

  const wave2Input = (time * speed * 0.7 + z) * scale * 1.3;
  const sin2 = Math.sin(wave2Input);

  const wave3Input = (time * speed * 0.5 + x * 0.7 + z * 0.7) * scale * 0.8;
  const sin3 = Math.sin(wave3Input);

  const macroDisp = (sin1 * 0.5 + sin2 * 0.35 + sin3 * 0.15) * amp;

  // ── MICRO ROUGHNESS ──
  const microAmp = amp * 0.18;
  const microSpeed = speed * 1.15;
  const microScale = scale * 4.0;

  const mA = Math.sin((time * microSpeed + x) * microScale) * 0.35;
  const mB = Math.sin((time * microSpeed * 1.2 + z + 17.0) * microScale * 1.4) * 0.28;
  const mC = Math.sin((time * microSpeed * 0.8 + x * 0.6 - z * 0.8 + 7.5) * microScale * 1.8) * 0.22;
  const mD = Math.sin((time * microSpeed * 1.5 - x * 0.5 + z * 0.9 + 31.0) * microScale * 2.3) * 0.15;

  const microDisp = (mA + mB + mC + mD) * microAmp;

  return macroDisp + microDisp;
}
