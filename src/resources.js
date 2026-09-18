export function goalRecipeGuidance(bot, state) {
  const plan = state.memory?.plan;
  if (!plan || plan.completedAt || plan.status === 'completed') return [];
  return (plan.completion || []).filter(c => c.kind === 'inventory' && (state.inventory[c.key] || 0) < c.target).map(c => {
    const id = bot.registry.itemsByName[c.key]?.id;
    const recipes = id === undefined ? [] : bot.recipesAll(id,null,true);
    const options = recipes.map(r => ({requiresTable:r.requiresTable, missing:r.delta.filter(d=>d.count<0).map(d=>{
      const name=bot.registry.items[d.id]?.name;
      const required=-d.count*Math.ceil((c.target-(state.inventory[c.key] || 0))/r.result.count);
      return {name,required,held:state.inventory[name] || 0};
    }).filter(d=>d.name && d.held<d.required)}));
    options.sort((a,b)=>a.missing.reduce((n,d)=>n+d.required-d.held,0)-b.missing.reduce((n,d)=>n+d.required-d.held,0));
    return {target:c.key,recipe:options[0] || null};
  });
}
