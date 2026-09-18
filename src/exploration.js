const distance = (a,b) => Math.hypot(a.x-b.x,a.z-b.z);

export function explorationOptions(memory, state) {
  const origin = state.position;
  const recent = (memory.recent || []).filter(a=>a.dimension===state.dimension).slice(-16);
  // Actual arrival points, not chunk keys for destinations the pathfinder never reached.
  const points = recent.flatMap(a=>[a.from,a.to]).filter(p=>p && distance(p,origin)>4);
  const options = [['north',0,-12],['east',12,0],['south',0,12],['west',-12,0]].map(([label,dx,dz])=>{
    const target={x:Math.floor(origin.x)+dx,z:Math.floor(origin.z)+dz};
    const revisits=points.filter(p=>distance(target,p)<=6).length;
    return {label,target,revisits};
  });
  const novel=options.filter(o=>o.revisits===0);
  // Only generic exploration is filtered; explicit move/flee actions remain available.
  return novel.length ? novel : options.filter(o=>o.revisits===Math.min(...options.map(o=>o.revisits)));
}

export function loopSummary(memory, dimension) {
  const recent=(memory.recent || []).filter(a=>a.dimension===dimension).slice(-12);
  const explore=recent.filter(a=>a.action.startsWith('explore_'));
  let returns=0;
  for(let i=1;i<explore.length;i++) if(explore.slice(0,i).some(a=>distance(a.from,explore[i].to)<=4)) returns++;
  return {explorationActions:explore.length,returnsToRecentPositions:returns,
    consecutiveExploration:recent.slice().reverse().findIndex(a=>!a.action.startsWith('explore_'))===-1 ? recent.length : recent.slice().reverse().findIndex(a=>!a.action.startsWith('explore_')),
    warning:returns>=2 ? 'Exploration is revisiting the same area. Choose an unseen route or a concrete local action; movement alone is not resource progress.' : null};
}
