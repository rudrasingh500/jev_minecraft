import { RUN_OBJECTIVE } from './strategy.js';

function inventoryCount(s, name) {
  // Mineflayer inventory.items() does not include armor slots.
  return (s.inventory[name] || 0) + (s.equipped || []).filter(n => n === name).length +
    (['crafting_table','furnace'].includes(name) && (s.observedBlocks || []).includes(name) ? 1 : 0);
}
export function completed(plan, state) {
  return !!plan?.completion?.length && plan.completion.every(c => {
    if (c.kind === 'inventory') return inventoryCount(state,c.key) >= c.target;
    if (c.kind === 'dimension') return state.dimension.replace('minecraft:','') === c.key.replace('minecraft:','');
    if (c.kind === 'nearby_block') return (state.observedBlocks || []).includes(c.key);
    if (c.kind === 'travel_distance') return state.dimension === plan.dimension && Math.hypot(state.position.x-plan.origin.x,state.position.z-plan.origin.z) >= c.target;
    return false;
  });
}
export function validateMicrogoal(proposal, state, registry) {
  if (!proposal || typeof proposal.description !== 'string' || !proposal.description.trim() || proposal.description.length > 500 ||
      typeof proposal.rationale !== 'string' || proposal.rationale.length > 1500 ||
      !Array.isArray(proposal.steps) || !proposal.steps.length || proposal.steps.length > 6 || proposal.steps.some(s => typeof s !== 'string' || s.length > 500) ||
      !Array.isArray(proposal.completion) || !proposal.completion.length || proposal.completion.length > 4) throw new Error('Invalid Luna microgoal');
  if (proposal.completion.some(c => c.kind === 'travel_distance') || proposal.completion.every(c => c.kind === 'inventory' && ['gravel','dirt','cobblestone','cobbled_deepslate','netherrack'].includes(String(c.key).replace(/^minecraft:/, '')))) throw new Error('Microgoal must produce useful readiness or discovery, not travel or arbitrary filler blocks');
  for (const c of proposal.completion) {
    if (!Number.isInteger(c.target) || typeof c.key !== 'string') throw new Error('Invalid microgoal completion predicate');
    c.key = c.key.replace(/^minecraft:/, '');
    const valid = c.kind === 'inventory' ? !!registry.itemsByName[c.key] && c.target >= 1 && c.target <= 128 :
      c.kind === 'nearby_block' ? /^(crafting_table|furnace|nether_portal|end_portal|end_portal_frame|spawner|chest|diamond_ore|deepslate_diamond_ore|obsidian)$/.test(c.key) && !!registry.blocksByName[c.key] && c.target === 0 :
      c.kind === 'dimension' ? ['overworld','the_nether','the_end','minecraft:overworld','minecraft:the_nether','minecraft:the_end'].includes(c.key) && c.target === 0 :
      c.kind === 'travel_distance' ? c.key === '' && c.target >= 1 && c.target <= 64 : false;
    if (!valid) throw new Error('Unsupported microgoal completion predicate');
  }
  if (completed({...proposal,origin:state.position,dimension:state.dimension},state)) throw new Error('Luna proposed an already-completed microgoal');
  return proposal;
}
export function reviewReason(memory, state, now = Date.now()) {
  const p = memory.plan;
  if (!p?.completion || p.selectedBy !== 'gpt-5.6-luna') return 'initial_microgoal';
  const age = now-p.selectedAt;
  if (p.completedAt || completed(p,state)) {
    p.status = 'completed';
    return age >= 120000 ? 'microgoal_completed' : null;
  }
  p.status = 'active';
  // Migrate old movement-only goals on the first eligible review.
  if (age >= 120000 && (p.completion.some(c => c.kind === 'travel_distance') || p.completion.every(c => c.kind === 'inventory' && ['gravel','dirt','cobblestone','cobbled_deepslate','netherrack'].includes(String(c.key).replace(/^minecraft:/, ''))))) return 'replace_trivial_microgoal';
  if (age < 120000) return null;
  if (p.dimension !== state.dimension) return 'dimension_changed';
  const recent = memory.recent?.filter(a => a.started >= p.selectedAt).slice(-12) || [];
  const failures = recent.filter(a => a.result === 'failed');
  if (age >= 300000 && failures.length >= 8 && new Set(failures.map(a=>a.action)).size >= 3) return 'repeated_action_failures';
  if (age >= 300000 && now-(p.lastProgressAt || p.selectedAt) > 300000) return 'stalled';
  if (age > 1200000) return 'microgoal_timeout';
  if (Object.keys(p.startInventory).some(name => /pickaxe|sword/.test(name) && inventoryCount(state,name) < p.startInventory[name])) return 'important_inventory_loss';
  return null;
}
export function adoptMicrogoal(memory, proposal, state, reason) {
  if (memory.plan) {
    memory.planHistory ||= [];
    memory.planHistory.push({...memory.plan,endedAt:Date.now(),outcome:reason});
    memory.planHistory = memory.planHistory.slice(-8);
  }
  memory.plan = { ...proposal, id:'microgoal-'+Date.now(), objective:RUN_OBJECTIVE, selectedBy:'gpt-5.6-luna',
    dimension:state.dimension,origin:{...state.position},startInventory:{...state.inventory},selectedAt:Date.now(),lastProgressAt:Date.now(),actionsTaken:0,failures:0,noProgress:0,status:'proposed',acknowledgement:null };
}
