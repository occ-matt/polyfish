// ── Instancing Comparison Demo ──
// Canvas 2D demo showing the difference between individual and instanced rendering

export function init(container) {
  const canvas = document.createElement('canvas');
  canvas.id = 'demo-instancing';

  const label = document.createElement('div');
  label.className = 'demo-label';
  label.textContent = 'Draw call comparison: individual vs. instanced rendering';

  const controls = document.createElement('div');
  controls.className = 'demo-controls';
  controls.innerHTML = `
    <label>Creatures <input type="range" id="ctrl-creatures" min="10" max="200" value="60" step="5"><span id="val-creatures">60</span></label>
  `;

  container.appendChild(canvas);
  container.appendChild(label);
  container.appendChild(controls);

  class InstancingComparison {
    constructor(canvasElement) {
      this.canvas = canvasElement;
      this.ctx = this.canvas.getContext('2d');
      this.width = this.canvas.offsetWidth;
      this.height = this.canvas.offsetHeight;
      this.canvas.width = this.width * (window.devicePixelRatio || 1);
      this.canvas.height = this.height * (window.devicePixelRatio || 1);
      this.ctx.scale(window.devicePixelRatio || 1, window.devicePixelRatio || 1);

      this.creatureCount = 60;
      this.colors = [];
      this.positions = [];
      this.generateCreatures();

      this.animate();
    }

    generateCreatures() {
      this.colors = [];
      this.positions = [];
      // Generate positions centered within a narrower column
      const columnWidth = this.width * 0.3;  // narrower column
      const columnHeight = this.height * 0.6;
      const columnStartX = (this.width * 0.5 - columnWidth) / 2;  // centered within left half
      const columnStartY = (this.height - columnHeight) / 2;

      for (let i = 0; i < this.creatureCount; i++) {
        this.colors.push(`hsl(${Math.random() * 360}, 70%, 50%)`);
        this.positions.push({
          x: Math.random() * columnWidth + columnStartX,
          y: Math.random() * columnHeight + columnStartY
        });
      }
    }

    drawHalf(startX, isInstanced) {
      // Draw half background
      this.ctx.fillStyle = '#0f1419';
      this.ctx.fillRect(startX, 0, this.width * 0.5, this.height);

      // Draw subtle border around content area
      this.ctx.strokeStyle = 'rgba(255, 153, 51, 0.1)';
      this.ctx.lineWidth = 1;
      const padding = 20;
      this.ctx.strokeRect(startX + padding, padding, this.width * 0.5 - padding * 2, this.height - padding * 2);

      // Draw creatures
      for (let i = 0; i < this.creatureCount; i++) {
        const pos = this.positions[i];
        this.ctx.fillStyle = this.colors[i];
        this.ctx.beginPath();
        this.ctx.arc(startX + pos.x, pos.y, 5, 0, Math.PI * 2);
        this.ctx.fill();
      }

      // Draw section label (top left)
      this.ctx.fillStyle = 'rgba(255,255,255,0.4)';
      this.ctx.font = '11px ' + 'var(--font-mono, monospace)';
      this.ctx.textAlign = 'left';
      this.ctx.fillText(isInstanced ? 'INSTANCEDMESH' : 'INDIVIDUAL MESHES', startX + padding, padding + 15);

      // Draw draw call count (bottom)
      const drawCallText = isInstanced ? '1 draw call' : this.creatureCount + ' draw calls';
      this.ctx.font = 'bold 16px ' + 'var(--font-mono, monospace)';
      const metrics = this.ctx.measureText(drawCallText);
      const textWidth = metrics.width;
      const textX = startX + (this.width * 0.5 - textWidth) / 2;
      const textY = this.height - 30;

      // Background for draw call count
      this.ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
      this.ctx.fillRect(textX - 8, textY - 18, textWidth + 16, 24);

      // Draw call text in accent color
      this.ctx.fillStyle = '#f93';
      this.ctx.fillText(drawCallText, textX, textY);
    }

    animate = () => {
      // Clear background
      this.ctx.fillStyle = '#0a1628';
      this.ctx.fillRect(0, 0, this.width, this.height);

      // Draw left half (individual meshes)
      this.drawHalf(0, false);

      // Draw right half (instanced)
      this.drawHalf(this.width * 0.5, true);

      // Draw vertical separator line in the middle
      this.ctx.strokeStyle = 'rgba(255, 153, 51, 0.2)';
      this.ctx.lineWidth = 2;
      this.ctx.beginPath();
      this.ctx.moveTo(this.width * 0.5, 0);
      this.ctx.lineTo(this.width * 0.5, this.height);
      this.ctx.stroke();

      // Draw comparison label and reduction percentage at very top
      const reduction = Math.round((1 - 1 / this.creatureCount) * 100);
      this.ctx.fillStyle = '#f93';
      this.ctx.font = 'bold 12px ' + 'var(--font-mono, monospace)';
      this.ctx.textAlign = 'center';
      this.ctx.fillText(`${reduction}% reduction in draw calls`, this.width * 0.5, 18);

      requestAnimationFrame(this.animate);
    }
  }

  const demo = new InstancingComparison(canvas);

  // Setup control listener
  document.getElementById('ctrl-creatures').addEventListener('input', (e) => {
    demo.creatureCount = parseInt(e.target.value);
    demo.generateCreatures();
    document.getElementById('val-creatures').textContent = e.target.value;
  });
}
