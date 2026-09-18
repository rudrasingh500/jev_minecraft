export class UnresponsiveActionError extends Error {}

// Never start the next action until the previous action's promise has settled.
export async function runBoundedAction(run, { controller, cancel, timeoutMs, graceMs = 3000 }) {
  let timer, graceTimer;
  const pending = Promise.resolve().then(() => run(controller.signal)).then(
    value => ({ value }), error => ({ error })
  );
  try {
    const first = await Promise.race([
      pending,
      new Promise(resolve => { timer = setTimeout(() => resolve({ timedOut: true }), timeoutMs); })
    ]);
    if (!first.timedOut) {
      if (first.error) throw first.error;
      return first.value;
    }
    const reason = new Error('Action timed out; cancelled safely and will choose another action');
    controller.abort(reason);
    cancel();
    const settled = await Promise.race([
      pending.then(() => true),
      new Promise(resolve => { graceTimer = setTimeout(() => resolve(false), graceMs); })
    ]);
    if (!settled) throw new UnresponsiveActionError('Action did not settle after cancellation; disconnecting to prevent overlapping actions');
    throw reason;
  } finally { clearTimeout(timer); clearTimeout(graceTimer); }
}

// Mineflayer operation completion can precede inventory/pickup updates.
// Reuse the decision interval before sampling outcomes; this is a settling
// window, not proof that the server has acknowledged every effect.
export async function settledObservation(observe, { delayMs, signal }) {
  const { setTimeout: sleep } = await import('node:timers/promises');
  await sleep(delayMs, undefined, { signal });
  signal?.throwIfAborted();
  return observe();
}
