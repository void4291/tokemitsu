import { which, run, nodeSatisfies } from './util.js';
import { rtkStatus, hookWired, latestVersion } from './tools/rtk.js';
import { gitnexusStatus, mcpRegistered, doctor, indexStatus, npmLatest } from './tools/gitnexus.js';
import { enabledAt } from './delegate/enable.js';
import { workerAvailable, runWorker } from './delegate/worker.js';
import { cmpVer } from './util.js';

const c = (id, label, status, detail = '', fix = '') => ({ id, label, status, detail, fix });

/** Everything is local and read-only unless `worker`/`latest` are requested. */
export async function verify({ cfg, cwd = cfg.cwd, worker = false, latest = false } = {}) {
  const out = [];
  const nodeOk = nodeSatisfies('>=18.3.0');
  out.push(c('node', 'Node.js', nodeOk ? 'ok' : 'fail', process.versions.node, nodeOk ? '' : 'Install Node 18.3 or newer'));

  const cl = which(cfg.claude.bin);
  if (cl) {
    const v = run(cl, ['--version']);
    out.push(c('claude', 'Claude Code CLI', 'ok', (v.stdout || '').trim() || cl));
  } else out.push(c('claude', 'Claude Code CLI', 'fail', 'not found on PATH', 'Install Claude Code: https://docs.claude.com/en/docs/claude-code'));

  // rtk
  const r = rtkStatus(cfg);
  if (!r.installed) out.push(c('rtk', 'rtk installed', 'fail', 'not found', 'tokemitsu setup'));
  else if (!r.isReal) out.push(c('rtk', 'rtk installed', 'fail', `${r.bin} is not rtk-ai/rtk (name clash with another "rtk")`, 'tokemitsu setup'));
  else {
    let detail = `${r.version} (${r.bin})`;
    let status = 'ok';
    if (!r.onPath) { status = 'warn'; detail += ' - not on PATH; hooks may not find it'; }
    if (latest) {
      const l = await latestVersion();
      if (l && cmpVer(l, r.version) > 0) { status = 'warn'; detail += ` - update available: ${l}`; }
    }
    out.push(c('rtk', 'rtk installed', status, detail, status === 'ok' ? '' : 'tokemitsu update rtk'));
    out.push(hookWired()
      ? c('rtk-hook', 'rtk Claude Code hook', 'ok', 'found in ~/.claude/settings.json')
      : c('rtk-hook', 'rtk Claude Code hook', 'fail', 'not wired', 'tokemitsu setup  (runs: rtk init -g --auto-patch)'));
  }

  // gitnexus
  const g = gitnexusStatus(cfg);
  if (!g.installed) out.push(c('gitnexus', 'GitNexus installed', 'fail', 'not found', 'tokemitsu setup'));
  else {
    let status = g.nodeOk ? 'ok' : 'fail';
    let detail = `${g.version} (${g.bin})`;
    if (!g.nodeOk) detail += ` - requires Node ${g.engines}, you have ${process.versions.node}`;
    if (latest && g.nodeOk) {
      const l = npmLatest();
      if (l && cmpVer(l, g.version) > 0) { status = 'warn'; detail += ` - update available: ${l}`; }
    }
    out.push(c('gitnexus', 'GitNexus installed', status, detail, status === 'ok' ? '' : 'tokemitsu update gitnexus'));
    if (g.nodeOk) {
      const d = doctor(cfg);
      out.push(c('gitnexus-doctor', 'GitNexus self-check (gitnexus doctor)', d.ok ? (d.warnings.length ? 'warn' : 'ok') : 'fail', d.warnings.join('; ') || 'healthy', d.ok && !d.warnings.length ? '' : 'See: gitnexus doctor'));
    }
    out.push(mcpRegistered()
      ? c('gitnexus-mcp', 'GitNexus MCP registered in Claude Code', 'ok', '~/.claude.json')
      : c('gitnexus-mcp', 'GitNexus MCP registered in Claude Code', 'fail', 'not registered', 'tokemitsu setup'));
    const ix = indexStatus(cwd, cfg);
    if (!ix.indexed) out.push(c('gitnexus-index', 'This repo indexed', 'warn', 'no .gitnexus/ here', 'tokemitsu index'));
    else if (ix.stale) out.push(c('gitnexus-index', 'This repo indexed', 'warn', `stale (${ix.indexedCommit} vs ${ix.currentCommit})`, 'tokemitsu index'));
    else out.push(c('gitnexus-index', 'This repo indexed', 'ok', ix.stale === false ? 'up to date' : 'present'));
  }

  // delegation
  const where = enabledAt(cwd);
  out.push(where.length
    ? c('delegate', 'Delegation hooks (Spotify pattern)', workerAvailable(cfg) ? 'ok' : 'warn', `enabled: ${where.join(' + ')}`, workerAvailable(cfg) ? '' : 'claude CLI missing: hooks will fail open')
    : c('delegate', 'Delegation hooks (Spotify pattern)', 'skip', 'not enabled (opt-in)', 'tokemitsu delegate enable'));

  if (worker) {
    try {
      const w = await runWorker({ system: 'Reply with exactly: ok', prompt: 'ping', cfg });
      out.push(c('worker', 'Cheap worker round-trip', 'ok', `${w.model}, ${w.latencyMs}ms, $${w.costUsd.toFixed(4)}`));
    } catch (e) { out.push(c('worker', 'Cheap worker round-trip', 'fail', e.message, 'Check that `claude` is logged in: run `claude` once interactively')); }
  }
  return out;
}

export const summarize = (checks) => ({
  ok: checks.every((x) => x.status !== 'fail'),
  fails: checks.filter((x) => x.status === 'fail').length,
  warns: checks.filter((x) => x.status === 'warn').length,
});
