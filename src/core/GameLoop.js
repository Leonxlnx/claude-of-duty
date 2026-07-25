/**
 * Fixed-step simulation (120 Hz) decoupled from rendering, with an
 * interpolation alpha handed to the renderer so visuals stay smooth at any
 * display rate. Accumulator is clamped so a stalled tab cannot produce a
 * catch-up spiral.
 */
export class GameLoop {
  constructor({ fixedHz = 120, maxSubSteps = 6, update, render }) {
    this.fixedDt = 1 / fixedHz;
    this.maxSubSteps = maxSubSteps;
    this.update = update;
    this.render = render;
    this.accumulator = 0;
    this.elapsed = 0;
    this.frame = 0;
    this.running = false;
    this._last = 0;
    this._raf = 0;
    this._tick = this._tick.bind(this);

    this.frameTimes = new Float32Array(240);
    this.frameTimeIndex = 0;
    this.frameTimeCount = 0;
    this.smoothedFrameMs = 16.7;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this._last = performance.now();
    this._raf = requestAnimationFrame(this._tick);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this._raf);
  }

  _tick(now) {
    if (!this.running) return;
    this._raf = requestAnimationFrame(this._tick);

    let dt = (now - this._last) / 1000;
    this._last = now;
    if (!(dt > 0)) dt = 1 / 60;
    // A hidden or suspended tab returns a huge delta; drop it entirely.
    if (dt > 0.5) dt = this.fixedDt;
    dt = Math.min(dt, 0.1);

    this.frameTimes[this.frameTimeIndex] = dt * 1000;
    this.frameTimeIndex = (this.frameTimeIndex + 1) % this.frameTimes.length;
    this.frameTimeCount = Math.min(this.frameTimeCount + 1, this.frameTimes.length);
    this.smoothedFrameMs += (dt * 1000 - this.smoothedFrameMs) * 0.08;

    this.accumulator += dt;
    let steps = 0;
    while (this.accumulator >= this.fixedDt && steps < this.maxSubSteps) {
      this.update(this.fixedDt, this.elapsed);
      this.elapsed += this.fixedDt;
      this.accumulator -= this.fixedDt;
      steps++;
    }
    if (steps === this.maxSubSteps) this.accumulator = Math.min(this.accumulator, this.fixedDt);

    const alpha = this.accumulator / this.fixedDt;
    this.render(dt, alpha, this.elapsed);
    this.frame++;
  }

  stats() {
    const n = this.frameTimeCount;
    if (n < 4) return { avg: 16.7, p95: 16.7, worst: 16.7, fps: 60 };
    const arr = Array.from(this.frameTimes.subarray(0, n)).sort((a, b) => a - b);
    const avg = arr.reduce((a, b) => a + b, 0) / n;
    return {
      avg,
      p95: arr[Math.min(n - 1, Math.floor(n * 0.95))],
      worst: arr[n - 1],
      median: arr[n >> 1],
      fps: 1000 / avg
    };
  }
}
