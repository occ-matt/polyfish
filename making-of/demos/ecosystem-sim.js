// Predator-Prey Dynamics Simulator
// Standalone module that creates all needed DOM elements and runs the ecosystem simulation

class EcosystemSimulator {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.setupCanvas();

    this.fish = [];
    this.food = [];
    this.dolphins = [];

    this.time = 0;
    this.speed = 1.0;
    this.history = { fish: [], dolphins: [], food: [] };
    this.maxHistory = 120;

    this.init();
    this.animate();
    this.setupControls();
  }

  setupCanvas() {
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = rect.width * window.devicePixelRatio;
    this.canvas.height = rect.height * window.devicePixelRatio;
    this.ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    this.width = rect.width;
    this.height = rect.height * 0.65;
    this.chartHeight = rect.height * 0.35;
  }

  init() {
    this.fish = [];
    this.food = [];
    this.dolphins = [];
    this.time = 0;
    this.history = { fish: [], dolphins: [], food: [] };

    // Spawn initial food
    for (let i = 0; i < 40; i++) {
      this.food.push({
        x: Math.random() * this.width,
        y: Math.random() * this.height,
        age: 0
      });
    }

    // Spawn initial fish
    for (let i = 0; i < 25; i++) {
      this.fish.push({
        x: Math.random() * this.width,
        y: Math.random() * this.height,
        vx: (Math.random() - 0.5) * 2,
        vy: (Math.random() - 0.5) * 2,
        energy: 60,
        foodCounter: 0,
        fleeTimer: 0
      });
    }

    // Spawn initial dolphins
    for (let i = 0; i < 2; i++) {
      this.dolphins.push({
        x: Math.random() * this.width,
        y: Math.random() * this.height,
        vx: (Math.random() - 0.5) * 1.5,
        vy: (Math.random() - 0.5) * 1.5,
        energy: 120,
        foodCounter: 0,
        targetFish: null
      });
    }
  }

  animate() {
    this.update();
    this.draw();
    requestAnimationFrame(() => this.animate());
  }

  update() {
    const dt = 0.016 * this.speed;
    this.time += dt;

    // Update fish - seek food, flee from dolphins
    for (let i = this.fish.length - 1; i >= 0; i--) {
      const f = this.fish[i];

      // Decrease flee timer
      f.fleeTimer = Math.max(0, f.fleeTimer - dt);

      // Check for nearby dolphins and flee if needed
      let nearestDolphin = null;
      let minDist = 60;
      for (let d of this.dolphins) {
        const dist = Math.hypot(f.x - d.x, f.y - d.y);
        if (dist < minDist) {
          minDist = dist;
          nearestDolphin = d;
        }
      }

      // Determine desired velocity
      let desiredVx = 0, desiredVy = 0;

      if (nearestDolphin && minDist < 50) {
        // FLEE from dolphin
        f.fleeTimer = 3;
        const fleeAngle = Math.atan2(f.y - nearestDolphin.y, f.x - nearestDolphin.x);
        desiredVx = Math.cos(fleeAngle) * 2.5;
        desiredVy = Math.sin(fleeAngle) * 2.5;
      } else {
        // SEEK nearest food
        let nearestFood = null;
        let minFoodDist = Infinity;
        for (let food of this.food) {
          const dist = Math.hypot(f.x - food.x, f.y - food.y);
          if (dist < minFoodDist) {
            minFoodDist = dist;
            nearestFood = food;
          }
        }

        if (nearestFood) {
          const seekAngle = Math.atan2(nearestFood.y - f.y, nearestFood.x - f.x);
          desiredVx = Math.cos(seekAngle) * 1.5;
          desiredVy = Math.sin(seekAngle) * 1.5;
        } else {
          // Random wandering if no food found
          if (Math.random() < 0.02) {
            desiredVx = (Math.random() - 0.5) * 1.5;
            desiredVy = (Math.random() - 0.5) * 1.5;
          } else {
            desiredVx = f.vx;
            desiredVy = f.vy;
          }
        }
      }

      // Smooth steering
      f.vx += (desiredVx - f.vx) * 0.1;
      f.vy += (desiredVy - f.vy) * 0.1;

      // Move fish
      f.x += f.vx * dt * 60;
      f.y += f.vy * dt * 60;

      // Boundary bouncing
      const radius = 2.5;
      if (f.x < radius) { f.x = radius; f.vx = Math.abs(f.vx); }
      if (f.x > this.width - radius) { f.x = this.width - radius; f.vx = -Math.abs(f.vx); }
      if (f.y < radius) { f.y = radius; f.vy = Math.abs(f.vy); }
      if (f.y > this.height - radius) { f.y = this.height - radius; f.vy = -Math.abs(f.vy); }

      // Energy drain
      f.energy -= 0.008 * dt;

      // Eat food
      for (let j = this.food.length - 1; j >= 0; j--) {
        const dist = Math.hypot(f.x - this.food[j].x, f.y - this.food[j].y);
        if (dist < 4) {
          this.food.splice(j, 1);
          f.foodCounter++;
          break;
        }
      }

      // Reproduce
      if (f.foodCounter >= 4) {
        for (let k = 0; k < 2; k++) {
          this.fish.push({
            x: f.x + (Math.random() - 0.5) * 8,
            y: f.y + (Math.random() - 0.5) * 8,
            vx: (Math.random() - 0.5) * 1.5,
            vy: (Math.random() - 0.5) * 1.5,
            energy: 50,
            foodCounter: 0,
            fleeTimer: 0
          });
        }
        f.foodCounter = 0;
      }

      // Die and seed food
      if (f.energy <= 0) {
        for (let k = 0; k < 3; k++) {
          this.food.push({
            x: f.x + (Math.random() - 0.5) * 10,
            y: f.y + (Math.random() - 0.5) * 10,
            age: 0
          });
        }
        this.fish.splice(i, 1);
      }
    }

    // Update dolphins - hunt fish
    for (let i = this.dolphins.length - 1; i >= 0; i--) {
      const d = this.dolphins[i];

      // Find nearest fish
      let nearestFish = null;
      let minDist = Infinity;
      for (let f of this.fish) {
        const dist = Math.hypot(d.x - f.x, d.y - f.y);
        if (dist < minDist) {
          minDist = dist;
          nearestFish = f;
        }
      }

      // Hunt or wander
      if (nearestFish && minDist < 80) {
        const huntAngle = Math.atan2(nearestFish.y - d.y, nearestFish.x - d.x);
        d.vx = Math.cos(huntAngle) * 1.8;
        d.vy = Math.sin(huntAngle) * 1.8;
      } else {
        // Wander
        if (Math.random() < 0.01) {
          d.vx = (Math.random() - 0.5) * 1.5;
          d.vy = (Math.random() - 0.5) * 1.5;
        }
      }

      // Move dolphin
      d.x += d.vx * dt * 60;
      d.y += d.vy * dt * 60;

      // Boundary bouncing
      const radius = 5.5;
      if (d.x < radius) { d.x = radius; d.vx = Math.abs(d.vx); }
      if (d.x > this.width - radius) { d.x = this.width - radius; d.vx = -Math.abs(d.vx); }
      if (d.y < radius) { d.y = radius; d.vy = Math.abs(d.vy); }
      if (d.y > this.height - radius) { d.y = this.height - radius; d.vy = -Math.abs(d.vy); }

      // Energy drain
      d.energy -= 0.004 * dt;

      // Hunt fish
      for (let j = this.fish.length - 1; j >= 0; j--) {
        const dist = Math.hypot(d.x - this.fish[j].x, d.y - this.fish[j].y);
        if (dist < 8) {
          for (let k = 0; k < 2; k++) {
            this.food.push({
              x: d.x + (Math.random() - 0.5) * 10,
              y: d.y + (Math.random() - 0.5) * 10,
              age: 0
            });
          }
          this.fish.splice(j, 1);
          d.foodCounter++;
          break;
        }
      }

      // Reproduce
      if (d.foodCounter >= 5) {
        this.dolphins.push({
          x: d.x + (Math.random() - 0.5) * 15,
          y: d.y + (Math.random() - 0.5) * 15,
          vx: (Math.random() - 0.5) * 1.2,
          vy: (Math.random() - 0.5) * 1.2,
          energy: 100,
          foodCounter: 0,
          targetFish: null
        });
        d.foodCounter = 0;
      }

      // Die and seed food
      if (d.energy <= 0) {
        for (let k = 0; k < 5; k++) {
          this.food.push({
            x: d.x + (Math.random() - 0.5) * 15,
            y: d.y + (Math.random() - 0.5) * 15,
            age: 0
          });
        }
        this.dolphins.splice(i, 1);
      }
    }

    // Update food particles - age and despawn
    for (let i = this.food.length - 1; i >= 0; i--) {
      this.food[i].age += dt;
      if (this.food[i].age > 20) {
        this.food.splice(i, 1);
      }
    }

    // Spawn new food occasionally from ocean floor
    if (Math.random() < 0.08) {
      this.food.push({
        x: Math.random() * this.width,
        y: Math.random() * this.height,
        age: 0
      });
    }

    // Record history
    if (this.time % 1 < dt) {
      this.history.fish.push(this.fish.length);
      this.history.dolphins.push(this.dolphins.length);
      this.history.food.push(this.food.length);

      if (this.history.fish.length > this.maxHistory) {
        this.history.fish.shift();
        this.history.dolphins.shift();
        this.history.food.shift();
      }
    }
  }

  draw() {
    this.ctx.fillStyle = '#0a1628';
    this.ctx.fillRect(0, 0, this.width, this.height + this.chartHeight);

    // Draw food particles (small green circles)
    this.ctx.fillStyle = '#44bb66';
    for (let food of this.food) {
      this.ctx.beginPath();
      this.ctx.arc(food.x, food.y, 2, 0, Math.PI * 2);
      this.ctx.fill();
    }

    // Draw fish (small amber dots)
    this.ctx.fillStyle = '#ffbb44';
    for (let f of this.fish) {
      this.ctx.beginPath();
      this.ctx.arc(f.x, f.y, 2.5, 0, Math.PI * 2);
      this.ctx.fill();
    }

    // Draw dolphins (larger blue dots)
    this.ctx.fillStyle = '#5588ff';
    for (let d of this.dolphins) {
      this.ctx.beginPath();
      this.ctx.arc(d.x, d.y, 5.5, 0, Math.PI * 2);
      this.ctx.fill();
    }

    // Draw population chart
    this.drawChart();
  }

  drawChart() {
    const chartX = 0;
    const chartY = this.height;
    const chartW = this.width;
    const chartH = this.chartHeight;
    const pad = { left: 35, right: 10, top: 30, bottom: 18 };

    // Background
    this.ctx.fillStyle = 'rgba(0,0,0,0.4)';
    this.ctx.fillRect(chartX, chartY, chartW, chartH);

    // Divider line
    this.ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    this.ctx.lineWidth = 1;
    this.ctx.beginPath();
    this.ctx.moveTo(chartX, chartY);
    this.ctx.lineTo(chartX + chartW, chartY);
    this.ctx.stroke();

    const plotX = chartX + pad.left;
    const plotY = chartY + pad.top;
    const plotW = chartW - pad.left - pad.right;
    const plotH = chartH - pad.top - pad.bottom;

    // Horizontal gridlines
    this.ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    this.ctx.lineWidth = 0.5;
    for (let i = 0; i <= 4; i++) {
      const y = plotY + plotH * (1 - i / 4);
      this.ctx.beginPath();
      this.ctx.moveTo(plotX, y);
      this.ctx.lineTo(plotX + plotW, y);
      this.ctx.stroke();
    }

    // Y-axis labels
    this.ctx.fillStyle = 'rgba(255,255,255,0.25)';
    this.ctx.font = '9px monospace';
    this.ctx.textAlign = 'right';
    const maxVal = 60;
    for (let i = 0; i <= 4; i++) {
      const val = Math.round(maxVal * i / 4);
      const y = plotY + plotH * (1 - i / 4);
      this.ctx.fillText(val, plotX - 5, y + 3);
    }

    // X-axis label
    this.ctx.textAlign = 'center';
    this.ctx.fillText('time (s)', plotX + plotW / 2, chartY + chartH - 3);

    // Data series
    const series = [
      { data: this.history.fish, color: '#ffbb44', scale: 60, label: 'Fish' },
      { data: this.history.dolphins, color: '#5588ff', scale: 15, label: 'Dolphins' },
      { data: this.history.food, color: '#44bb66', scale: 100, label: 'Food' }
    ];

    for (const s of series) {
      if (s.data.length < 2) continue;
      this.ctx.strokeStyle = s.color;
      this.ctx.lineWidth = 1.5;
      this.ctx.beginPath();
      for (let i = 0; i < s.data.length; i++) {
        const x = plotX + (i / this.maxHistory) * plotW;
        const y = plotY + plotH - (s.data[i] / maxVal) * plotH;
        if (i === 0) this.ctx.moveTo(x, y);
        else this.ctx.lineTo(x, y);
      }
      this.ctx.stroke();
    }

    // Legend (top-right of chart)
    const legendX = plotX + plotW - 120;
    const legendY = chartY + 8;
    this.ctx.font = '10px "JetBrains Mono", monospace';
    this.ctx.textAlign = 'left';
    for (let i = 0; i < series.length; i++) {
      const s = series[i];
      const y = legendY + i * 16;
      // Color swatch
      this.ctx.fillStyle = s.color;
      this.ctx.fillRect(legendX, y, 8, 8);
      // Label with current count
      this.ctx.fillStyle = 'rgba(255,255,255,0.7)';
      const count = s.data.length > 0 ? s.data[s.data.length - 1] : 0;
      this.ctx.fillText(s.label + ': ' + count, legendX + 14, y + 8);
    }
  }

  setupControls() {
    const speedInput = this.canvas.parentElement.querySelector('#ctrl-sim-speed');
    const speedValue = this.canvas.parentElement.querySelector('#val-sim-speed');
    const resetButton = this.canvas.parentElement.querySelector('#btn-reset-ecosystem');

    if (speedInput) {
      speedInput.addEventListener('input', (e) => {
        this.speed = parseFloat(e.target.value);
        if (speedValue) {
          speedValue.textContent = this.speed.toFixed(1) + '×';
        }
      });
    }

    if (resetButton) {
      resetButton.addEventListener('click', () => {
        this.init();
      });
    }
  }
}

// Export init function for module use
export function init(container) {
  // Create canvas element
  const canvas = document.createElement('canvas');
  canvas.id = 'demo-ecosystem';
  container.appendChild(canvas);

  // Create label
  const label = document.createElement('div');
  label.className = 'demo-label';
  label.textContent = 'Predator-Prey Dynamics - fish forage and flee, dolphins hunt';
  container.appendChild(label);

  // Create controls container
  const controls = document.createElement('div');
  controls.className = 'demo-controls';
  controls.innerHTML = `
    <label>Speed <input type="range" id="ctrl-sim-speed" min="0.5" max="3" value="1" step="0.1"><span id="val-sim-speed">1.0×</span></label>
    <button id="btn-reset-ecosystem">Reset Simulation</button>
  `;
  container.appendChild(controls);

  // Initialize simulator
  new EcosystemSimulator(canvas);
}
