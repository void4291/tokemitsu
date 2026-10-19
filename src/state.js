import { statePath } from './paths.js';
import { readJson, writeJson } from './util.js';

export const loadState = () => readJson(statePath(), {});
export function patchState(patch) {
  const next = { ...loadState(), ...patch };
  writeJson(statePath(), next);
  return next;
}
