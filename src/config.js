import path from 'node:path';
import { globalConfigPath } from './paths.js';
import { readJson, deepMerge } from './util.js';

export const DEFAULTS = {
  claude: { bin: 'claude' },
  rtk: { bin: null },
  gitnexus: { bin: null },
  delegate: {
    model: 'haiku',          // any alias/model the Claude Code CLI accepts
    thresholdLines: 350,     // Spotify's published default; env TOKEMITSU_MIN_LINES overrides
    maxFileBytes: 600_000,   // above this the worker can't take the file; hooks fail open
    timeoutSec: 120,
  },
  graph: {
    // GitNexus savings are estimated: avoided = response tokens x (multiplier - 1). Calibrate with `graph-bench`.
    estimatedExplorationMultiplier: 3,
    benchFilesRead: 5,
  },
  analytics: { carryTurnsCap: 25 },
};

/** Defaults < ~/.tokemitsu/config.json < <project>/.tokemitsu/config.json < environment. */
export function loadConfig(cwd = process.cwd(), env = process.env) {
  let cfg = deepMerge(structuredClone(DEFAULTS), readJson(globalConfigPath(), {}));
  cfg = deepMerge(cfg, readJson(path.join(cwd, '.tokemitsu', 'config.json'), {}));
  if (env.TOKEMITSU_MIN_LINES) cfg.delegate.thresholdLines = Number(env.TOKEMITSU_MIN_LINES);
  if (env.TOKEMITSU_WORKER_MODEL) cfg.delegate.model = env.TOKEMITSU_WORKER_MODEL;
  if (env.TOKEMITSU_CLAUDE_BIN) cfg.claude.bin = env.TOKEMITSU_CLAUDE_BIN;
  if (env.TOKEMITSU_RTK_BIN) cfg.rtk.bin = env.TOKEMITSU_RTK_BIN;
  if (env.TOKEMITSU_GITNEXUS_BIN) cfg.gitnexus.bin = env.TOKEMITSU_GITNEXUS_BIN;
  cfg.cwd = cwd;
  return cfg;
}
