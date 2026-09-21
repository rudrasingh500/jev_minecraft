import { setTimeout as sleep } from 'node:timers/promises';
import { compactRequest, executionContext } from './context.js';

export const JEV_ACTION_INSTRUCTIONS = [
  'Choose the available action that makes the most useful progress toward beating the Ender Dragon.',
  'An advisory microgoal should guide priorities when it is useful, but it is not a boundary on your behavior.',
  'Always keep making progress: when advice is absent, pending, completed, blocked, or too narrow, choose the next sensible step yourself.',
  'Use intermediate actions to create new options; a needed resource does not have to be visible or already exposed.',
  'Use the current state and recent outcomes, protect yourself when necessary, and change approach instead of repeating an unproductive loop.'
].join(' ');

export const JEV_PLAN_INSTRUCTIONS = 'Choose a useful short-lived tactical focus toward beating the Ender Dragon. It is revisable guidance, not a replacement objective or a limit on useful actions.';

function summarizeSkill(skill,candidates) {
  const descriptions=[];
  let length=0;
  for(const candidate of candidates) {
    const summary=candidate.description
      .replace(/ at \([^)]*\)/g,'')
      .replace(/ at \{.*$/g,'')
      .replace(/ toward \([^)]*\)/g,'')
      .replace(/; recent arrival matches \d+/g,'');
    if(descriptions.includes(summary)) continue;
    if(length+summary.length>800) break;
    descriptions.push(summary);length+=summary.length;
  }
  return `${skill}: ${candidates.length} currently available actions. ${descriptions.join('; ')}`;
}

export class JevClient {
  constructor({ key, model = 'jev-latest', fetchImpl = fetch, timeout = 8000 } = {}) {
    if (!key) throw new Error('Set TYPESAFE_API_KEY in .env.');
    this.key = key;
    this.model = model;
    this.fetch = fetchImpl;
    this.timeout = timeout;
    this.requests = 0;
    this.inputTokens = 0;
  }

  async chooseAction(state, candidates, signal) {
    const skills = [...new Set(candidates.map(a=>a.skill))].map(skill=>{
      const available=candidates.filter(a=>a.skill===skill);
      return {id:skill,description:summarizeSkill(skill,available)};
    });
    const selected = await this.choose(state,skills,signal,'skill');
    let targets = candidates.filter(a=>a.skill===selected.id);
    let parameterConfidence=1;
    if(targets.some(a=>a.parameterGroup)) {
      const groups=[...new Set(targets.map(a=>a.parameterGroup))].map(id=>({id,description:`Use ${id}; choose placement coordinates next`}));
      const parameter=await this.choose(state,groups,signal,'skill');
      parameterConfidence=parameter.confidence;
      targets=targets.filter(a=>a.parameterGroup===parameter.id);
    }
    const choice = await this.choose(state,targets,signal);
    return {...choice,confidence:Math.min(selected.confidence,parameterConfidence,choice.confidence)};
  }

  async choose(state, candidates, signal, mode = 'action') {
    if (!candidates.length) throw new Error('No available actions.');
    const criteria = Object.fromEntries(candidates.map(a => [a.id, a.description]));
    const context = mode !== 'plan' ? executionContext(state,candidates) : state;
    const assess = mode === 'action' && !!context.microgoal && context.microgoal.status !== 'completed';
    const body = JSON.stringify(compactRequest({
      model: this.model, state:context,
      questions: { action: {
        type: 'choice',
        instructions: mode === 'plan' ? JEV_PLAN_INSTRUCTIONS : JEV_ACTION_INSTRUCTIONS,
        criteria
      }, ...(candidates.some(a=>a.maxQuantity>1) ? {quantity:{type:'choice',instructions:'Choose how many recipe batches or furnace items are useful now.',criteria:{'1':'One batch','2':'Two batches','4':'Four batches'}}} : {}), ...(assess ? { goal_status: { type:'choice', instructions:'Assess whether the active advisory microgoal is still useful: pursuing, blocked, or complete.', criteria:{ pursuing:'Continue using this milestone as guidance.', blocked:'This milestone is not currently useful or feasible.', complete:'Current observations satisfy the milestone.'} } } : {}) }
    }));
    for (let attempt = 0; attempt < 3; attempt++) {
      this.requests++;
      const response = await this.fetch('https://api.typesafe.ai/v1/systemone', {
        method: 'POST', redirect: 'error',
        headers: { Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/json' },
        body, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(this.timeout)]) : AbortSignal.timeout(this.timeout)
      });
      if ([429, 529, 502, 503].includes(response.status) && attempt < 2) {
        const retry = Number(response.headers.get('retry-after'));
        await response.body?.cancel();
        await sleep(Math.min(10000, retry > 0 ? retry * 1000 : 500 * 2 ** attempt), undefined, { signal });
        continue;
      }
      // Do not log response bodies: an upstream error might echo credentials.
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`Jev HTTP ${response.status}${response.status === 401 ? ': check TYPESAFE_API_KEY' : ''}`);
      }
      const result = await response.json();
      const answer = result.answers?.action;
      if (answer?.type !== 'choice' || !Object.hasOwn(criteria, answer.choice) ||
          !Number.isFinite(answer.confidence) || answer.confidence < 0 || answer.confidence > 1) {
        throw new Error('Jev returned an invalid or unavailable action.');
      }
      this.inputTokens += result.usage?.input_tokens ?? 0;
      const assessment = result.answers?.goal_status;
      const goalStatus = assessment?.type === 'choice' && ['pursuing','blocked','complete'].includes(assessment.choice) && Number.isFinite(assessment.confidence) && assessment.confidence >= 0 && assessment.confidence <= 1 ? {status:assessment.choice,confidence:assessment.confidence} : null;
      const quantityAnswer=result.answers?.quantity;
      const quantity=quantityAnswer?.type==='choice' && ['1','2','4'].includes(quantityAnswer.choice) ? Number(quantityAnswer.choice) : 1;
      return { id: answer.choice, confidence: answer.confidence, goalStatus, quantity:Math.min(quantity,candidates.find(a=>a.id===answer.choice)?.maxQuantity || 1), usage: result.usage };
    }
  }
}
