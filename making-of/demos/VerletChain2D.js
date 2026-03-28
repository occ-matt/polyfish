/**
 * VerletChain2D - A 2D verlet integration physics chain for soft-body simulation
 *
 * Uses position-based dynamics to simulate flexible chains constrained by distance.
 * Supports buoyancy, damping, ocean currents, and impulse propagation.
 */
export class VerletChain2D {
  constructor(nodeCount, anchorX, anchorY, segLen) {
    this.n = nodeCount;
    this.segLen = segLen;
    this.x = new Float64Array(nodeCount);
    this.y = new Float64Array(nodeCount);
    this.px = new Float64Array(nodeCount);
    this.py = new Float64Array(nodeCount);
    this.ix = new Float64Array(nodeCount); // impulse
    this.iy = new Float64Array(nodeCount);
    this.restX = new Float64Array(nodeCount);
    this.restY = new Float64Array(nodeCount);
    this.pinned = new Uint8Array(nodeCount);
    this.pinned[0] = 1;

    this.inertia = 0.88;
    this.buoyancy = 0.4;
    this.stiffness = 3;
    this.impulseDecay = 0.88;
    this.impulseSpread = 0.2;

    // Current params
    this.currentAmp = 1.5;
    this.currentSpeed = 0.15;
    this.currentPhaseSpan = 4.0;
    this.currentBias = 0.7;
    this.phaseOffset = 0;

    for (let i = 0; i < nodeCount; i++) {
      this.x[i] = this.px[i] = this.restX[i] = anchorX;
      this.y[i] = this.py[i] = this.restY[i] = anchorY - i * segLen;
    }
  }

  update(dt, time, enableCurrent) {
    const dtScale = dt * 60;

    // Impulse propagation
    const tmpX = new Float64Array(this.n);
    const tmpY = new Float64Array(this.n);
    for (let i = 1; i < this.n; i++) { tmpX[i] = this.ix[i]; tmpY[i] = this.iy[i]; }
    const decay = Math.pow(this.impulseDecay, dtScale);
    const spread = this.impulseSpread * Math.min(dtScale, 2);
    for (let i = 1; i < this.n; i++) {
      let ax = tmpX[i], ay = tmpY[i], c = 1;
      if (i > 1) { ax += tmpX[i-1]; ay += tmpY[i-1]; c++; }
      if (i < this.n-1) { ax += tmpX[i+1]; ay += tmpY[i+1]; c++; }
      ax /= c; ay /= c;
      this.ix[i] = (tmpX[i] + (ax - tmpX[i]) * spread) * decay;
      this.iy[i] = (tmpY[i] + (ay - tmpY[i]) * spread) * decay;
      if (Math.abs(this.ix[i]) < 0.0001) this.ix[i] = 0;
      if (Math.abs(this.iy[i]) < 0.0001) this.iy[i] = 0;
    }

    // Inertia + buoyancy
    for (let i = 1; i < this.n; i++) {
      if (this.pinned[i]) continue;
      const hf = i / (this.n - 1);
      const iner = Math.pow(this.inertia, dtScale);
      const vx = (this.x[i] - this.px[i]) * iner;
      const vy = (this.y[i] - this.py[i]) * iner;
      this.px[i] = this.x[i];
      this.py[i] = this.y[i];
      this.x[i] += vx;
      this.y[i] += vy;
      // Buoyancy (upward = negative Y in canvas coords)
      this.y[i] -= this.buoyancy * hf * dt;
    }

    // Ocean current + restoring spring
    if (enableCurrent) {
      for (let i = 1; i < this.n; i++) {
        if (this.pinned[i]) continue;
        const hf = i / (this.n - 1);
        const amp = hf * hf * this.currentAmp;
        const phase = time * this.currentSpeed + hf * this.currentPhaseSpan + this.phaseOffset;
        const wave = Math.sin(phase) + 0.3 * Math.sin(phase * 0.37 + 1.7);
        const crossWave = Math.sin(phase * 0.7 + 0.5) * 0.4;
        const forceX = (wave * this.currentBias + crossWave * (1 - this.currentBias)) * amp * this.currentSpeed;

        const springX = 0.008 * (1 - hf * 0.9);
        const springY = 0.06 * (1 - hf * 0.5);
        const restoreX = (this.restX[i] - this.x[i]) * springX;
        const restoreY = (this.restY[i] - this.y[i]) * springY;

        const str = 0.9 * dt;
        this.x[i] += forceX * str + restoreX * dt + this.ix[i] * str;
        this.y[i] += restoreY * dt + this.iy[i] * str;
      }
    } else {
      // Just impulse application without current
      for (let i = 1; i < this.n; i++) {
        if (this.pinned[i]) continue;
        const str = 0.9 * dt;
        this.x[i] += this.ix[i] * str;
        this.y[i] += this.iy[i] * str;
      }
    }

    // Pin base nodes
    const pinCount = Math.min(3, this.n - 1);
    for (let i = 1; i <= pinCount; i++) {
      if (this.pinned[i]) continue;
      const t = (i - 1) / Math.max(pinCount - 1, 1);
      const pin = 0.5 * (1 - t);
      if (pin < 0.001) continue;
      this.x[i] += (this.restX[i] - this.x[i]) * pin;
      this.y[i] += (this.restY[i] - this.y[i]) * pin;
    }

    // Constraints
    for (let iter = 0; iter < this.stiffness; iter++) {
      for (let i = 0; i < this.n - 1; i++) {
        const dx = this.x[i+1] - this.x[i];
        const dy = this.y[i+1] - this.y[i];
        const dist = Math.sqrt(dx*dx + dy*dy);
        if (dist < 0.0001) continue;
        const error = (dist - this.segLen) / dist;
        const wA = this.pinned[i] ? 0 : 1;
        const wB = this.pinned[i+1] ? 0 : 1;
        const total = wA + wB;
        if (total === 0) continue;
        if (wA > 0) {
          this.x[i] += dx * error * (wA / total);
          this.y[i] += dy * error * (wA / total);
        }
        if (wB > 0) {
          this.x[i+1] -= dx * error * (wB / total);
          this.y[i+1] -= dy * error * (wB / total);
        }
      }
    }
  }

  applyImpulse(nodeIdx, fx, fy) {
    if (nodeIdx > 0 && nodeIdx < this.n) {
      this.ix[nodeIdx] += fx;
      this.iy[nodeIdx] += fy;
    }
  }

  applyImpulseNear(worldX, worldY, fx, fy, radius) {
    for (let i = 1; i < this.n; i++) {
      const dx = this.x[i] - worldX;
      const dy = this.y[i] - worldY;
      const dist = Math.sqrt(dx*dx + dy*dy);
      if (dist < radius) {
        const factor = 1 - dist / radius;
        this.ix[i] += fx * factor;
        this.iy[i] += fy * factor;
      }
    }
  }
}
