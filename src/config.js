export function config(env = process.env) {
  function number(name, fallback, min, max) {
    const value = Number(env[name] || fallback);
    if (!Number.isFinite(value) || value < min || value > max) throw new Error(`Invalid ${name}`);
    return value;
  }
  const auth = env.MC_AUTH || 'offline';
  if (!['offline', 'microsoft'].includes(auth)) throw new Error('MC_AUTH must be offline or microsoft');
  return {
    openaiKey: env.OPENAI_API_KEY,
    key: env.TYPESAFE_API_KEY, model: env.JEV_MODEL || 'jev-latest',
    worldId: env.WORLD_ID || 'lan-world',
    viewer: env.VIEWER !== '0', viewerPort: number('VIEWER_PORT', 3007, 1, 65535),
    host: env.MC_HOST || 'localhost', port: number('MC_PORT', 25565, 1, 65535),
    username: env.MC_USERNAME || 'JevRunner', auth, version: env.MC_VERSION || undefined,
    interval: number('DECISION_MS', 1500, 250, 60000),
    decisions: number('MAX_DECISIONS', 2000, 1, 100000),
    minutes: number('MAX_MINUTES', 120, 1, 1440),
    confidence: number('MIN_CONFIDENCE', 0.2, 0, 1),
    actionTimeout: number('ACTION_TIMEOUT_MS', 20000, 1000, 120000)
  };
}
