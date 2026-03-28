import { describe, it, expect, vi } from 'vitest';
import { NarrationSystem } from '../src/systems/NarrationSystem.js';
import { CONFIG } from '../src/config.js';

describe('NarrationSystem', () => {
  function makeMockAudio() {
    return { playNarration: vi.fn() };
  }

  it('does not update before start()', () => {
    const ns = new NarrationSystem();
    const audio = makeMockAudio();
    ns.init(audio);
    ns.update(100); // large dt but not started
    expect(audio.playNarration).not.toHaveBeenCalled();
  });

  it('fires triggers in order as time progresses', () => {
    const ns = new NarrationSystem();
    const audio = makeMockAudio();
    ns.init(audio);
    ns.start();

    // After intro time + margin, intro (welcome) should fire
    ns.update(CONFIG.narration.intro + 0.1);
    expect(audio.playNarration).toHaveBeenCalledWith('welcome');

    // After polyfishIntro time total, polyfish_intro should fire
    ns.update(CONFIG.narration.polyfishIntro - CONFIG.narration.intro);
    expect(audio.playNarration).toHaveBeenCalledWith('polyfish_intro');
  });

  it('does not re-fire already triggered events', () => {
    const ns = new NarrationSystem();
    const audio = makeMockAudio();
    ns.init(audio);
    ns.start();

    ns.update(CONFIG.narration.intro + 0.5);
    ns.update(1.0);
    ns.update(1.0);

    // 'welcome' should only fire once
    const welcomeCalls = audio.playNarration.mock.calls.filter(c => c[0] === 'welcome');
    expect(welcomeCalls.length).toBe(1);
  });

  it('reset() clears state and allows re-triggering', () => {
    const ns = new NarrationSystem();
    const audio = makeMockAudio();
    ns.init(audio);
    ns.start();
    ns.update(CONFIG.narration.polyfishIntro + 1); // fires intro + polyfish_intro
    expect(audio.playNarration).toHaveBeenCalledTimes(2);

    ns.reset();
    expect(ns.started).toBe(false);
    expect(ns.timer).toBe(0);

    // After reset and re-start, triggers should fire again
    ns.start();
    ns.update(CONFIG.narration.polyfishIntro + 1);
    expect(audio.playNarration).toHaveBeenCalledTimes(4); // 2 more
  });
});
