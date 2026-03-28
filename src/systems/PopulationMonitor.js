import { CONFIG } from '../config.js';

export class PopulationMonitor {
  constructor() {
    this.elapsedTime = 0;
    this.checkTimer = 0;
    this.monitoring = false;
    this.restartTriggered = false;
  }

  reset() {
    this.elapsedTime = 0;
    this.checkTimer = 0;
    this.monitoring = false;
    this.restartTriggered = false;
  }

  update(dt, populationCount, callbacks = {}) {
    if (this.restartTriggered) return;

    this.elapsedTime += dt;

    if (!this.monitoring && this.elapsedTime >= CONFIG.restartDelay) {
      this.monitoring = true;
    }

    if (this.monitoring) {
      this.checkTimer += dt;
      if (this.checkTimer >= CONFIG.populationCheckInterval) {
        this.checkTimer = 0;
        if (populationCount <= CONFIG.minPopulation) {
          this.restartTriggered = true;
          if (callbacks.onRestart) callbacks.onRestart();
        }
      }
    }
  }
}
