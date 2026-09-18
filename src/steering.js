// One background planner request at a time; advice is consumed at action boundaries.
export class Steering {
  constructor(planner, intervalMs = 120000) {
    this.planner = planner; this.intervalMs = intervalMs; this.pending = false; this.result = null; this.lastRequestAt = -Infinity;
  }
  request(state, candidates, reason, epoch, signal, now = Date.now()) {
    if (!this.planner || this.pending || this.result || now-this.lastRequestAt < this.intervalMs) return false;
    this.pending = true; this.lastRequestAt = now;
    Promise.resolve().then(() => this.planner.propose(state, candidates, reason, signal)).then(
      proposal => { this.result = { proposal, reason, epoch }; },
      error => { this.result = { error, reason, epoch }; }
    ).finally(() => { this.pending = false; });
    return true;
  }
  take() { const result = this.result; this.result = null; return result; }
}
