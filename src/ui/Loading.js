/**
 * Startup progress. World generation and shader compilation take a couple of
 * seconds; yielding to the browser between stages keeps the bar honest instead
 * of jumping from 0 to 100 after a frozen tab.
 */
export class Loading {
  constructor(root) {
    this.timings = [];
    this._last = performance.now();
    this._pending = null;
    this.el = document.createElement('div');
    this.el.id = 'loading';
    this.el.innerHTML = `
      <div class="brand">Dust Corridor</div>
      <div class="bar"><div class="fill"></div></div>
      <div class="stage">Initialising</div>`;
    root.appendChild(this.el);
    this.fill = this.el.querySelector('.fill');
    this.stageEl = this.el.querySelector('.stage');
  }

  /**
   * Set progress and yield a frame so the browser can actually paint it.
   *
   * Each call also closes out the previous stage's timing. Boot cost is the
   * thing most likely to regress silently — a couple of extra noise octaves in
   * a texture generator does not show up anywhere else — so the breakdown is
   * always collected and left on the game for `__game.bootTimings`.
   */
  async step(fraction, label) {
    const now = performance.now();
    if (this._pending) this.timings.push({ stage: this._pending, ms: Math.round(now - this._last) });
    this._pending = label;
    this._last = now;
    this.fill.style.width = `${Math.round(fraction * 100)}%`;
    this.stageEl.textContent = label;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    this._last = performance.now();
  }

  /**
   * Advance within the current stage without closing its timing. Long stages
   * use this to yield mid-way so the tab keeps painting instead of looking
   * hung, which on a slow GPU is the difference between a progress bar and a
   * browser the user thinks has crashed.
   */
  async tick(fraction, label) {
    this.fill.style.width = `${Math.round(fraction * 100)}%`;
    if (label) this.stageEl.textContent = label;
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }

  done() {
    if (this._pending) {
      this.timings.push({ stage: this._pending, ms: Math.round(performance.now() - this._last) });
      this._pending = null;
    }
    this.el.classList.add('done');
    setTimeout(() => this.el.remove(), 600);
  }
}
