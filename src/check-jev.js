import { JevClient } from './jev.js';
import { config } from './config.js';
const c = config();
try {
  const answer = await new JevClient(c).choose(
    { health: 20, inventory: {}, objective: 'Beat the Ender Dragon', nearby: ['oak_log'] },
    [{ id: 'wood', description: 'Harvest a nearby oak log' }, { id: 'wait', description: 'Wait without making progress' }]
  );
  console.log('Jev API connected:', JSON.stringify(answer));
} catch (error) { console.error(error.message); process.exitCode = 1; }
