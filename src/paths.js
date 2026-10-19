import os from 'node:os';
import path from 'node:path';

/** All paths are resolved at call time so tests (and users) can redirect them with env vars. */
export const tkHome = () => process.env.TOKEMITSU_HOME || path.join(os.homedir(), '.tokemitsu');
export const claudeDir = () => process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
export const projectsDir = () => path.join(claudeDir(), 'projects');
export const claudeJsonPath = () =>
  process.env.CLAUDE_CONFIG_DIR ? path.join(process.env.CLAUDE_CONFIG_DIR, '.claude.json') : path.join(os.homedir(), '.claude.json');
export const statePath = () => path.join(tkHome(), 'state.json');
export const globalConfigPath = () => path.join(tkHome(), 'config.json');
export const ledgerPath = () => path.join(tkHome(), 'ledger.jsonl');
export const pricingPath = () => path.join(tkHome(), 'pricing.json');
