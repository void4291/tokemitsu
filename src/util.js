import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { spawnSync } from 'node:child_process';

export function which(bin) {
  if (!bin) return null;
  if (bin.includes('/') || bin.includes('\\')) return fs.existsSync(bin) ? bin : null;
  const exts = process.platform === 'win32' ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';') : [''];
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    for (const ext of exts) {
      const p = path.join(dir, bin + ext);
      try { if (fs.statSync(p).isFile()) return p; } catch { /* next */ }
    }
  }
  return null;
}
export function readJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
}
export function writeJson(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n');
}
/**
 * Node refuses to spawn .cmd/.bat shims (npm globals like gitnexus.CMD) without a shell on Windows.
 * Route those through the shell with each token quoted.
 */
function spawnPlan(cmd, args) {
  if (process.platform === 'win32' && /.(cmd|bat)$/i.test(cmd)) {
    const q = (a) => (/^[w@%+=:,./\-]+$/.test(a) ? a : `"${String(a).replace(/"/g, '\\"')}"`);
    return { cmd: q(cmd), args: args.map(q), shell: true };
  }
  return { cmd, args, shell: false };
}
/** Run a command and capture output. Never throws. */
export function run(cmd, args = [], { cwd, env, input, timeout = 60_000 } = {}) {
  const p = spawnPlan(cmd, args);
  const r = spawnSync(p.cmd, p.args, { cwd, env: env ? { ...process.env, ...env } : process.env, input, encoding: 'utf8', timeout, maxBuffer: 64e6, shell: p.shell });
  return { status: r.status ?? (r.error ? 127 : 1), stdout: r.stdout ?? '', stderr: r.stderr ?? '', error: r.error };
}
/** Run a command attached to the terminal. */
export function runInherit(cmd, args = [], { cwd, env } = {}) {
  const p = spawnPlan(cmd, args);
  const r = spawnSync(p.cmd, p.args, { cwd, env: env ? { ...process.env, ...env } : process.env, stdio: 'inherit', shell: p.shell });
  return r.status ?? (r.error ? 127 : 1);
}
export async function confirm(question, { yes = false, defaultNo = false } = {}) {
  if (yes) return true;
  if (!process.stdin.isTTY) return false;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ans = await new Promise((res) => rl.question(`${question} ${defaultNo ? '[y/N]' : '[Y/n]'} `, res));
  rl.close();
  const a = ans.trim().toLowerCase();
  return a ? a.startsWith('y') : !defaultNo;
}

export const estimateTokens = (text) => Math.ceil(Buffer.byteLength(text || '', 'utf8') / 4);
export const fmtInt = (n) => Math.round(n || 0).toLocaleString('en-US');
export const fmtUsd = (n) => (n < 0 ? '-' : '') + '$' + Math.abs(n || 0).toFixed(Math.abs(n || 0) < 10 ? 2 : 0);
export const pct = (a, b) => (b ? (100 * a) / b : 0);
export const fmtPct = (n) => (Number.isFinite(n) ? n.toFixed(1) : '0.0') + '%';

export function numberLines(text) {
  return text.split('\n').map((l, i) => `${String(i + 1).padStart(6)}\t${l}`).join('\n');
}
export function deepMerge(base, over) {
  if (Array.isArray(base) || typeof base !== 'object' || base === null) return over ?? base;
  const out = { ...base };
  for (const [k, v] of Object.entries(over ?? {})) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) ? deepMerge(base[k] ?? {}, v) : v;
  }
  return out;
}
/** "7d" | "24h" | "2w" | "all" | ISO date -> epoch ms (or null for all). */
export function parseSince(s) {
  if (!s || s === 'all') return null;
  const m = /^(\d+)([hdw])$/.exec(s);
  if (m) return Date.now() - Number(m[1]) * { h: 3600e3, d: 86400e3, w: 604800e3 }[m[2]];
  const d = Date.parse(s);
  return Number.isNaN(d) ? null : d;
}
const parseVer = (v) => String(v).replace(/^[^\d]*/, '').split('.').map((n) => parseInt(n, 10) || 0);
export function cmpVer(a, b) {
  const [x, y] = [parseVer(a), parseVer(b)];
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
  return 0;
}
/** Minimal check for "^22.18.0 || >=24.11.0"-style engine ranges (caret and >= only). */
export function nodeSatisfies(range, version = process.versions.node) {
  return String(range).split('||').some((part) => {
    const p = part.trim();
    if (p.startsWith('^')) return parseVer(p)[0] === parseVer(version)[0] && cmpVer(version, p.slice(1)) >= 0;
    if (p.startsWith('>=')) return cmpVer(version, p.slice(2).trim()) >= 0;
    return cmpVer(version, p) === 0;
  });
}
export const dayOf = (ts) => new Date(ts).toISOString().slice(0, 10);
