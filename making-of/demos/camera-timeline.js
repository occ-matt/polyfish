// Camera Timeline - Narrative timeline showing shot sequences
// Visualizes 100-second narrative with phase transitions and shot distribution

export function init(container) {
  // Create canvas
  const canvas = document.createElement('canvas');
  canvas.id = 'demo-timeline';
  canvas.width = 800;
  canvas.height = 400;
  container.appendChild(canvas);

  // Create label
  const label = document.createElement('div');
  label.className = 'demo-label';
  label.textContent = 'Narrative Timeline - 100-second sequence. Each phase has its own shot pool and durations.';
  container.appendChild(label);

  // Create controls
  const controlsDiv = document.createElement('div');
  controlsDiv.className = 'demo-controls';

  const regenerateBtn = document.createElement('button');
  regenerateBtn.textContent = 'Regenerate Sequence';
  controlsDiv.appendChild(regenerateBtn);

  const timeLabel = document.createElement('label');
  timeLabel.textContent = 'Time ';
  const timeValue = document.createElement('span');
  timeValue.id = 'timeline-time';
  timeValue.textContent = '0.0s';
  timeLabel.appendChild(timeValue);
  controlsDiv.appendChild(timeLabel);

  container.appendChild(controlsDiv);

  const ctx = canvas.getContext('2d');

  const timelineDemo = {
    canvas: canvas,
    ctx: ctx,
    sequence: [],
    time: 0,
    playing: true,

    shotTypes: [
      'ESTABLISHING_WIDE', 'HERO_PORTRAIT', 'CHASE_FOLLOW', 'SIDE_TRACK',
      'GROUND_HIDE', 'SNELLS_WINDOW', 'SLOW_REVEAL', 'FLY_THROUGH',
      'REACTION_CUT', 'MACRO_DETAIL'
    ],

    shotColors: {
      'ESTABLISHING_WIDE': '#fab387',
      'HERO_PORTRAIT': '#a6e3a1',
      'CHASE_FOLLOW': '#f38ba8',
      'SIDE_TRACK': '#89b4fa',
      'GROUND_HIDE': '#cba6f7',
      'SNELLS_WINDOW': '#94e2d5',
      'SLOW_REVEAL': '#f9e2af',
      'FLY_THROUGH': '#89dceb',
      'REACTION_CUT': '#eba0ac',
      'MACRO_DETAIL': '#b4befe'
    },

    phases: [
      { name: 'ESTABLISHING', start: 0, end: 15, pools: { 'ESTABLISHING_WIDE': 0.5, 'FLY_THROUGH': 0.3, 'SIDE_TRACK': 0.2 }, durationRange: [3, 5] },
      { name: 'INTRODUCE', start: 15, end: 30, pools: { 'HERO_PORTRAIT': 0.4, 'SLOW_REVEAL': 0.3, 'CHASE_FOLLOW': 0.3 }, durationRange: [2, 4] },
      { name: 'DEVELOP', start: 30, end: 60, pools: { 'HERO_PORTRAIT': 0.3, 'SIDE_TRACK': 0.25, 'REACTION_CUT': 0.2, 'MACRO_DETAIL': 0.15, 'CHASE_FOLLOW': 0.1 }, durationRange: [1.5, 3] },
      { name: 'CLIMAX', start: 60, end: 80, pools: { 'REACTION_CUT': 0.4, 'MACRO_DETAIL': 0.3, 'CHASE_FOLLOW': 0.2, 'HERO_PORTRAIT': 0.1 }, durationRange: [0.5, 2] },
      { name: 'RESOLVE', start: 80, end: 100, pools: { 'HERO_PORTRAIT': 0.4, 'SIDE_TRACK': 0.25, 'ESTABLISHING_WIDE': 0.2, 'SNELLS_WINDOW': 0.15 }, durationRange: [2, 5] }
    ],

    generateSequence() {
      this.sequence = [];
      let currentTime = 0;

      for (const phase of this.phases) {
        while (currentTime < phase.end) {
          // Sample shot type from phase pool
          const rand = Math.random();
          let cumProb = 0;
          let shotType = 'ESTABLISHING_WIDE';
          for (const [shot, prob] of Object.entries(phase.pools)) {
            cumProb += prob;
            if (rand <= cumProb) {
              shotType = shot;
              break;
            }
          }

          // Duration with ±20% variance
          const baseDur = phase.durationRange[0] + Math.random() * (phase.durationRange[1] - phase.durationRange[0]);
          const variance = 0.8 + Math.random() * 0.4;
          const duration = baseDur * variance;

          this.sequence.push({
            shotType,
            startTime: currentTime,
            duration,
            phase: phase.name
          });

          currentTime += duration;
          if (currentTime >= phase.end) break;
        }
      }
    },

    draw() {
      const w = this.canvas.width;
      const h = this.canvas.height;

      // Clear
      this.ctx.fillStyle = 'rgba(10, 22, 40, 1)';
      this.ctx.fillRect(0, 0, w, h);

      const padding = 40;
      const graphW = w - padding * 2;
      const graphH = h - 80;
      const graphX = padding;
      const graphY = 50;

      // Draw timeline axis
      this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
      this.ctx.lineWidth = 1;
      this.ctx.beginPath();
      this.ctx.moveTo(graphX, graphY + graphH);
      this.ctx.lineTo(graphX + graphW, graphY + graphH);
      this.ctx.stroke();

      // Draw time markers
      this.ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
      this.ctx.font = '10px JetBrains Mono';
      this.ctx.textAlign = 'center';
      for (let t = 0; t <= 100; t += 20) {
        const x = graphX + (t / 100) * graphW;
        this.ctx.beginPath();
        this.ctx.moveTo(x, graphY + graphH);
        this.ctx.lineTo(x, graphY + graphH + 5);
        this.ctx.stroke();
        this.ctx.fillText(t + 's', x, graphY + graphH + 18);
      }

      // Draw phase backgrounds
      const phaseH = graphH / this.phases.length;
      for (let i = 0; i < this.phases.length; i++) {
        const phase = this.phases[i];
        const phaseY = graphY + i * phaseH;

        this.ctx.fillStyle = i % 2 === 0 ? 'rgba(255, 255, 255, 0.02)' : 'rgba(255, 255, 255, 0.04)';
        this.ctx.fillRect(graphX, phaseY, graphW, phaseH);

        // Phase label
        this.ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
        this.ctx.font = '11px JetBrains Mono';
        this.ctx.textAlign = 'left';
        this.ctx.fillText(phase.name, graphX + 8, phaseY + phaseH / 2 + 5);
      }

      // Draw shots as colored blocks
      for (const shot of this.sequence) {
        const phaseIndex = this.phases.findIndex(p => p.name === shot.phase);
        const shotY = graphY + phaseIndex * phaseH + 8;
        const shotX = graphX + (shot.startTime / 100) * graphW;
        const shotW = Math.max(2, (shot.duration / 100) * graphW);

        this.ctx.fillStyle = this.shotColors[shot.shotType];
        this.ctx.globalAlpha = 0.7;
        this.ctx.fillRect(shotX, shotY, shotW, phaseH - 16);
        this.ctx.globalAlpha = 1.0;

        // Draw border
        this.ctx.strokeStyle = this.shotColors[shot.shotType];
        this.ctx.lineWidth = 1;
        this.ctx.strokeRect(shotX, shotY, shotW, phaseH - 16);
      }

      // Draw playhead
      const playheadX = graphX + (this.time / 100) * graphW;
      this.ctx.strokeStyle = 'rgba(255, 153, 51, 0.8)';
      this.ctx.lineWidth = 2;
      this.ctx.beginPath();
      this.ctx.moveTo(playheadX, graphY);
      this.ctx.lineTo(playheadX, graphY + graphH);
      this.ctx.stroke();

      // Find current shot for info
      let currentShot = null;
      for (const shot of this.sequence) {
        if (this.time >= shot.startTime && this.time < shot.startTime + shot.duration) {
          currentShot = shot;
          break;
        }
      }

      // Draw info
      if (currentShot) {
        this.ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
        this.ctx.font = '12px JetBrains Mono';
        this.ctx.textAlign = 'left';
        this.ctx.fillText(`Current: ${currentShot.shotType} (${currentShot.duration.toFixed(1)}s)`, 20, h - 20);
      }
    },

    animate() {
      this.time = (this.time + 1/60) % 100;
      document.getElementById('timeline-time').textContent = this.time.toFixed(1) + 's';
      this.draw();
      requestAnimationFrame(() => this.animate());
    }
  };

  // Initialize with first sequence
  timelineDemo.generateSequence();

  // Setup button
  regenerateBtn.onclick = () => {
    timelineDemo.generateSequence();
    timelineDemo.time = 0;
  };

  // Start animation
  timelineDemo.animate();

  return () => {
    // Cleanup if needed
  };
}
