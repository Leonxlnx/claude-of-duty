/**
 * Startup progress. World generation and shader compilation take a couple of
 * seconds; yielding to the browser between stages keeps the bar honest instead
 * of jumping from 0 to 100 after a frozen tab.
 */
export class Loading {
  constructor(root) {
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

  /** Set progress and yield a frame so the browser can actually paint it. */
  async step(fraction, label) {
    this.fill.style.width = `${Math.round(fraction * 100)}%`;
    this.stageEl.textContent = label;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }

  done() {
    this.el.classList.add('done');
    setTimeout(() => this.el.remove(), 600);
  }
}
