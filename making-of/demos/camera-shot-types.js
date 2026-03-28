// Camera Shot Types - Interactive shot type visualizer
// Shows 11 different camera framing techniques from top-down view
// Click buttons to switch between shot types

export function init(container) {
  // Create canvas
  const canvas = document.createElement('canvas');
  canvas.id = 'demo-shot-types';
  canvas.width = 800;
  canvas.height = 400;
  container.appendChild(canvas);

  // Create label
  const label = document.createElement('div');
  label.className = 'demo-label';
  label.textContent = 'Shot Type Visualizer - top-down view. Click buttons to switch shot types.';
  container.appendChild(label);

  // Create controls
  const controlsDiv = document.createElement('div');
  controlsDiv.className = 'demo-controls';
  const buttons = [
    { label: 'Establishing', type: 'ESTABLISHING_WIDE' },
    { label: 'Hero', type: 'HERO_PORTRAIT' },
    { label: 'Chase', type: 'CHASE_FOLLOW' },
    { label: 'Side Track', type: 'SIDE_TRACK' },
    { label: 'Ground Hide', type: 'GROUND_HIDE' },
    { label: 'Snell\'s', type: 'SNELLS_WINDOW' },
    { label: 'Reveal', type: 'SLOW_REVEAL' },
    { label: 'Fly Through', type: 'FLY_THROUGH' },
    { label: 'Reaction', type: 'REACTION_CUT' },
    { label: 'Macro', type: 'MACRO_DETAIL' },
    { label: 'Kelp Edge', type: 'KELP_EDGE' }
  ];

  const shotTypeDemo = {
    canvas: canvas,
    ctx: canvas.getContext('2d'),
    currentShotType: 'ESTABLISHING_WIDE',
    time: 0,

    shotGeometry: {
      'ESTABLISHING_WIDE': { distance: 6, angle: 45, fov: 50, description: 'High orbit, wide view' },
      'HERO_PORTRAIT': { distance: 2, angle: 90, fov: 40, description: 'Rule-of-thirds profile' },
      'CHASE_FOLLOW': { distance: 3.5, angle: 225, fov: 45, description: 'Quartering behind' },
      'SIDE_TRACK': { distance: 3, angle: 90, fov: 50, description: 'Parallel tracking' },
      'GROUND_HIDE': { distance: 4, angle: 0, fov: 55, description: 'Low angle, static' },
      'SNELLS_WINDOW': { distance: 3, angle: 270, fov: 60, description: 'Looking up from below' },
      'SLOW_REVEAL': { distance: 0.5, angle: 90, fov: 80, description: 'Extreme close-up detail' },
      'FLY_THROUGH': { distance: 2.5, angle: 315, fov: 65, description: 'Dolly through space' },
      'REACTION_CUT': { distance: 2.2, angle: 135, fov: 45, description: 'Secondary subject, tight' },
      'MACRO_DETAIL': { distance: 0.3, angle: 45, fov: 90, description: 'Macro with shallow DOF' },
      'KELP_EDGE': { distance: 4, angle: 200, fov: 55, description: 'Low angle at kelp periphery, looking up' }
    },

    draw() {
      const w = this.canvas.width;
      const h = this.canvas.height;
      const cx = w / 2;
      const cy = h / 2;
      const scale = 30; // pixels per unit

      // Clear
      this.ctx.fillStyle = 'rgba(10, 22, 40, 1)';
      this.ctx.fillRect(0, 0, w, h);

      // Grid
      this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
      this.ctx.lineWidth = 1;
      for (let i = -10; i <= 10; i += 2) {
        this.ctx.beginPath();
        this.ctx.moveTo(cx + i * scale, 0);
        this.ctx.lineTo(cx + i * scale, h);
        this.ctx.stroke();
        this.ctx.beginPath();
        this.ctx.moveTo(0, cy + i * scale);
        this.ctx.lineTo(w, cy + i * scale);
        this.ctx.stroke();
      }

      // Subject (fish/creature) at center
      this.ctx.fillStyle = 'rgba(255, 153, 51, 0.8)';
      this.ctx.beginPath();
      this.ctx.arc(cx, cy, 0.5 * scale, 0, Math.PI * 2);
      this.ctx.fill();

      // Subject heading (forward direction)
      this.ctx.strokeStyle = 'rgba(255, 153, 51, 0.6)';
      this.ctx.lineWidth = 2;
      this.ctx.beginPath();
      this.ctx.moveTo(cx, cy);
      this.ctx.lineTo(cx + 1.5 * scale, cy);
      this.ctx.stroke();

      // Get current shot geometry
      const geom = this.shotGeometry[this.currentShotType];
      const angleRad = (geom.angle * Math.PI) / 180;
      const camX = cx + geom.distance * scale * Math.cos(angleRad);
      const camY = cy + geom.distance * scale * Math.sin(angleRad);

      // Camera position (triangle)
      this.ctx.fillStyle = 'rgba(137, 180, 250, 0.9)';
      this.ctx.save();
      this.ctx.translate(camX, camY);
      this.ctx.rotate(angleRad - Math.PI / 2);
      this.ctx.beginPath();
      this.ctx.moveTo(0, -12);
      this.ctx.lineTo(-10, 10);
      this.ctx.lineTo(10, 10);
      this.ctx.closePath();
      this.ctx.fill();
      this.ctx.restore();

      // Frustum (cone showing camera view)
      const fovHalf = (geom.fov / 2) * Math.PI / 180;
      const towardSubject = angleRad + Math.PI;
      const leftAngle = towardSubject - fovHalf;
      const rightAngle = towardSubject + fovHalf;
      const frustumLen = geom.distance * 0.9 * scale;

      this.ctx.strokeStyle = 'rgba(137, 180, 250, 0.3)';
      this.ctx.lineWidth = 1.5;
      this.ctx.beginPath();
      this.ctx.moveTo(camX, camY);
      this.ctx.lineTo(camX + frustumLen * Math.cos(leftAngle), camY + frustumLen * Math.sin(leftAngle));
      this.ctx.stroke();
      this.ctx.beginPath();
      this.ctx.moveTo(camX, camY);
      this.ctx.lineTo(camX + frustumLen * Math.cos(rightAngle), camY + frustumLen * Math.sin(rightAngle));
      this.ctx.stroke();

      // Arc for view cone
      this.ctx.strokeStyle = 'rgba(137, 180, 250, 0.2)';
      this.ctx.lineWidth = 1;
      this.ctx.beginPath();
      this.ctx.arc(camX, camY, frustumLen, leftAngle, rightAngle);
      this.ctx.stroke();

      // Info text
      this.ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
      this.ctx.font = '13px JetBrains Mono';
      this.ctx.textAlign = 'left';
      this.ctx.fillText(`Shot: ${this.currentShotType}`, 20, 25);
      this.ctx.fillText(`Distance: ${geom.distance.toFixed(1)} units`, 20, 45);
      this.ctx.fillText(`Angle: ${geom.angle}°`, 20, 65);
      this.ctx.fillText(`FOV: ${geom.fov}°`, 20, 85);
      this.ctx.fillText(geom.description, 20, 110);

      // Legend
      this.ctx.font = '11px JetBrains Mono';
      this.ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
      this.ctx.textAlign = 'right';
      this.ctx.fillText('Orange: subject | Blue: camera', w - 20, 25);
    },

    animate() {
      this.draw();
      requestAnimationFrame(() => this.animate());
    }
  };

  // Create buttons
  buttons.forEach(btn => {
    const button = document.createElement('button');
    button.textContent = btn.label;
    button.onclick = () => {
      shotTypeDemo.currentShotType = btn.type;
    };
    controlsDiv.appendChild(button);
  });

  container.appendChild(controlsDiv);

  // Initialize animation
  shotTypeDemo.animate();

  return () => {
    // Cleanup if needed
  };
}
