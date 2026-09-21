import { compactRequest } from './context.js';

export const ADVISOR_INSTRUCTIONS = [
  'You are the strategic advisor for a Minecraft bot whose final objective is to beat the Ender Dragon.',
  'Choose one useful, achievable next milestone from the current state, history, and capabilities.',
  'The milestone should create meaningful progress, but Jev decides the moment-to-moment route and may take useful intermediate actions beyond your suggested steps.',
  'Use your judgment, preserve progress already made, and change approach when recent outcomes show a loop or repeated failure.',
  'Give a concise rationale and 1-6 advisory steps.',
  'Express success with 1-4 observable completion conditions. For inventory, use an exact Minecraft item name and minimum count. For dimension or nearby_block, use an observed name and set target to 0.',
  'Do not select a milestone whose completion conditions are already satisfied.'
].join(' ');

export const microgoalSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    description: { type: 'string' }, rationale: { type: 'string' },
    steps: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 6 },
    completion: { type: 'array', minItems: 1, maxItems: 4, items: {
      type: 'object', additionalProperties: false,
      properties: { kind: { type: 'string', enum: ['inventory', 'dimension', 'nearby_block'] }, key: { type: 'string' }, target: { type: 'integer', minimum: 0, maximum: 128 } },
      required: ['kind','key','target']
    } }
  }, required: ['description','rationale','steps','completion']
};
export class AdvisorPlanner {
  constructor({ key, fetchImpl = fetch, timeout = 30000 }) {
    if (!key) throw new Error('Set OPENAI_API_KEY for the GPT-5.6 advisor planner');
    this.key = key; this.fetch = fetchImpl; this.timeout = timeout; this.requests = 0; this.inputTokens = 0; this.outputTokens = 0;
  }
  async propose(state, candidates, reason, signal) {
    const context = compactRequest({ state, questions: {} }).state;
    const input = {
      reason, state: context, availableActions: candidates.map(({id,description}) => ({id,description})),
      monitoredNearbyBlocks: ['crafting_table','furnace','nether_portal','end_portal','end_portal_frame','spawner','chest','diamond_ore','deepslate_diamond_ore','obsidian'],
      capabilities: 'Jev repeatedly chooses from actions generated from the live world. It can mine multiple nearby targets, deliberately excavate safe one-step passages, approach visible blocks, interact with blocks and non-hostile entities, craft available recipes, place, equip, and use items, manage furnaces, explore varied routes, collect drops, and fight. The available action list is only the current snapshot; intermediate actions can reveal or create new options.'
    };
    this.requests++;
    const response = await this.fetch('https://api.openai.com/v1/responses', {
      method: 'POST', redirect: 'error', headers: { Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/json' },
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(this.timeout)]) : AbortSignal.timeout(this.timeout),
      body: JSON.stringify({ model: 'gpt-5.6-luna', store: false, reasoning: { effort: 'high' }, max_output_tokens: 2000,
        instructions: ADVISOR_INSTRUCTIONS,
        input: JSON.stringify(input), text: { format: { type: 'json_schema', name: 'minecraft_microgoal', strict: true, schema: microgoalSchema } }
      })
    });
    if (!response.ok) { await response.body?.cancel(); throw new Error(`Advisor HTTP ${response.status}`); }
    const result = await response.json();
    this.inputTokens += result.usage?.input_tokens || 0; this.outputTokens += result.usage?.output_tokens || 0;
    if (result.status !== 'completed') throw new Error('Advisor did not complete a microgoal response');
    const text = (result.output || []).filter(o => o.type === 'message').flatMap(o => o.content || []).filter(c => c.type === 'output_text').map(c => c.text).join('');
    try { return JSON.parse(text); } catch { throw new Error('Advisor returned no valid microgoal JSON'); }
  }
}
