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
  } catch (error) {
    if (expired) throw new Error(`Navigation timed out after ${timeoutMs} ms; movement cancelled`, { cause: error });
    throw error;
  } finally { clearTimeout(timer); }
}
