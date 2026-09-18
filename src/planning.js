// Plans are reversible tactics selected by Jev, not inventory-driven objectives.
export function planKey(action) {
  if (action.id.startsWith('mine_')) return `gather:${action.description.match(/^Mine (\w+)/)?.[1] || 'blocks'}`;
  if (action.id.startsWith('explore_')) return 'explore';
  if (/^(fight|shoot)_/.test(action.id)) return `combat:${action.description.match(/(?:Fight |Shoot bow at )(\w+)/)?.[1] || 'nearby'}`;
  if (action.id.startsWith('collect_')) return 'collect';
  return action.id;
}
export function planOptions(candidates) {
  const groups = new Map();
  for (const action of candidates) {
    const key = planKey(action);
    if (!groups.has(key)) groups.set(key, { id: key, description: `Focus on ${action.description}. Reassess after progress or difficulty.` });
  }
  return [...groups.values()];
}
export function needsPlan(memory, state, candidates) {
  const p = memory.plan;
  return !p || p.dimension !== state.dimension || p.actionsTaken >= 5 || p.failures >= 2 || p.noProgress >= 3 ||
    Date.now() - p.selectedAt > 90000 || !candidates.some(a => planKey(a) === p.id);
}
export function selectPlan(memory, option, state, confidence) {
  if (memory.plan) {
    memory.planHistory ||= [];
    memory.planHistory.push({ ...memory.plan, endedAt: Date.now() });
    memory.planHistory = memory.planHistory.slice(-8);
  }
  memory.plan = { ...option, selectedBy: 'Jev', confidence, dimension: state.dimension,
    selectedAt: Date.now(), actionsTaken: 0, failures: 0, noProgress: 0 };
}
export function advancePlan(memory, entry) {
  if (!memory.plan) return;
  memory.plan.actionsTaken++;
  if (entry.result === 'failed') memory.plan.failures++;
  else if (memory.plan.selectedBy === 'gpt-5.6-luna') memory.plan.failures = 0;
  const moved = !memory.plan.completion && Math.hypot(entry.to.x-entry.from.x, entry.to.y-entry.from.y, entry.to.z-entry.from.z) >= 2;
  const changed = Object.keys(entry.inventoryDelta).length > 0 || entry.healthDelta > 0;
  memory.plan.noProgress = moved || changed ? 0 : memory.plan.noProgress+1;
  if (moved || changed) memory.plan.lastProgressAt = Date.now();
}
