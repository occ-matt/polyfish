import { describe, it, expect, vi } from 'vitest';
import { PopulationMonitor } from '../src/systems/PopulationMonitor.js';
import { CONFIG } from '../src/config.js';

describe('PopulationMonitor', () => {
  it('starts in non-monitoring state', () => {
    const pm = new PopulationMonitor();
    expect(pm.monitoring).toBe(false);
    expect(pm.restartTriggered).toBe(false);
  });

  it('does not monitor before restartDelay', () => {
    const pm = new PopulationMonitor();
    const onRestart = vi.fn();

    // Simulate time well before restartDelay
    const earlyTime = CONFIG.restartDelay * 0.5;
    pm.update(earlyTime, 2, { onRestart }); // low pop but too early
    expect(pm.monitoring).toBe(false);
    expect(onRestart).not.toHaveBeenCalled();
  });

  it('starts monitoring after restartDelay', () => {
    const pm = new PopulationMonitor();
    pm.update(CONFIG.restartDelay + 1, 100, {});
    expect(pm.monitoring).toBe(true);
  });

  it('triggers restart when population drops below min', () => {
    const pm = new PopulationMonitor();
    const onRestart = vi.fn();

    // Fast-forward past restart delay
    pm.update(CONFIG.restartDelay + 1, 100, { onRestart });
    expect(pm.monitoring).toBe(true);

    // Now update with low population (at check interval)
    pm.update(CONFIG.populationCheckInterval + 0.1, CONFIG.minPopulation, { onRestart });
    expect(onRestart).toHaveBeenCalled();
    expect(pm.restartTriggered).toBe(true);
  });

  it('does not trigger restart when population is healthy', () => {
    const pm = new PopulationMonitor();
    const onRestart = vi.fn();

    pm.update(CONFIG.restartDelay + 1, 100, { onRestart });
    pm.update(CONFIG.populationCheckInterval + 0.1, CONFIG.minPopulation + 10, { onRestart });
    expect(onRestart).not.toHaveBeenCalled();
  });

  it('does not trigger again after restart already triggered', () => {
    const pm = new PopulationMonitor();
    const onRestart = vi.fn();

    pm.update(CONFIG.restartDelay + 1, 100, { onRestart });
    pm.update(CONFIG.populationCheckInterval + 0.1, 0, { onRestart });
    expect(onRestart).toHaveBeenCalledTimes(1);

    // Further updates should be no-ops
    pm.update(CONFIG.populationCheckInterval + 0.1, 0, { onRestart });
    expect(onRestart).toHaveBeenCalledTimes(1);
  });

  it('reset() clears all state', () => {
    const pm = new PopulationMonitor();
    pm.update(CONFIG.restartDelay + 1, 100, {});
    pm.restartTriggered = true;

    pm.reset();
    expect(pm.monitoring).toBe(false);
    expect(pm.restartTriggered).toBe(false);
    expect(pm.elapsedTime).toBe(0);
  });
});
