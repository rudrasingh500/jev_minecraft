import test from 'node:test';
import assert from 'node:assert/strict';
import { runBoundedAction, UnresponsiveActionError } from '../src/execution.js';

test('mining deadline cancels and waits for dig settlement without requiring disconnect', async () => {
  const controller = new AbortController();
  let rejectDig, settled = false, cancelled = false;
  await assert.rejects(runBoundedAction(async () => {
    try { await new Promise((_, reject) => { rejectDig = reject; }); }
    finally { settled = true; }
  }, {
    controller, timeoutMs: 5, graceMs: 100,
    cancel: () => { cancelled = true; setTimeout(() => rejectDig(new Error('diggingAborted')), 10); }
  }), error => !(error instanceof UnresponsiveActionError) && /cancelled safely/.test(error.message));
  assert.ok(controller.signal.aborted && cancelled && settled);
});

test('an action ignoring cancellation still requires disconnect', async () => {
  await assert.rejects(runBoundedAction(() => new Promise(() => {}), {
    controller: new AbortController(), cancel: () => {}, timeoutMs: 5, graceMs: 5
  }), UnresponsiveActionError);
});

test('successful actions and ordinary failures pass through without cancellation', async () => {
  const opts = { controller: new AbortController(), cancel: () => assert.fail('Unexpected cancellation'), timeoutMs: 100 };
  assert.equal(await runBoundedAction(async () => 42, opts), 42);
  await assert.rejects(runBoundedAction(async () => { throw new Error('No path'); }, opts), /No path/);
});

test('outcome observation includes updates arriving after operation completion',async()=>{
 const {settledObservation}=await import('../src/execution.js');
 let inventory=0;let samples=0;
 const pending=settledObservation(()=>{samples++;return inventory;},{delayMs:25});
 setTimeout(()=>{inventory=1;},5);
 assert.equal(samples,0);
 assert.equal(await pending,1);assert.equal(samples,1);
});
test('shutdown cancels settlement without a stale observation',async()=>{
 const {settledObservation}=await import('../src/execution.js');
 const controller=new AbortController();
 const pending=settledObservation(()=>assert.fail('must not observe after shutdown'),{delayMs:1000,signal:controller.signal});
 controller.abort();
 await assert.rejects(pending,{name:'AbortError'});
});
