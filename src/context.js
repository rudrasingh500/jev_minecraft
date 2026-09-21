// A conservative local payload bound. No budget instructions are sent to Jev.
export function compactRequest(request, maxBytes = 24000) {
  const result = structuredClone(request);
  const state = result.state;
  if (state && typeof state === 'object' && !Array.isArray(state)) {
    delete state.recentActions;
    if (state.memory?.recentActions) state.memory.recentActions = state.memory.recentActions.map(
      ({ action, result, error, inventoryDelta, healthDelta, from, to, durationMs }) =>
        ({ action, result, error, inventoryDelta, healthDelta, from, to, durationMs })
    );
  }
  const size = () => Buffer.byteLength(JSON.stringify(result));
  for (const field of ['recentPath','planHistory','recentActions','knownPlaces','lessons','failures','milestones']) {
    const list = state?.memory?.[field];
    if (!Array.isArray(list)) continue;
    while (list.length > 1 && size() > maxBytes) {
      if (['recentPath','recentActions','planHistory'].includes(field)) list.shift();
      else list.pop();
    }
  }
  for (const field of ['knownPlaces','failures','recentActions']) {
    const list = state?.tacticalMemory?.[field];
    while (Array.isArray(list) && list.length > 1 && size() > maxBytes) {
      if (field === 'knownPlaces') list.pop(); else list.shift();
    }
  }
  if (size() > maxBytes) throw new Error('Context too large after local compaction; essential observations and action options were preserved');
  return result;
}

// Jev executes the current tactic; the advisor alone receives the strategic memory packet.
export function executionContext(state, candidates) {
  const { memory = {}, recentActions: unused, ...live } = state;
  const plan = memory.plan;
  const finished = !!plan?.completedAt || plan?.status === 'completed';
  const microgoal = plan?.completion ? {
    id:plan.id, description:plan.description, status:finished ? 'completed' : 'active',
    steps:finished ? [] : plan.steps, completion:plan.completion,
    assessment:plan.acknowledgement?.status || 'not_yet_assessed'
  } : null;
  const ids = new Set(candidates.map(c=>c.id));
  const needed = new Set((live.goalRecipeGuidance || []).flatMap(g => [g.target,...(g.recipe?.missing || []).map(d=>d.name)]));
  const readyForTable = (live.goalRecipeGuidance || []).some(g=>g.recipe?.requiresTable && !g.recipe.missing.length);
  if (readyForTable) needed.add('crafting_table');
  const recent = (memory.recentActions || []).slice(-4).map(({action,result,error,inventoryDelta,healthDelta,from,to}) =>
    ({action,result,error,inventoryDelta,healthDelta,from,to}));
  return {...live, executionPolicy:{
      mode:!microgoal || finished || microgoal.assessment==='blocked' ? 'self_directed' : 'microgoal_guided',
      plannerPending:!!state.steering?.pending,
      continuity:'Keep taking useful actions toward Beat the Ender Dragon while advice is pending. Continue useful current work; new advice may refine the next action, not restart preparation. Never wait for the advisor.'
    }, goalRecipeGuidance:finished ? [] : live.goalRecipeGuidance, microgoal,
    tacticalMemory:{
      recentActions:recent,
      failures:(memory.failures || []).filter(f=>ids.has(f.action)).slice(-3),
      knownPlaces:(memory.knownPlaces || []).filter(p=>needed.has(p.name) || candidates.some(c=>c.id.startsWith(`revisit_${p.name}_`) || (p.name.includes('portal') && /portal|enter_end|fill_frame/.test(c.id)))).slice(0,4)
    }
  };
}
