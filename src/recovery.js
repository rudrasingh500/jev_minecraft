// Mineflayer's automatic respawn performs the protocol handshake. Keep one
// controller loop and invalidate decisions belonging to the previous life.
export function installDeathRecovery(bot, {memory, invalidate, cancel, log, isStopped}) {
  const state={waiting:false};
  bot.on('death',()=>{
    if(isStopped())return;
    state.waiting=true;
    invalidate();cancel();
    if(memory.plan){
      memory.planHistory ||= [];
      memory.planHistory.push({...memory.plan,endedAt:Date.now(),outcome:'died'});
      memory.planHistory=memory.planHistory.slice(-8);
      memory.plan=null;
    }
    memory.eyeTarget=null;
    memory.current=null;
    log('death',{message:'Respawning; previous-life decisions discarded'});
  });
  bot.on('spawn',()=>{
    if(!state.waiting || isStopped())return;
    state.waiting=false;
    log('respawned',{message:'Reassessing current inventory and surroundings'});
  });
  return state;
}
