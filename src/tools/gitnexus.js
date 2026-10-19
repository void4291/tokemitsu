import fs from 'node:fs';
import path from 'node:path';
import { which, run, runInherit, readJson, nodeSatisfies, estimateTokens, numberLines } from '../util.js';
import { claudeJsonPath } from '../paths.js';

// GitNexus is installed from the npm registry by its own maintainers and is never bundled here.
// Its license (PolyForm Noncommercial 1.0.0) applies to the user's use of it, not to this package.
export const GITNEXUS_REPO = 'https://github.com/abhigyanpatwari/GitNexus';
export const GITNEXUS_LICENSE = 'PolyForm Noncommercial License 1.0.0';
export const GITNEXUS_LICENSE_URL = 'https://polyformproject.org/licenses/noncommercial/1.0.0/';

export const findGitnexus = (cfg = {}) => (cfg.gitnexus?.bin ? which(cfg.gitnexus.bin) : which('gitnexus'));

/** Locate GitNexus' own package.json (to read its declared Node engine range) from the resolved binary. */
function enginesRange(bin) {
  try {
    let dir = path.dirname(fs.realpathSync(bin));
    for (let i = 0; i < 6; i++, dir = path.dirname(dir)) {
      const pj = readJson(path.join(dir, 'package.json'));
      if (pj?.name === 'gitnexus') return pj.engines?.node ?? null;
    }
  } catch { /* ignore */ }
  return null;
}

export function gitnexusStatus(cfg = {}) {
  const bin = findGitnexus(cfg);
  if (!bin) return { installed: false };
  const v = run(bin, ['--version']);
  const engines = enginesRange(bin);
  return {
    installed: true, bin,
    version: (v.stdout || '').trim().split('\n').pop(),
    engines,
    nodeOk: engines ? nodeSatisfies(engines) : true,
  };
}

export const mcpRegistered = () => Boolean(readJson(claudeJsonPath(), {}).mcpServers?.gitnexus);

/** Parse `gitnexus doctor` output into pass/warn signals. Raw text is kept for display. */
export function doctor(cfg = {}) {
  const bin = findGitnexus(cfg);
  if (!bin) return { ok: false, warnings: ['gitnexus not installed'], raw: '' };
  const r = run(bin, ['doctor'], { timeout: 60_000 });
  const raw = (r.stdout + r.stderr).replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
  const warnings = [];
  if (/native\s+[^\n]*✗|native[^\n]*(fail|error)/i.test(raw)) warnings.push('native module failed to load (reinstall: npm i -g gitnexus@latest)');
  if (/Graph store:\s*unavailable/i.test(raw)) warnings.push('graph store unavailable');
  if (/Full-text search:\s*unavailable/i.test(raw)) {
    warnings.push('full-text search extension not installed — run once with network: GITNEXUS_LBUG_EXTENSION_INSTALL=auto gitnexus analyze --repair-fts');
  }
  const fatal = r.status !== 0 || warnings.some((w) => /native|graph store/.test(w));
  return { ok: !fatal, warnings, raw };
}

export function installPlan() {
  return { cmd: 'npm', args: ['install', '-g', 'gitnexus@latest'], alt: 'pnpm --allow-build=@ladybugdb/core --allow-build=gitnexus --allow-build=tree-sitter add -g gitnexus@latest' };
}
export function npmMajor() {
  const r = run('npm', ['--version']);
  return parseInt(r.stdout, 10) || 0;
}
export const execInstall = () => runInherit('npm', ['install', '-g', 'gitnexus@latest']);

/** Wire GitNexus MCP + skills + hooks for Claude Code only (GitNexus' own `setup`, value "claude"). */
export const setupArgs = () => ['setup', '-c', 'claude'];

/** Index freshness for a repo: compares GitNexus' indexed commit with the current one. */
export function indexStatus(cwd, cfg = {}) {
  const indexed = fs.existsSync(path.join(cwd, '.gitnexus'));
  if (!indexed) return { indexed: false };
  const bin = findGitnexus(cfg);
  if (!bin) return { indexed: true, stale: null };
  const r = run(bin, ['status'], { cwd });
  const txt = (r.stdout + r.stderr).replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
  const a = /Indexed commit:\s*(\S+)/.exec(txt)?.[1];
  const b = /Current commit:\s*(\S+)/.exec(txt)?.[1];
  return { indexed: true, stale: a && b ? a !== b : null, indexedCommit: a, currentCommit: b };
}

export function npmLatest() {
  const r = run('npm', ['view', 'gitnexus', 'version']);
  return r.status === 0 ? r.stdout.trim() : null;
}

function grepBaseline(cwd, symbol, filesToRead) {
  const ex = ['node_modules', '.git', '.gitnexus', '.tokemitsu', 'dist', '.claude'];
  const rg = which('rg');
  const r = rg
    ? run(rg, ['-n', '--no-heading', ...ex.flatMap((e) => ['-g', `!${e}`]), '-F', symbol, '.'], { cwd })
    : run('grep', ['-rnIF', ...ex.map((e) => `--exclude-dir=${e}`), symbol, '.'], { cwd });
  const files = [];
  for (const line of r.stdout.split('\n')) {
    const f = line.split(':')[0];
    if (f && !files.includes(f)) files.push(f);
  }
  let text = r.stdout;
  const read = files.slice(0, filesToRead);
  for (const f of read) { try { text += '\n' + numberLines(fs.readFileSync(path.join(cwd, f), 'utf8')); } catch { /* skip */ } }
  return { text, hitFiles: files.length, filesRead: read.length };
}

/**
 * A/B for one symbol: what a grep-and-read exploration would put in context (simulated baseline)
 * vs the real stdout of `gitnexus context <symbol>`. Returns tokens for both sides.
 */
export function bench(symbol, cwd, cfg = {}) {
  const bin = findGitnexus(cfg);
  if (!bin) throw new Error('gitnexus is not installed (run: tokemitsu setup)');
  const g = run(bin, ['context', symbol], { cwd });
  if (g.status !== 0) throw new Error(`gitnexus context failed — is this repo indexed? (run: tokemitsu index)\n${(g.stderr || g.stdout).slice(0, 300)}`);
  const base = grepBaseline(cwd, symbol, cfg.graph?.benchFilesRead ?? 5);
  return { symbol, baselineTokens: estimateTokens(base.text), graphTokens: estimateTokens(g.stdout), hitFiles: base.hitFiles, filesRead: base.filesRead };
}
