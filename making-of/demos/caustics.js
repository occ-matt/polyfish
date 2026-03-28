// Caustic Pattern Generator Module
// Canvas 2D demo - renders at quarter resolution for performance

export function init(container) {
  // Create canvas element
  const canvas = document.createElement('canvas');
  canvas.className = 'demo-canvas';
  container.appendChild(canvas);

  // Create label
  const label = document.createElement('div');
  label.className = 'demo-label';
  label.textContent = 'Top-down view of seafloor - animated caustic light patterns play across sandy ocean floor';
  container.appendChild(label);

  // Create controls
  const controls = document.createElement('div');
  controls.className = 'demo-controls';
  controls.innerHTML = `
    <label>Speed <input type="range" id="ctrl-speed" min="0" max="1" value="0.4" step="0.05"><span id="val-speed">0.4</span></label>
    <label>Intensity <input type="range" id="ctrl-intensity" min="0.1" max="1.5" value="0.7" step="0.05"><span id="val-intensity">0.7</span></label>
    <label>Scale <input type="range" id="ctrl-scale" min="0.5" max="4" value="1.5" step="0.1"><span id="val-scale">1.5</span></label>
    <label>Octaves <input type="range" id="ctrl-octaves" min="1" max="3" value="2" step="1"><span id="val-octaves">2</span></label>
  `;
  container.appendChild(controls);

  // Caustic generator class
  class CausticGenerator {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      // Logical size
      this.logW = canvas.offsetWidth;
      this.logH = canvas.offsetHeight;
      // Render at quarter resolution for speed
      this.rW = Math.ceil(this.logW / 4);
      this.rH = Math.ceil(this.logH / 4);
      // Back-buffer canvas at render resolution
      this.buf = document.createElement('canvas');
      this.buf.width = this.rW;
      this.buf.height = this.rH;
      this.bufCtx = this.buf.getContext('2d');
      this.imgData = this.bufCtx.createImageData(this.rW, this.rH);
      // Display canvas at logical size
      this.canvas.width = this.logW;
      this.canvas.height = this.logH;
      this.ctx.imageSmoothingEnabled = true;
      this.ctx.imageSmoothingQuality = 'high';

      this.time = 0;
      this.speed = 0.4;
      this.intensity = 0.7;
      this.scale = 1.5;
      this.octaves = 2;

      this.animate();
    }

    // Hash-based pseudo-random - fast, repeatable
    hash(x, y) {
      let n = x * 127.1 + y * 311.7;
      n = Math.sin(n) * 43758.5453;
      return n - Math.floor(n);
    }

    voronoi(px, py) {
      const cellX = Math.floor(px);
      const cellY = Math.floor(py);
      const fracX = px - cellX;
      const fracY = py - cellY;
      let minDist = 2.0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = cellX + dx;
          const ny = cellY + dy;
          // Animated point - slow drift over time
          const r1 = this.hash(nx, ny);
          const r2 = this.hash(nx + 37, ny + 91);
          const ptx = dx + 0.5 + 0.4 * Math.sin(this.time * 0.8 + r1 * 6.28);
          const pty = dy + 0.5 + 0.4 * Math.cos(this.time * 0.7 + r2 * 6.28);
          const ex = ptx - fracX;
          const ey = pty - fracY;
          const dist = Math.sqrt(ex * ex + ey * ey);
          if (dist < minDist) minDist = dist;
        }
      }
      return minDist;
    }

    caustic(x, y) {
      const s = this.scale;
      const px = x * s;
      const py = y * s;
      // First Voronoi octave
      const d0 = this.voronoi(px, py);
      let val = d0;
      if (this.octaves >= 2) {
        // Domain-warped second octave
        const wx = px * 2.0 + d0 * 1.2;
        const wy = py * 2.0 + d0 * 1.2;
        const d1 = this.voronoi(wx, wy);
        val = (d0 + d1 * 0.6) * 0.625;
      }
      if (this.octaves >= 3) {
        const wx2 = px * 4.0 + val * 0.8;
        const wy2 = py * 4.0 + val * 0.8;
        const d2 = this.voronoi(wx2, wy2);
        val = val * 0.75 + d2 * 0.25;
      }
      // Edge-bright caustic: invert distance, sharpen with power curve
      const raw = 1.0 - Math.min(val, 1.0);
      return Math.pow(raw, 1.6) * this.intensity;
    }

    animate = () => {
      this.time += 0.016 * (this.speed + 0.15);
      const data = this.imgData.data;
      const rW = this.rW;
      const rH = this.rH;

      for (let y = 0; y < rH; y++) {
        const ny = y / rH;
        for (let x = 0; x < rW; x++) {
          const nx = x / rW;
          const c = this.caustic(nx, ny);
          const idx = (y * rW + x) * 4;

          // Sandy ocean floor base with subtle grain/noise texture
          const grainX = Math.sin(nx * 12.7 + this.time * 0.2) * 0.5 + 0.5;
          const grainY = Math.cos(ny * 13.3 + this.time * 0.15) * 0.5 + 0.5;
          const grain = (grainX + grainY) * 0.5;

          // Sandy brown base color with grain variation
          const sandBase = 0.15 + grain * 0.08;
          const r = Math.floor((0.50 + sandBase) * 255);
          const g = Math.floor((0.45 + sandBase) * 255);
          const b = Math.floor((0.35 + sandBase) * 255);

          // Blend caustics on top of sandy base
          const causticsStr = Math.min(c * 255, 255);
          data[idx]     = Math.min(r + causticsStr * 0.3, 255);   // R (warm sand + caustic)
          data[idx + 1] = Math.min(g + causticsStr * 0.5, 255);   // G (aqua caustic)
          data[idx + 2] = Math.min(b + causticsStr * 0.7, 255);   // B (dominant caustic)
          data[idx + 3] = 255;
        }
      }

      this.bufCtx.putImageData(this.imgData, 0, 0);
      // Upscale with bilinear smoothing
      this.ctx.drawImage(this.buf, 0, 0, this.logW, this.logH);
      requestAnimationFrame(this.animate);
    }
  }

  // Initialize generator
  const causticGen = new CausticGenerator(canvas);

  // Set up controls
  const speedCtrl = controls.querySelector('#ctrl-speed');
  const intensityCtrl = controls.querySelector('#ctrl-intensity');
  const scaleCtrl = controls.querySelector('#ctrl-scale');
  const octavesCtrl = controls.querySelector('#ctrl-octaves');

  speedCtrl.addEventListener('input', (e) => {
    causticGen.speed = parseFloat(e.target.value);
    controls.querySelector('#val-speed').textContent = e.target.value;
  });

  intensityCtrl.addEventListener('input', (e) => {
    causticGen.intensity = parseFloat(e.target.value);
    controls.querySelector('#val-intensity').textContent = e.target.value;
  });

  scaleCtrl.addEventListener('input', (e) => {
    causticGen.scale = parseFloat(e.target.value);
    controls.querySelector('#val-scale').textContent = e.target.value;
  });

  octavesCtrl.addEventListener('input', (e) => {
    causticGen.octaves = parseInt(e.target.value);
    controls.querySelector('#val-octaves').textContent = e.target.value;
  });
}
