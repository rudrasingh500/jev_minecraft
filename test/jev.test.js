import test from 'node:test';
import assert from 'node:assert/strict';
import { JevClient } from '../src/jev.js';
const candidates = [{ id: 'wood', description: 'Harvest a log' }, { id: 'wait', description: 'Wait' }];
const result = choice => ({ answers: { action: { type: 'choice', choice, confidence: 0.9 } }, usage: { input_tokens: 12 } });

test('sends the documented choice schema to TypeSafe and returns a legal action', async () => {
  const client = new JevClient({ key: 'test-only', fetchImpl: async (url, opts) => {
    assert.equal(url, 'https://api.typesafe.ai/v1/systemone');
    assert.equal(opts.headers.Authorization, 'Bearer test-only');
    assert.equal(opts.redirect, 'error');
    const body = JSON.parse(opts.body);
    assert.equal(body.model, 'jev-latest');
    assert.deepEqual(body.questions.action.criteria, { wood: 'Harvest a log', wait: 'Wait' });
    assert.equal(body.questions.action.type, 'choice');
    return Response.json(result('wood'));
  } });
  assert.equal((await client.choose({ health: 20 }, candidates)).id, 'wood');
  assert.equal(client.inputTokens, 12);
});
test('rejects invented actions and malformed confidence', async () => {
  for (const data of [result('execute_shell'), { answers: { action: { type: 'choice', choice: 'wood', confidence: 2 } } }]) {
    const client = new JevClient({ key: 'test-only', fetchImpl: async () => Response.json(data) });
    await assert.rejects(client.choose({}, candidates), /invalid or unavailable/);
  }
});
test('authentication failures do not retry or expose upstream error bodies', async () => {
  const client = new JevClient({ key: 'test-only', fetchImpl: async () => new Response('sensitive echoed value', { status: 401 }) });
  await assert.rejects(client.choose({}, candidates), error => error.message.includes('401') && !error.message.includes('sensitive'));
  assert.equal(client.requests, 1);
});
test('retries a transient overload and then succeeds', async () => {
  let calls = 0;
  const client = new JevClient({ key: 'test-only', fetchImpl: async () => ++calls === 1
    ? new Response('', { status: 529, headers: { 'retry-after': '0.001' } }) : Response.json(result('wood')) });
  assert.equal((await client.choose({}, candidates)).id, 'wood');
  assert.equal(calls, 2);
});
test('abort cancels backoff instead of issuing another request', async () => {
  const abort = new AbortController();
  const client = new JevClient({ key: 'test-only', fetchImpl: async () => { abort.abort(); return new Response('', { status: 429 }); } });
  await assert.rejects(client.choose({}, candidates, abort.signal), { name: 'AbortError' });
  assert.equal(client.requests, 1);
});

test('Jev explicitly acknowledges advisory goals without replacing the action choice',async()=>{
 const client=new JevClient({key:'test-only',fetchImpl:async(url,opts)=>{
  assert.ok(JSON.parse(opts.body).questions.goal_status.criteria.pursuing);
  const data=result('wood');data.answers.goal_status={type:'choice',choice:'pursuing',confidence:0.8};
  return Response.json(data);
 }});
 const choice=await client.choose({memory:{plan:{completion:[{kind:'inventory',key:'wood',target:1}]}}},candidates);
 assert.equal(choice.id,'wood');assert.deepEqual(choice.goalStatus,{status:'pursuing',confidence:0.8});
});
