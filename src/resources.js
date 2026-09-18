import { count } from './strategy.js';
import { Vec3 } from 'vec3';

export function woodSupply(inventory) {
  return count(inventory, /_planks$/) + 4 * count(inventory, /_log$|_stem$/);
}

// Filter before limiting so underground matches cannot hide exposed resources.
export function resourceTargets(bot, matcher) {
  const feet = bot.entity.position.floored();
  return bot.findBlocks({matching:b => matcher.test(b.name) &&
    (b.canHarvest(null) || bot.inventory.items().some(i => b.canHarvest(i.type))), maxDistance:32,count:128})
    .filter(p => !(p.x === feet.x && p.z === feet.z && p.y < feet.y))
    .map(p => bot.blockAt(p)).filter(Boolean)
    .map(block => ({block,visible:bot.canSeeBlock(block)}))
    .filter(({block,visible}) => visible || [new Vec3(1,0,0),new Vec3(-1,0,0),new Vec3(0,0,1),new Vec3(0,0,-1)].some(d => {
      const side = block.position.plus(d);
      // An open, dry standing space beside a loaded resource, not a tunnel request.
      return bot.blockAt(side)?.name === 'air' && bot.blockAt(side.offset(0,1,0))?.name === 'air' && bot.blockAt(side.offset(0,-1,0))?.boundingBox === 'block';
    }))
    .sort((a,b) => Number(b.visible)-Number(a.visible) || bot.entity.position.distanceTo(a.block.position)-bot.entity.position.distanceTo(b.block.position))
    .slice(0,3);
}

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
