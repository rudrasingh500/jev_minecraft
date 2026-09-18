export async function navigate(bot, goal, timeoutMs = 8000) {
  let expired = false;
  const timer = setTimeout(() => {
    expired = true;
    bot.pathfinder.setGoal(null);
    bot.clearControlStates();
  }, timeoutMs);
  try {
    await bot.pathfinder.goto(goal);
    if (expired) throw new Error('Navigation timed out');
    if (goal.isEnd && bot.entity?.position && !goal.isEnd(bot.entity.position.floored())) throw new Error('Navigation ended before reaching the target');
  } catch (error) {
    if (expired) throw new Error(`Navigation timed out after ${timeoutMs} ms; movement cancelled`, { cause: error });
    throw error;
  } finally { clearTimeout(timer); }
}
