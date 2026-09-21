import mineflayer from 'mineflayer';
import pathfinderPackage from 'mineflayer-pathfinder';
import { mkdirSync, appendFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { config } from './config.js';
import { JevClient } from './jev.js';
import { Actions } from './actions.js';
import { observe } from './world.js';
import { loadMemory, saveMemory, recordAction, rememberBlock, memoryContext } from './memory.js';
import { createHash } from 'node:crypto';
import { startViewer } from './viewer.js';
import { runBoundedAction, UnresponsiveActionError, settledObservation } from './execution.js';
import { AdvisorPlanner } from './advisor.js';
import { installDeathRecovery } from './recovery.js';
import { Steering } from './steering.js';
import { goalRecipeGuidance } from './resources.js';
import { reviewReason, validateMicrogoal, adoptMicrogoal, completed } from './microgoals.js';

const { pathfinder, Movements } = pathfinderPackage;
const c = config();
const jev = new JevClient(c);
const planner = c.openaiKey ? new AdvisorPlanner({ key: c.openaiKey }) : null;
const steering = new Steering(planner);
mkdirSync('logs', { recursive: true });
const logPath = `logs/run-${new Date().toISOString().replaceAll(':', '-')}.jsonl`;
const worldKey = `${c.host}:${c.username}:${c.worldId}`;
const memoryPath = `memory/${createHash('sha256').update(worldKey).digest('hex').slice(0,16)}.json`;
const memory = loadMemory(memoryPath, worldKey);
let viewer;
const lifecycle = new AbortController();
let running = false, paused = false, stopped = false, generation = 0;
let active = null;
let decisions = 0;
let skippedLowConfidence = 0;
const bot = mineflayer.createBot({
  host: c.host, port: c.port, username: c.username, auth: c.auth,
  version: c.version, profilesFolder: '.auth', respawn: true, logErrors: false
});
bot.loadPlugin(pathfinder);
const actions = new Actions(bot, memory);
function log(event, data = {}) {
  const entry = { elapsed: +((Date.now() - memory.started) / 1000).toFixed(1), event, ...data };
  // Defense in depth: redact key even if an error unexpectedly includes it.
  let line = JSON.stringify(entry).replaceAll(c.key, '[REDACTED]');
  if (c.openaiKey) line = line.replaceAll(c.openaiKey, '[REDACTED]');
  console.log(line); appendFileSync(logPath, line + '\n');
}
function cancelMovement() {
  bot.pathfinder?.setGoal(null); bot.clearControlStates?.();
  if (bot.vehicle) bot.moveVehicle?.(0,0);
  bot.stopDigging?.(); bot.deactivateItem?.();
  if (bot.currentWindow) bot.closeWindow?.(bot.currentWindow);
}
function stop(reason) {
  if (stopped) return;
  stopped = true;
  lifecycle.abort(); active?.abort(); cancelMovement();
  log('stopped', { reason, decisions, requests: jev.requests, inputTokens: jev.inputTokens, plannerRequests: planner?.requests || 0, plannerInputTokens: planner?.inputTokens || 0, plannerOutputTokens: planner?.outputTokens || 0 });
  saveMemory(memoryPath, memory);
  viewer?.close();
  if (bot.quit) bot.quit(reason); else bot.end(reason);
  process.stdin.pause();
  clearTimeout(runTimer);
}
const runTimer = setTimeout(() => stop('Run time limit reached'), c.minutes * 60000);
bot.on('error', error => { log('connection_error', { message: error.message || error.code || 'Connection failed' }); stop('Connection error; verify Minecraft is open to LAN and MC_PORT matches'); });
bot.on('kicked', reason => { log('kicked', { reason: String(reason) }); stop('Server rejected the connection'); });
bot.on('end', () => stop('Disconnected'));
const recovery = installDeathRecovery(bot,{memory,log,isStopped:()=>stopped,
  invalidate:()=>{generation++;},cancel:()=>{active?.abort(new Error('Bot died'));cancelMovement();}});
bot.on('entityDead', entity => {
  if (entity.name === 'ender_dragon' && String(bot.game.dimension).includes('end')) {
    log('dragon_death_observed', { note: 'Dragon death observed; this does not attribute the kill or certify a speedrun.' });
    stop('Ender Dragon death observed');
  }
});
bot.on('game', () => { generation++; });
bot.on('blockUpdate', (_, block) => rememberBlock(memory, String(bot.game.dimension), block));
bot.on('health', () => {
  if (bot.health > 0 && bot.health <= 6 && active) {
    active.abort(new Error('Low health')); cancelMovement();
  }
});
process.on('SIGINT', () => stop('Ctrl-C'));
process.on('SIGTERM', () => stop('Terminated'));
process.stdin.setEncoding('utf8');
process.stdin.on('data', data => {
  const command = data.trim().toLowerCase();
  if (command === 'stop') stop('Operator stopped run');
  if (command === 'pause') { paused = true; log('paused'); }
  if (command === 'resume') { paused = false; log('resumed'); }
  if (command === 'status') log('status', { decisions, requests: jev.requests, skippedLowConfidence, paused, running });
});

async function execute(action, quantity = 1, parameters) {
  active = new AbortController();
  const signal = AbortSignal.any([active.signal, lifecycle.signal]);
  actions.signal = signal;
  try {
    await runBoundedAction(() => action.run(signal,quantity,parameters), {
      controller: active, cancel: cancelMovement, timeoutMs: c.actionTimeout
    });
  } catch (error) {
    if (error instanceof UnresponsiveActionError) stop(error.message);
    throw error;
  } finally { active = null; actions.signal = null; }
}

async function loop() {
  if (running || stopped) return;
  running = true;
  let apiFailures = 0;
  try {
    while (!stopped && decisions < c.decisions) {
      if (paused || recovery.waiting) { await sleep(300, undefined, { signal: lifecycle.signal }); continue; }
      const scanStarted = Date.now();
      const state = observe(bot, memory);
      const candidates = actions.candidates(state);
      if (!candidates.length) { stop('No available actions'); break; }
      const scanMs = Date.now()-scanStarted;
      const epoch = generation;
      let choice;
      try {
        if (memory.plan && completed(memory.plan,state) && !memory.plan.completedAt) {
          memory.plan.completedAt = Date.now(); memory.plan.status = 'completed';
          log('microgoal_completed', {id:memory.plan.id, description:memory.plan.description, verifiedBy:'observed_state'});
          saveMemory(memoryPath,memory);
        }
        const advice = steering.take();
        if (advice) {
          if (advice.error) log('planner_advice_unavailable',{message:advice.error.message});
          else if (advice.epoch !== generation) log('planner_advice_discarded',{reason:'world or life changed while planning'});
          else {
            try {
              validateMicrogoal(advice.proposal, state, bot.registry);
              adoptMicrogoal(memory, advice.proposal, state, advice.reason);
              saveMemory(memoryPath,memory);
              log('microgoal_selected',{reason:advice.reason,plan:memory.plan,objective:state.objective,plannerRequests:planner.requests});
            } catch(error) { log('planner_advice_discarded',{reason:error.message}); }
          }
        }
        const reason = reviewReason(memory,state);
        if (reason && steering.request(structuredClone(state),[...new Set(candidates.map(a=>a.skill))].map(id=>({id,description:`General ${id} skill; agent selects target from current world or inventory`})),reason,generation,lifecycle.signal)) {
          log('planner_review_started',{reason});
        }
        memory.plannerStatus = steering.status();
        state.steering = memory.plannerStatus;
        state.memory = memoryContext(memory,state);
        // Advice can arrive after candidate generation; refresh ingredients for the new goal.
        state.goalRecipeGuidance = goalRecipeGuidance(bot,state);
        const decisionStarted = Date.now();
        log('decision_started',{scanMs,advisorPending:steering.pending,candidates:candidates.length});
        choice = await jev.chooseAction(state, candidates, lifecycle.signal); apiFailures = 0;
        log('decision_received',{durationMs:Date.now()-decisionStarted,advisorPending:steering.pending});
      }
      catch (error) {
        if (stopped) break;
        log('api_error', { message: error.message });
        if (++apiFailures >= 3 || /HTTP (401|403|422)/.test(error.message)) { stop('Jev API unavailable'); break; }
        await sleep(2000, undefined, { signal: lifecycle.signal }); continue;
      }
      decisions++;
      if (stopped || paused || recovery.waiting || epoch !== generation) continue;
      // Rebuild after inference: entities, blocks, recipes and hunger may change.
      const fresh = observe(bot, memory);
      const legal = actions.candidates(fresh);
      if (memory.plan && choice.goalStatus?.confidence >= c.confidence) {
        const reported = choice.goalStatus.status;
        const verified = reported === 'complete' && completed(memory.plan,fresh);
        const status = reported === 'complete' ? (verified ? 'completed' : 'completion_unverified') : reported;
        if (memory.plan.acknowledgement?.status !== status) {
          memory.plan.acknowledgement = {status,confidence:choice.goalStatus.confidence,at:Date.now(),by:'Jev'};
          log(status === 'pursuing' ? 'microgoal_established' : 'microgoal_assessment', {id:memory.plan.id,status,confidence:choice.goalStatus.confidence});
          saveMemory(memoryPath,memory);
        }
      }
      let action = legal.find(a => a.id === choice.id);
      const emergency = fresh.health <= 6;
      if (emergency) action = legal.find(a => a.skill === 'flee') || legal.find(a => a.skill === 'eat') ||
        legal.find(a=>a.id==='boat_dismount') || legal.find(a=>a.id==='sleep_wake') || action;
      if (!action) { log('stale_decision', { choice: choice.id }); continue; }
      if (!emergency && choice.confidence < c.confidence) {
        skippedLowConfidence++;
        actions.cooldowns.set(choice.id, Date.now() + 10000);
        await sleep(c.interval, undefined, { signal: lifecycle.signal }); continue;
      }
      log('action', { advisorPending:steering.pending, quantity:choice.quantity || 1, parameters:choice.parameters, id: action.id, confidence: choice.confidence, emergency, objective: fresh.objective, position: fresh.position, health: fresh.health });
      const actionStarted = Date.now();
      let actionError;
      memory.activeAction = { id: action.id, description: action.description, confidence: choice.confidence, started: actionStarted };
      try {
        await execute(action,Math.min(choice.quantity || 1,action.maxQuantity || 1),choice.parameters);
      } catch (error) {
        actionError = error;
        actions.cooldowns.set(action.id, Date.now() + 30000);
        log('action_failed', { id: action.id, message: error.message });
        cancelMovement();
      }
      const executionMs = Date.now()-actionStarted;
      let after = fresh;
      if (!stopped && !recovery.waiting && epoch === generation && bot.entity) {
        memory.activeAction.phase = 'settling';
        try {
          after = await settledObservation(() => !recovery.waiting && epoch === generation ? observe(bot,memory) : fresh, {delayMs:c.interval,signal:lifecycle.signal});
        } catch(error) { if (!stopped) throw error; }
      }
      log('action_outcome', {...recordAction(memory, action, fresh, after, actionError, choice.confidence, actionStarted),executionMs,settleMs:Date.now()-actionStarted-executionMs});
      memory.activeAction = null;
      saveMemory(memoryPath, memory);
    }
    if (!stopped) stop('Decision limit reached');
  } finally { running = false; }
}
bot.once('spawn', async () => {
  memory.started = Date.now();
  const movements = new Movements(bot);
  movements.canDig = false;
  movements.allow1by1towers = false;
  movements.allowParkour = false;
  movements.maxDropDown = 2;
  // Preserve portal materials and workstations during navigation.
  for (const name of ['obsidian', 'crafting_table', 'furnace', 'end_portal_frame']) {
    const block = bot.registry.blocksByName[name];
    if (block) movements.blocksCantBreak.add(block.id);
  }
  bot.pathfinder.setMovements(movements);
  bot.pathfinder.thinkTimeout = 5000;
  log('spawn', { version: bot.version, host: c.host, port: c.port, logPath });
  if (c.viewer) {
    try {
      viewer = await startViewer(bot, { port: c.viewerPort, memory, plannerStatus: () => steering.status() });
      if (stopped) viewer.close();
      else console.log(`Watch and record: http://localhost:${c.viewerPort}`);
    } catch (error) { log('viewer_error', { message: error.message }); }
  }
  console.log('Commands: pause (after current action), resume, status, stop. Ctrl-C stops immediately.');
  loop().catch(error => { if (!stopped) { log('fatal', { message: error.message, stack: error.stack }); stop('Controller failure'); } });
});
