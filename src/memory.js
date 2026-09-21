import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
import { RUN_OBJECTIVE } from './strategy.js';
import { planKey, advancePlan } from './planning.js';

export function loadMemory(path, worldId) {
  let saved = {};
  try {
    const data = JSON.parse(readFileSync(path, 'utf8'));
    if (data.schema === 1 && data.worldId === worldId) {
      saved = data;
      // Migrate old stage objectives without discarding observed outcomes.
      saved.recent = (saved.recent || []).map(entry => ({ ...entry, objective: RUN_OBJECTIVE }));
    }
  } catch (error) { if (error.code !== 'ENOENT') console.warn('Memory could not be loaded; starting fresh.'); }
  return { schema: 1, worldId, recent: [], portals: {}, visits: {}, landmarks: {}, failures: {}, milestones: [], trail: [], lessons: {}, plan: null, planHistory: [], eyeTarget: null, ...saved, started: Date.now(), current: null, activeAction: null };
}
export function saveMemory(path, memory) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path + '.tmp', JSON.stringify(memory, null, 2), { mode: 0o600 });
  renameSync(path + '.tmp', path);
}
export function rememberBlock(memory, dimension, block, at = Date.now()) {
  if (!block?.position) return;
  const p = block.position;
  const key = `${dimension}:${p.x},${p.y},${p.z}`;
  if (/crafting_table|furnace|portal|spawner|chest|diamond_ore|iron_ore|obsidian/.test(block.name)) {
    memory.landmarks[key] = { name: block.name, dimension, position: { x: p.x, y: p.y, z: p.z }, lastSeen: at };
  } else delete memory.landmarks[key];
  const entries = Object.entries(memory.landmarks);
  if (entries.length > 300) for (const [key] of entries.sort((a,b) => a[1].lastSeen - b[1].lastSeen).slice(0, entries.length - 300)) delete memory.landmarks[key];
}
export function updateMemory(memory, state) {
  memory.current = { dimension: state.dimension, position: state.position, health: state.health, food: state.food, inventory: state.inventory, equipped: state.equipped, heldItem: state.heldItem, observedBlocks:state.observedBlocks, entities:state.entities, objective: state.objective, at: Date.now() };
  const last = memory.trail.at(-1);
  if (!last || last.dimension !== state.dimension || Math.hypot(last.x-state.position.x,last.y-state.position.y,last.z-state.position.z) >= 4) {
    memory.trail.push({ ...state.position, dimension: state.dimension, at: Date.now() });
    memory.trail = memory.trail.slice(-200);
  }
  for (const item of ['wooden_pickaxe','stone_pickaxe','iron_pickaxe','diamond_pickaxe','blaze_rod','ender_eye']) {
    if (state.inventory[item] && !memory.milestones.some(m => m.id === item)) memory.milestones.push({ id: item, at: Date.now() });
  }
}
export function recordAction(memory, action, before, after, error, confidence, started) {
  const inventoryDelta = {};
  for (const name of new Set([...Object.keys(before.inventory), ...Object.keys(after.inventory)])) {
    const delta = (after.inventory[name] || 0) - (before.inventory[name] || 0);
    if (delta) inventoryDelta[name] = delta;
  }
  const entry = { action: action.id, interactionState:action.interactionState, description: action.description, dimension: before.dimension, from: before.position, to: after.position,
    started, durationMs: Date.now()-started, confidence, result: error ? 'failed' : 'completed', error: error?.message,
    inventoryDelta, healthDelta: after.health-before.health, objective: before.objective };
  memory.recent.push(entry); memory.recent = memory.recent.slice(-40);
  const key = `${before.dimension}:${action.id}`;
  if (error) {
    const previous = memory.failures[key]?.count || 0;
    memory.failures[key] = { action: action.id, dimension: before.dimension, count: previous+1, reason: error.message, retryAfter: Date.now() + Math.min(300000, 15000 * 2 ** previous) };
  } else delete memory.failures[key];
  // Bound old failures; transient entity IDs must not accumulate forever.
  for (const [key,value] of Object.entries(memory.failures)) if (value.retryAfter < Date.now()-300000) delete memory.failures[key];
  learnFromAction(memory, action, entry);
  advancePlan(memory, entry);
  return entry;
}
function learnFromAction(memory, action, entry) {
  memory.lessons ||= {};
  const tactic = planKey(action);
  const area = `${Math.floor(entry.from.x/16)},${Math.floor(entry.from.z/16)}`;
  const key = `${entry.dimension}:${tactic}:${area}`;
  const lesson = memory.lessons[key] ||= { tactic, dimension: entry.dimension, area, position: entry.from,
    attempts: 0, completions: 0, failures: 0, healthLost: 0, gains: {}, errors: {}, lastSeen: 0 };
  lesson.attempts++;
  lesson[entry.result === 'failed' ? 'failures' : 'completions']++;
  lesson.healthLost += Math.max(0, -entry.healthDelta);
  for (const [name,delta] of Object.entries(entry.inventoryDelta)) if (delta > 0) lesson.gains[name] = (lesson.gains[name] || 0)+delta;
  if (entry.error) {
    const category = /timed out|goal was changed/i.test(entry.error) ? 'navigation_or_action_timeout' :
      /lava|underfoot|unsafe/i.test(entry.error) ? 'unsafe_target' :
      /recipe|missing|tool|table/i.test(entry.error) ? 'missing_prerequisite' : 'other';
    lesson.errors[category] = (lesson.errors[category] || 0)+1;
  }
  lesson.lastSeen = Date.now();
  // Preserve aggregate evidence after the short action-history buffer rolls over.
  const ordered = Object.entries(memory.lessons).sort((a,b) => b[1].lastSeen-a[1].lastSeen);
  for (const [key] of ordered.slice(200)) delete memory.lessons[key];
}
export function memoryContext(memory, state) {
  const distance = p => Math.hypot(p.x-state.position.x,p.z-state.position.z);
  const focus = ['advisor','gpt-5.6-luna'].includes(memory.plan?.selectedBy)
    ? [memory.plan.description, ...(memory.plan.steps || []), ...(memory.plan.completion || []).map(c => c.key)].join(' ').toLowerCase()
    : memory.plan?.id || '';
  const relevantPlace = p => {
    let score = -distance(p.position)/32;
    if (focus.includes('craft') && p.name === 'crafting_table') score += 30;
    if (focus.includes('smelt') && p.name === 'furnace') score += 30;
    if (focus.includes('portal') && p.name.includes('portal')) score += 30;
    if (focus.includes(p.name)) score += 30;
    return score;
  };
  return {
    plan: memory.plan,
    planHistory: (memory.planHistory || []).slice(-3),
    lessons: Object.values(memory.lessons || {}).filter(l => l.dimension === state.dimension)
      .sort((a,b) => (focus.includes(b.tactic.replace('gather:','')) ? 100 : 0) - (focus.includes(a.tactic.replace('gather:','')) ? 100 : 0) + distance(a.position)-distance(b.position)).slice(0,10),
    milestones: memory.milestones,
    knownPlaces: Object.values(memory.landmarks).filter(p => p.dimension === state.dimension)
      .sort((a,b) => relevantPlace(b)-relevantPlace(a)).slice(0,16),
    recentActions: memory.recent.slice(-10), failures: Object.values(memory.failures).filter(f => f.dimension === state.dimension).slice(-10),
    recentPath: memory.trail.slice(-12),
    note: 'Plans are revisable advisory milestones. Lessons and known places summarize observations and may be stale.'
  };
}
