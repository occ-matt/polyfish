// ── Spatial Hash Visualizer Demo ──
// Canvas 2D demo showing spatial hashing grid and query radius

export function init(container) {
  const canvas = document.createElement('canvas');
  canvas.id = 'demo-spatial-hash';

  const label = document.createElement('div');
  label.className = 'demo-label';
  label.textContent = 'Spatial Hash Grid - drag a dot to see which cells it touches';

  const controls = document.createElement('div');
  controls.className = 'demo-controls';
  controls.innerHTML = `
    <label>Cell Size <input type="range" id="ctrl-cell-size" min="2" max="20" value="5" step="1"><span id="val-cell-size">5</span></label>
    <label>Query Radius <input type="range" id="ctrl-query-radius" min="1" max="8" value="3" step="0.5"><span id="val-query-radius">3</span></label>
    <label>Creatures <input type="range" id="ctrl-creature-count" min="5" max="50" value="20" step="1"><span id="val-creature-count">20</span></label>
    <button id="btn-reset-spatial">Reset</button>
    <span id="spatial-hash-stats" style="font-family: var(--font-mono); font-size: 0.72rem; color: rgba(255,255,255,0.4); text-transform: uppercase; letter-spacing: 0.04em; margin-left: auto;"></span>
  `;

  container.appendChild(canvas);
  container.appendChild(label);
  container.appendChild(controls);

  class SpatialHashDemo {
    constructor(canvasElement) {
      this.canvas = canvasElement;
      this.ctx = canvas.getContext('2d');
      this.setupCanvas();

      this.cellSize = 5;
      this.queryRadius = 3;
      this.creatures = [];
      this.draggedCreature = null;

      this.initCreatures(20);
      this.animate();
      this.setupControls();
      this.setupMouse();
    }

    setupCanvas() {
      const rect = this.canvas.getBoundingClientRect();
      this.canvas.width = rect.width * window.devicePixelRatio;
      this.canvas.height = rect.height * window.devicePixelRatio;
      this.ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
      this.width = rect.width;
      this.height = rect.height;
    }

    initCreatures(count) {
      this.creatures = [];
      for (let i = 0; i < count; i++) {
        this.creatures.push({
          x: Math.random() * (this.width - 40) + 20,
          y: Math.random() * (this.height - 40) + 20,
          vx: (Math.random() - 0.5) * 2,
          vy: (Math.random() - 0.5) * 2,
          color: `hsl(${Math.random() * 360}, 70%, 50%)`
        });
      }
    }

    spatialHash(x, y) {
      const cx = Math.floor(x / this.cellSize);
      const cy = Math.floor(y / this.cellSize);
      return (cx * 73856093) ^ (cy * 19349663);
    }

    getCellCoords(x, y) {
      return {
        cx: Math.floor(x / this.cellSize),
        cy: Math.floor(y / this.cellSize)
      };
    }

    getNearbyCreatures(x, y) {
      const coords = this.getCellCoords(x, y);
      const nearby = [];
      for (let dx = -this.queryRadius; dx <= this.queryRadius; dx++) {
        for (let dy = -this.queryRadius; dy <= this.queryRadius; dy++) {
          const hash = (((coords.cx + dx) * 73856093) ^ ((coords.cy + dy) * 19349663));
          for (let c of this.creatures) {
            const cc = this.getCellCoords(c.x, c.y);
            if (((cc.cx * 73856093) ^ (cc.cy * 19349663)) === hash) {
              nearby.push(c);
            }
          }
        }
      }
      return nearby;
    }

    animate = () => {
      this.update();
      this.draw();
      requestAnimationFrame(this.animate);
    }

    update() {
      const padding = 20;
      for (let c of this.creatures) {
        c.x += c.vx * 0.5;
        c.y += c.vy * 0.5;

        if (c.x < padding || c.x > this.width - padding) c.vx *= -1;
        if (c.y < padding || c.y > this.height - padding) c.vy *= -1;

        c.x = Math.max(padding, Math.min(this.width - padding, c.x));
        c.y = Math.max(padding, Math.min(this.height - padding, c.y));
      }
    }

    draw() {
      this.ctx.fillStyle = '#0a1628';
      this.ctx.fillRect(0, 0, this.width, this.height);

      // Draw grid
      this.ctx.strokeStyle = 'rgba(255,255,255,0.1)';
      this.ctx.lineWidth = 0.5;
      for (let x = 0; x <= this.width; x += this.cellSize * window.devicePixelRatio / window.devicePixelRatio) {
        this.ctx.beginPath();
        this.ctx.moveTo(x, 0);
        this.ctx.lineTo(x, this.height);
        this.ctx.stroke();
      }
      for (let y = 0; y <= this.height; y += this.cellSize * window.devicePixelRatio / window.devicePixelRatio) {
        this.ctx.beginPath();
        this.ctx.moveTo(0, y);
        this.ctx.lineTo(this.width, y);
        this.ctx.stroke();
      }

      // Draw highlighted cells if dragging
      if (this.draggedCreature) {
        const coords = this.getCellCoords(this.draggedCreature.x, this.draggedCreature.y);

        // Draw current cell
        this.ctx.fillStyle = 'rgba(100, 200, 255, 0.15)';
        this.ctx.fillRect(
          coords.cx * this.cellSize,
          coords.cy * this.cellSize,
          this.cellSize,
          this.cellSize
        );

        // Draw query radius cells
        this.ctx.fillStyle = 'rgba(255, 100, 150, 0.1)';
        for (let dx = -this.queryRadius; dx <= this.queryRadius; dx++) {
          for (let dy = -this.queryRadius; dy <= this.queryRadius; dy++) {
            if (dx === 0 && dy === 0) continue;
            this.ctx.fillRect(
              (coords.cx + dx) * this.cellSize,
              (coords.cy + dy) * this.cellSize,
              this.cellSize,
              this.cellSize
            );
          }
        }

        // Draw info
        this.ctx.fillStyle = 'rgba(255,255,255,0.8)';
        this.ctx.font = '11px monospace';
        const hash = this.spatialHash(this.draggedCreature.x, this.draggedCreature.y);
        this.ctx.fillText(`Cell: (${coords.cx}, ${coords.cy})`, 10, 20);
        this.ctx.fillText(`Hash: ${hash}`, 10, 35);
        this.ctx.fillText(`Query Radius: ${this.queryRadius}`, 10, 50);
      }

      // Draw creatures
      for (let c of this.creatures) {
        this.ctx.fillStyle = c === this.draggedCreature ? '#ffff00' : c.color;
        this.ctx.beginPath();
        this.ctx.arc(c.x, c.y, 5, 0, Math.PI * 2);
        this.ctx.fill();
      }
    }

    setupMouse() {
      this.canvas.addEventListener('mousedown', (e) => {
        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        for (let c of this.creatures) {
          if (Math.hypot(c.x - x, c.y - y) < 10) {
            this.draggedCreature = c;
            break;
          }
        }
      });

      this.canvas.addEventListener('mousemove', (e) => {
        if (this.draggedCreature) {
          const rect = this.canvas.getBoundingClientRect();
          this.draggedCreature.x = e.clientX - rect.left;
          this.draggedCreature.y = e.clientY - rect.top;
        }
      });

      this.canvas.addEventListener('mouseup', () => {
        this.draggedCreature = null;
      });

      this.canvas.addEventListener('mouseleave', () => {
        this.draggedCreature = null;
      });
    }

    setupControls() {
      document.getElementById('ctrl-cell-size').addEventListener('input', (e) => {
        this.cellSize = parseFloat(e.target.value);
        document.getElementById('val-cell-size').textContent = this.cellSize;
        this.updateStats();
      });

      document.getElementById('ctrl-query-radius').addEventListener('input', (e) => {
        this.queryRadius = parseFloat(e.target.value);
        document.getElementById('val-query-radius').textContent = this.queryRadius;
        this.updateStats();
      });

      document.getElementById('ctrl-creature-count').addEventListener('input', (e) => {
        this.initCreatures(parseInt(e.target.value));
        document.getElementById('val-creature-count').textContent = e.target.value;
        this.updateStats();
      });

      document.getElementById('btn-reset-spatial').addEventListener('click', () => {
        this.initCreatures(parseInt(document.getElementById('ctrl-creature-count').value));
        this.updateStats();
      });

      // Initial stats update
      this.updateStats();
    }

    updateStats() {
      const creatureCount = this.creatures.length;
      const gridWidth = Math.ceil(this.width / this.cellSize);
      const gridHeight = Math.ceil(this.height / this.cellSize);
      const totalCells = gridWidth * gridHeight;

      // Calculate cells checked in a radius query
      const cellsChecked = Math.pow(2 * this.queryRadius + 1, 2);

      // Average creatures per cell
      const avgCreaturesPerCell = creatureCount / totalCells;

      // Brute force: O(n2) - check every creature against every other
      const bruteForceTime = creatureCount * creatureCount * 0.001;

      // Spatial hash: check only nearby creatures
      const spatialHashTime = cellsChecked * avgCreaturesPerCell * 0.001;

      // Speedup factor
      const speedup = bruteForceTime > 0 ? bruteForceTime / spatialHashTime : 1;

      // Format the stats string
      const statsEl = document.getElementById('spatial-hash-stats');
      statsEl.textContent = `Cells checked: ${cellsChecked} | Avg/cell: ${avgCreaturesPerCell.toFixed(1)} | Simulated: ${spatialHashTime.toFixed(2)}ms vs brute force: ${bruteForceTime.toFixed(2)}ms (${speedup.toFixed(0)}x faster)`;
    }
  }

  new SpatialHashDemo(canvas);
}
