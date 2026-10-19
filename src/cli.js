import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { spawnSync } from 'node:child_process';
import { loadConfig } from './config.js';
import { setup } from './setup.js';
import { verify, summarize } from './verify.js';
import { computeReport } from './analytics.js';
import { formatReport } from './report.js';
import { createServer, listen } from './dashboard/server.js';
import * as rtk from './tools/rtk.js';
import * as gn from './tools/gitnexus.js';
import * as dg from './delegate/enable.js';
import { delegateRead, delegateWrite } from './delegate/modes.js';
import { runHook } from './delegate/hooks.js';
import { parseSince, runInherit, fmtInt, fmtPct, confirm, cmpVer } from './util.js';
import { tkHome } from './paths.js';

const VERSION = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

const HELP = `tokemitsu ${VERSION} - cut Claude Code token spend, and see exactly what you saved

  tokemitsu setup [--yes] [--accept-gitnexus-license] [--skip-rtk] [--skip-gitnexus] [--index] [--with-delegate]
  tokemitsu verify [--worker] [--latest] [--json]
  tokemitsu update [rtk|gitnexus|all] [--check] [--dry-run]
  tokemitsu index [gitnexus analyze args]       index the current repo (GitNexus)
  tokemitsu rtk <args...>                       run the real rtk, unchanged (e.g. tokemitsu rtk gain)
  tokemitsu gitnexus <args...>   (alias: gn)    run the real GitNexus, unchanged (e.g. tokemitsu gn query "auth flow")
  tokemitsu delegate enable|disable [--global]  opt in/out of the cheap-model pattern (Claude Code hooks + skill)
  tokemitsu delegate status
  tokemitsu delegate read <file> --ask "<question>"
  tokemitsu delegate write --like <ref>... --spec "<what>" [--out <file>] [--force]
  tokemitsu graph-bench <symbol>                measure GitNexus vs grep-and-read on your repo
  tokemitsu report [--since 30d|all] [--project <path>|--here] [--json]
  tokemitsu dashboard [--port 4777] [--open] [--since 30d]
  tokemitsu uninstall [--global] [--purge]      remove our hooks/skill (rtk and GitNexus: use their own uninstall)

Everything runs locally. No API keys. rtk and GitNexus are installed from their official sources and keep their own licenses.`;

const out = (s = '') => process.stdout.write(s + '\n');
const err = (s) => process.stderr.write(s + '\n');
const ICON = { ok: '✓', warn: '!', fail: '✗', skip: '-' };

function passthrough(bin, args, name, hint) {
  if (!bin) { err(`${name} is not installed. ${hint}`); return 127; }
  return spawnSync(bin, args, { stdio: 'inherit' }).status ?? 1;
}

export async function main(argv) {
  const [cmd, ...rest] = argv;
  const cwd = process.cwd();
  const cfg = loadConfig(cwd);

  // Raw passthrough happens BEFORE any option parsing so upstream flags are never touched.
  if (cmd === 'rtk') return passthrough(rtk.findRtk(cfg), rest, 'rtk', 'Run: tokemitsu setup');
  if (cmd === 'gitnexus' || cmd === 'gn') return passthrough(gn.findGitnexus(cfg), rest, 'GitNexus', 'Run: tokemitsu setup');
  if (cmd === 'index') return passthrough(gn.findGitnexus(cfg), ['analyze', ...rest], 'GitNexus', 'Run: tokemitsu setup');
  if (cmd === 'hook') return rest[0] === 'pre-tool' ? runHook(await readStdin()) : 0;

  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') { out(HELP); return 0; }
  if (cmd === '--version' || cmd === '-v' || cmd === 'version') { out(VERSION); return 0; }

  const parse = (options, allowPositionals = false) => {
    try { return parseArgs({ args: rest, options, allowPositionals, strict: true }); }
    catch (e) { throw new Error(`${e.message}\nRun: tokemitsu help`); }
  };

  switch (cmd) {
    case 'setup': {
      const { values: v } = parse({ yes: { type: 'boolean', short: 'y' }, 'accept-gitnexus-license': { type: 'boolean' }, 'skip-rtk': { type: 'boolean' }, 'skip-gitnexus': { type: 'boolean' }, index: { type: 'boolean' }, 'with-delegate': { type: 'boolean' } });
      const steps = await setup({ cfg, cwd, yes: v.yes, acceptGitnexusLicense: v['accept-gitnexus-license'], skipRtk: v['skip-rtk'], skipGitnexus: v['skip-gitnexus'], index: v.index, withDelegate: v['with-delegate'], log: out });
      out('\nVerifying...');
      const checks = await verify({ cfg });
      printChecks(checks);
      return steps.some((s) => s.status === 'fail') || !summarize(checks).ok ? 1 : 0;
    }
    case 'verify': {
      const { values: v } = parse({ worker: { type: 'boolean' }, latest: { type: 'boolean' }, json: { type: 'boolean' } });
      const checks = await verify({ cfg, worker: v.worker, latest: v.latest });
      if (v.json) out(JSON.stringify(checks, null, 2)); else printChecks(checks);
      return summarize(checks).ok ? 0 : 1;
    }
    case 'update': {
      const { values: v, positionals: [which = 'all'] } = parse({ check: { type: 'boolean' }, 'dry-run': { type: 'boolean' } }, true);
      let code = 0;
      if (which === 'rtk' || which === 'all') code ||= await updateRtk(cfg, v);
      if (which === 'gitnexus' || which === 'all') code ||= await updateGitnexus(cfg, v);
      if (!['rtk', 'gitnexus', 'all'].includes(which)) { err('usage: tokemitsu update [rtk|gitnexus|all]'); return 2; }
      return code;
    }
    case 'delegate': return delegateCmd(rest, cfg, cwd);
    case 'graph-bench': {
      const { positionals: [sym] } = parse({}, true);
      if (!sym) { err('usage: tokemitsu graph-bench <symbol>'); return 2; }
      const b = gn.bench(sym, cwd, cfg);
      out(`Symbol: ${b.symbol}  (${b.hitFiles} files mention it; baseline reads ${b.filesRead})`);
      out(`  grep + read files : ${fmtInt(b.baselineTokens)} tokens (simulated)`);
      out(`  gitnexus context  : ${fmtInt(b.graphTokens)} tokens (measured)`);
      const ratio = b.graphTokens ? b.baselineTokens / b.graphTokens : 0;
      out(`  ratio             : ${ratio.toFixed(1)}x  (config graph.estimatedExplorationMultiplier is ${cfg.graph.estimatedExplorationMultiplier})`);
      out('One symbol is a sample, not a benchmark. Run it on several and set the multiplier in .tokemitsu/config.json.');
      return 0;
    }
    case 'report': {
      const { values: v } = parse({ since: { type: 'string' }, project: { type: 'string' }, here: { type: 'boolean' }, json: { type: 'boolean' } });
      const project = v.here ? cwd : v.project ? path.resolve(v.project) : null;
      const r = await computeReport({ since: parseSince(v.since ?? '30d'), project, cfg });
      out(v.json ? JSON.stringify(r, null, 2) : formatReport(r));
      return 0;
    }
    case 'dashboard': {
      const { values: v } = parse({ port: { type: 'string' }, open: { type: 'boolean' }, project: { type: 'string' }, here: { type: 'boolean' } });
      const project = v.here ? cwd : v.project ? path.resolve(v.project) : null;
      const server = createServer({ cfg, project });
      let port;
      try { port = await listen(server, Number(v.port ?? 4777)); }
      catch (e) { if (e.code === 'EADDRINUSE' && !v.port) port = await listen(server, 0); else throw e; }
      const url = `http://127.0.0.1:${port}/`;
      out(`tokemitsu dashboard: ${url}   (local only, Ctrl+C to stop)`);
      if (v.open) openBrowser(url);
      await new Promise((r) => process.once('SIGINT', r));
      server.close();
      return 0;
    }
    case 'uninstall': {
      const { values: v } = parse({ global: { type: 'boolean' }, purge: { type: 'boolean' } });
      for (const g of v.global ? [false, true] : [false]) { const r = dg.disable({ global: g, cwd }); out(`removed delegation hooks/skill: ${r.settings}`); }
      if (v.purge) { fs.rmSync(tkHome(), { recursive: true, force: true }); out(`deleted ${tkHome()} (ledger, state, config)`); }
      out('rtk and GitNexus were left installed. Remove them with their own commands: "gitnexus uninstall", and see the rtk README.');
      return 0;
    }
    default:
      err(`unknown command: ${cmd}\n`); err(HELP); return 2;
  }
}

function printChecks(checks) {
  for (const c of checks) {
    out(`${ICON[c.status]} ${c.label}${c.detail ? ' - ' + c.detail : ''}`);
    if (c.fix && c.status !== 'ok') out(`    fix: ${c.fix}`);
  }
  const s = summarize(checks);
  out(`\n${s.ok ? 'All required checks passed' : s.fails + ' check(s) failed'}${s.warns ? `, ${s.warns} warning(s)` : ''}.`);
}

async function updateRtk(cfg, v) {
  const st = rtk.rtkStatus(cfg);
  if (!st.installed) { err('rtk is not installed (tokemitsu setup)'); return 1; }
  const latest = await rtk.latestVersion();
  out(`rtk ${st.version}${latest ? ` (latest ${latest})` : ' (could not check latest)'}`);
  if (v.check) return 0;
  if (latest && cmpVer(latest, st.version) <= 0) { out('rtk is up to date.'); return 0; }
  const plan = rtk.planUpdate(st.bin);
  out(`update method (${plan.method}): ${rtk.describePlan(plan)}`);
  if (v['dry-run']) return 0;
  return plan.cmd ? rtk.execPlan(plan) : (err(plan.help), 1);
}
async function updateGitnexus(cfg, v) {
  const st = gn.gitnexusStatus(cfg);
  if (!st.installed) { err('GitNexus is not installed (tokemitsu setup)'); return 1; }
  const latest = gn.npmLatest();
  out(`GitNexus ${st.version}${latest ? ` (latest ${latest})` : ' (could not check latest)'}`);
  if (v.check) return 0;
  if (latest && cmpVer(latest, st.version) <= 0) { out('GitNexus is up to date.'); return 0; }
  out('update: gitnexus update');
  if (v['dry-run']) return 0;
  return runInherit(st.bin, ['update']);
}

async function delegateCmd(args, cfg, cwd) {
  const [sub, ...rest] = args;
  const parse = (options, pos = false) => parseArgs({ args: rest, options, allowPositionals: pos, strict: true });
  switch (sub) {
    case 'enable': {
      const { values: v } = parse({ global: { type: 'boolean' }, 'dry-run': { type: 'boolean' } });
      const r = dg.enable({ global: v.global, cwd, dryRun: v['dry-run'] });
      out(`${v['dry-run'] ? 'would enable' : 'enabled'} delegation (${v.global ? 'global' : 'this project'})\n  hooks: ${r.settings}\n  skill: ${r.skill}`);
      out(`Reads over ${cfg.delegate.thresholdLines} lines are now answered by a ${cfg.delegate.model} worker via your Claude Code login. Restart Claude Code to load the hooks.`);
      return 0;
    }
    case 'disable': {
      const { values: v } = parse({ global: { type: 'boolean' } });
      const r = dg.disable({ global: v.global, cwd });
      out(`disabled delegation: ${r.settings}`);
      return 0;
    }
    case 'status': {
      const where = dg.enabledAt(cwd);
      out(where.length ? `enabled: ${where.join(' + ')}` : 'not enabled (tokemitsu delegate enable)');
      out(`worker model: ${cfg.delegate.model}, threshold: ${cfg.delegate.thresholdLines} lines, claude CLI: ${cfg.claude.bin}`);
      return 0;
    }
    case 'read': {
      const { values: v, positionals: [file] } = parse({ ask: { type: 'string' } }, true);
      if (!file || !v.ask) { err('usage: tokemitsu delegate read <file> --ask "<question>"'); return 2; }
      const r = await delegateRead({ file, question: v.ask, cfg });
      out(r.answer);
      err(`\n[tokemitsu] kept ${fmtInt(r.tokensAfter)} tokens out of ${fmtInt(r.tokensBefore)} (${fmtPct(100 * (1 - r.tokensAfter / Math.max(1, r.tokensBefore)))} avoided), worker $${r.workerCostUsd.toFixed(4)}, ${(r.latencyMs / 1000).toFixed(1)}s`);
      return 0;
    }
    case 'write': {
      const { values: v } = parse({ like: { type: 'string', multiple: true }, spec: { type: 'string' }, out: { type: 'string' }, force: { type: 'boolean' }, 'allow-outside': { type: 'boolean' } });
      if (!v.spec || !v.like?.length) { err('usage: tokemitsu delegate write --like <ref>... --spec "<what>" [--out <file>] [--force]'); return 2; }
      const r = await delegateWrite({ spec: v.spec, refs: v.like, out: v.out, force: v.force, allowOutside: v['allow-outside'], cfg });
      out(r.output);
      err(`[tokemitsu] worker $${r.workerCostUsd.toFixed(4)}, ${(r.latencyMs / 1000).toFixed(1)}s. Review the result before relying on it.`);
      return 0;
    }
    default: err('usage: tokemitsu delegate enable|disable|status|read|write'); return 2;
  }
}

function openBrowser(url) {
  const [c, a] = process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]];
  try { spawnSync(c, a, { stdio: 'ignore' }); } catch { /* best effort */ }
}
function readStdin() {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) return resolve('');
    let d = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => (d += c));
    process.stdin.on('end', () => resolve(d));
  });
}
