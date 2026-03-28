import * as THREE from 'three';
import { CONFIG } from '../config.js';

// Water animation feature flag (ON for all platforms, toggle with ?useWaterAnim=0)
const _useWaterAnim = (() => {
  const params = new URLSearchParams(window.location.search);
  if (params.has('useWaterAnim')) return params.get('useWaterAnim') !== '0';
  return true;
})();

/**
 * WaterSurface
 * Animates terrain mesh vertices using GPU-accelerated wave animation.
 * Uses vertex shader injection to compute wave displacement and normals on GPU,
 * eliminating expensive CPU vertex loops and computeVertexNormals() calls.
 * Port of QT_SurfaceNoise from the original Unity project.
 */
class WaterSurface {
  constructor() {
    this.registeredMeshes = []; // Array of { mesh, uniforms }
  }

  /**
   * Patch a material's shader to apply water surface wave animation on GPU
   * Uses material.onBeforeCompile to inject vertex and normal shader code
   * @param {THREE.Mesh} mesh - The mesh whose material to patch
   */
  patchMaterial(mesh) {
    if (!_useWaterAnim) return null; // skip shader injection on mobile
    if (!mesh.material) {
      console.warn('WaterSurface: Mesh does not have a material');
      return null;
    }

    const material = mesh.material;

    // Create uniform for time
    const uniforms = {
      uTime: { value: 0.0 },
    };

    // Get config values as constants for the shader
    const { noiseSpeed, noiseScale, noiseStrength } = CONFIG.waterSurface;
    const amplitude = 1.25 * noiseStrength;

    // Inject shader code on material compilation
    material.onBeforeCompile = (shader) => {
      // Add our custom uniform to the shader
      shader.uniforms.uTime = uniforms.uTime;

      // ── Vertex shader injection ──
      // After the built-in vertex transformations, apply wave displacement
      // and compute analytical normals from the wave function derivative
      const vertexShaderCode = `
        // Water surface wave animation (GPU-accelerated)
        // Two overlapping waves at different angles to break stripe pattern
        float speed = ${noiseSpeed.toFixed(4)};
        float scale = ${noiseScale.toFixed(4)};
        float amp = ${amplitude.toFixed(4)};

        // Wave 1: along X axis
        float wave1Input = (uTime * speed + position.x) * scale;
        float sin1 = sin(wave1Input);
        float cos1 = cos(wave1Input);

        // Wave 2: along Z axis at different speed/scale
        float wave2Input = (uTime * speed * 0.7 + position.z) * scale * 1.3;
        float sin2 = sin(wave2Input);
        float cos2 = cos(wave2Input);

        // Wave 3: diagonal for extra chop
        float wave3Input = (uTime * speed * 0.5 + position.x * 0.7 + position.z * 0.7) * scale * 0.8;
        float sin3 = sin(wave3Input);

        // === MACRO MOTION — broad rolling swells ===
        float macroDisp = (sin1 * 0.5 + sin2 * 0.35 + sin3 * 0.15) * amp;

        // === MICRO ROUGHNESS — high-frequency chop detail ===
        // Two primary waves at varied angles to create surface texture (reduced from 4 for performance)
        float microAmp = amp * 0.18;  // ~18% of macro amplitude
        float microSpeed = speed * 1.15;
        float microScale = scale * 4.0;

        // Micro wave A: steep along X
        float mA = sin((uTime * microSpeed + position.x) * microScale) * 0.35;
        // Micro wave B: steep along Z, offset phase
        float mB = sin((uTime * microSpeed * 1.2 + position.z + 17.0) * microScale * 1.4) * 0.28;

        float microDisp = (mA + mB) * microAmp;

        // Sum macro + micro
        transformed.y += macroDisp + microDisp;

        // Don't override objectNormal — let the geometry's pre-jittered normals
        // + flatShading produce the faceted look. The wave displacement shifts
        // verts which further varies face angles each frame.
      `;

      // Declare the uniform at the top of the vertex shader
      shader.vertexShader = 'uniform float uTime;\n' + shader.vertexShader;

      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>\n${vertexShaderCode}`
      );
    };

    return uniforms;
  }

  /**
   * Register a mesh for water surface animation
   * Patches the material's shader to apply GPU-accelerated wave animation
   * @param {THREE.Mesh} mesh - The mesh to animate
   */
  register(mesh) {
    if (!mesh.material) {
      console.warn('WaterSurface: Mesh does not have a material');
      return;
    }

    // Patch the material's shader
    const uniforms = this.patchMaterial(mesh);

    if (!uniforms) {
      console.warn('WaterSurface: Failed to patch material');
      return;
    }

    this.registeredMeshes.push({
      mesh,
      uniforms,
    });
  }

  /**
   * Update all registered meshes
   * Simply updates the uTime uniform — all vertex deformation happens in the GPU shader
   * @param {number} time - Current time in seconds
   */
  update(time) {
    // Update each registered mesh's time uniform
    for (const { uniforms } of this.registeredMeshes) {
      uniforms.uTime.value = time;
    }
  }

  /**
   * Unregister a mesh (stop animating it)
   * @param {THREE.Mesh} mesh - The mesh to stop animating
   */
  unregister(mesh) {
    this.registeredMeshes = this.registeredMeshes.filter((item) => item.mesh !== mesh);
  }

  /**
   * Clear all registered meshes
   */
  clearAll() {
    this.registeredMeshes = [];
  }
}

// Export singleton instance
export default new WaterSurface();
