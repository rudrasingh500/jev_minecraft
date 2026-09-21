const distance = (a,b) => Math.hypot(a.x-b.x,a.z-b.z);

export function explorationOptions(memory, state) {
  const origin = state.position;
  const recent = (memory.recent || []).filter(a=>a.dimension===state.dimension).slice(-16);
  // Actual arrival points, not chunk keys for destinations the pathfinder never reached.
  const points = recent.flatMap(a=>[a.from,a.to]).filter(p=>p && distance(p,origin)>4);
  const directions = [
    ['north',0,-1],['northeast',1,-1],['east',1,0],['southeast',1,1],
    ['south',0,1],['southwest',-1,1],['west',-1,0],['northwest',-1,-1]
  ];
  const distances = [1,2,4,8,16,32,64];
  const options=[];
  for(const distanceBlocks of distances) for(const [direction,dx,dz] of directions) {
    const scale=distanceBlocks/Math.hypot(dx,dz);
    const target={x:Math.floor(origin.x)+Math.round(dx*scale),z:Math.floor(origin.z)+Math.round(dz*scale)};
    const revisits=points.filter(p=>distance(target,p)<=6).length;
    options.push({
      label:`${direction}_${distanceBlocks}`,
      direction,
      distanceBlocks,
      target,
      revisits,
      arrivalRadius:Math.min(3,Math.floor(distanceBlocks/4)),
      timeoutMs:Math.min(19000,6000+distanceBlocks*250)
    });
  }
  // Preserve all routes and expose revisit evidence to Jev instead of deciding the route here.
  return options.sort((a,b)=>a.revisits-b.revisits || a.distanceBlocks-b.distanceBlocks);
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
