import { CONFIG } from '../config.js';

/**
 * NarrationSystem — Plays timed narration clips matching the Unity NarrationTimer.cs sequence:
 *
 *   0.15s  → "Intro" (welcome)
 *   3.15s  → "polyfish_intro"
 *  70.15s  → "manatee_intro"
 * 100.65s  → "dolphin_intro"
 *
 * Keys match the NARRATION_CLIPS map in AudioManager.
 */
export class NarrationSystem {
  constructor() {
    this.timer = 0;
    this.triggers = [];
    this.started = false;
    /** @type {import('../audio/AudioManager.js').AudioManager|null} */
    this.audioManager = null;
  }

  init(audioManager) {
    this.audioManager = audioManager;
    this.triggers = [
      { time: CONFIG.narration.intro,         key: 'welcome',         fired: false },
      { time: CONFIG.narration.polyfishIntro,  key: 'polyfish_intro',  fired: false },
      { time: CONFIG.narration.manateeIntro,   key: 'manatee_intro',   fired: false },
      { time: CONFIG.narration.dolphinIntro,   key: 'dolphin_intro',   fired: false },
    ];
    this.started = false;
    this.timer = 0;
  }

  start() {
    this.started = true;
    this.timer = 0;
  }

  update(dt) {
    if (!this.started) return;
    this.timer += dt;
    for (const trigger of this.triggers) {
      if (!trigger.fired && this.timer >= trigger.time) {
        trigger.fired = true;
        if (this.audioManager) {
          this.audioManager.playNarration(trigger.key);
        }
      }
    }
  }

  reset() {
    this.timer = 0;
    this.started = false;
    this.triggers.forEach(t => t.fired = false);
  }
}
