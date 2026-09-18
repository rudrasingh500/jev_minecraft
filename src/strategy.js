export function count(items, matcher) {
  return Object.entries(items).reduce((sum, [name, n]) => sum + (typeof matcher === 'string' ? name === matcher : matcher.test(name) ? true : false) * n, 0);
}

export const RUN_OBJECTIVE = 'Beat the Ender Dragon';

export function objective() {
  return RUN_OBJECTIVE;
}

