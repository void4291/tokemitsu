import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { which, run, runInherit, readJson } from '../util.js';
import { claudeDir } from '../paths.js';
import { loadState } from '../state.js';

// rtk is installed from its own official channels and is never bundled or modified here.
export const RTK_REPO = 'https://github.com/rtk-ai/rtk';
export const RTK_INSTALL_SCRIPT = 'https://raw.githubusercontent.com/rtk-ai/rtk/refs/heads/master/install.sh';

export function findRtk(cfg = {}) {
  if (cfg.rtk?.bin) return which(cfg.rtk.bin);
  const onPath = which('rtk');
  if (onPath) return onPath;
  for (const p of [path.join(os.homedir(), '.local', 'bin', 'rtk'), path.join(os.homedir(), '.cargo', 'bin', 'rtk')]) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/** Another crate named "rtk" exists (Rust Type Kit). The real one has a `gain` command. */
export function rtkStatus(cfg = {}) {
  const bin = findRtk(cfg);
  if (!bin) return { installed: false };
  const ver = run(bin, ['--version']);
  const help = run(bin, ['--help']);
  const isReal = /\bgain\b/i.test(help.stdout + help.stderr);
  return { installed: true, bin, version: (ver.stdout || ver.stderr).trim().replace(/^rtk\s+/, ''), isReal, onPath: Boolean(which('rtk')) };
}

export function hookWired() {
  const s = readJson(path.join(claudeDir(), 'settings.json'), {});
  return /\brtk\b/.test(JSON.stringify(s.hooks ?? {}));
}

export function planInstall(platform = process.platform) {
  if (platform === 'win32') {
    return which('winget')
      ? { method: 'winget', cmd: 'winget', args: ['install', 'rtk-ai.rtk'] }
      : { method: 'manual', help: `Download the Windows zip from ${RTK_REPO}/releases and put rtk.exe on PATH.` };
  }
  if (which('brew')) return { method: 'brew', cmd: 'brew', args: ['install', 'rtk'] };
  if (which('curl')) return { method: 'script', cmd: 'sh', args: ['-c', `curl -fsSL ${RTK_INSTALL_SCRIPT} | sh`] };
  if (which('cargo')) return { method: 'cargo', cmd: 'cargo', args: ['install', '--git', RTK_REPO] };
  return { method: 'manual', help: `See ${RTK_REPO}#installation` };
}
export const describePlan = (p) => (p.cmd ? [p.cmd, ...p.args].join(' ') : p.help);

export function detectMethod(bin) {
  const recorded = loadState().rtkMethod;
  if (recorded) return recorded;
  if (!bin) return null;
  if (/cellar|homebrew|linuxbrew/i.test(bin)) return 'brew';
  if (/[\\/]\.cargo[\\/]/.test(bin)) return 'cargo';
  if (/winget|WindowsApps/i.test(bin)) return 'winget';
  return 'script';
}

export function planUpdate(bin) {
  const method = detectMethod(bin);
  const map = {
    brew: { cmd: 'brew', args: ['upgrade', 'rtk'] },
    cargo: { cmd: 'cargo', args: ['install', '--git', RTK_REPO, '--force'] },
    winget: { cmd: 'winget', args: ['upgrade', 'rtk-ai.rtk'] },
    script: { cmd: 'sh', args: ['-c', `curl -fsSL ${RTK_INSTALL_SCRIPT} | sh`] },
  };
  return { method, ...(map[method] ?? { help: `Reinstall rtk using the method in ${RTK_REPO}#installation` }) };
}

export const execPlan = (p) => (p.cmd ? runInherit(p.cmd, p.args) : 1);

/** `rtk init -g --auto-patch` (rtk's documented non-interactive hook install for Claude Code). */
export const initArgs = () => ['init', '-g', '--auto-patch'];

/**
 * `rtk gain --all --format json` -> { summary, daily[] }.
 * Schema verified against rtk source (src/analytics/gain.rs, ExportData/ExportSummary/DayStats).
 * Token counts are rtk's own estimates (bytes / 4). Numbers are machine-wide, not per project.
 */
export function readGain(cfg = {}) {
  const bin = findRtk(cfg);
  if (!bin) return null;
  const r = run(bin, ['gain', '--all', '--format', 'json']);
  if (r.status !== 0) return null;
  try {
    const j = JSON.parse(r.stdout);
    if (!j?.summary) return null;
    return { summary: j.summary, daily: Array.isArray(j.daily) ? j.daily : [] };
  } catch { return null; }
}

export async function latestVersion() {
  try {
    const res = await fetch('https://api.github.com/repos/rtk-ai/rtk/releases/latest', { signal: AbortSignal.timeout(5000), headers: { 'user-agent': 'tokemitsu' } });
    if (!res.ok) return null;
    return String((await res.json()).tag_name ?? '').replace(/^v/, '') || null;
  } catch { return null; }
}
