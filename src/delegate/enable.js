import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readJson, writeJson, which } from '../util.js';
import { claudeDir } from '../paths.js';
import { SKILL_MD } from './skill.js';

const OURS = /tokemitsu(?:\.js)?"?\s+hook\s+pre-tool/;
export const binPath = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..', 'bin', 'tokemitsu.js');

export const hookCommand = () => (which('tokemitsu') ? 'tokemitsu' : `node "${binPath}"`);
export const settingsFile = ({ global, cwd }) => (global ? path.join(claudeDir(), 'settings.json') : path.join(cwd, '.claude', 'settings.local.json'));
export const skillFile = ({ global, cwd }) => path.join(global ? path.join(claudeDir(), 'skills') : path.join(cwd, '.claude', 'skills'), 'tokemitsu-delegate', 'SKILL.md');

/** Idempotent: removes earlier tokemitsu hooks, keeps everything else, then adds ours when `enable`. */
export function mergeHooks(settings, cmd, enable) {
  const out = structuredClone(settings ?? {});
  out.hooks ??= {};
  for (const ev of Object.keys(out.hooks)) {
    out.hooks[ev] = (out.hooks[ev] ?? [])
      .map((g) => ({ ...g, hooks: (g.hooks ?? []).filter((h) => !OURS.test(h.command ?? '')) }))
      .filter((g) => g.hooks.length);
  }
  if (enable) {
    out.hooks.PreToolUse = [
      ...(out.hooks.PreToolUse ?? []),
      ...['Read', 'Bash'].map((matcher) => ({ matcher, hooks: [{ type: 'command', command: `${cmd} hook pre-tool`, timeout: 10 }] })),
    ];
  }
  for (const ev of Object.keys(out.hooks)) if (!out.hooks[ev].length) delete out.hooks[ev];
  if (!Object.keys(out.hooks).length) delete out.hooks;
  return out;
}

export function enable({ global = false, cwd, dryRun = false }) {
  const sf = settingsFile({ global, cwd });
  const next = mergeHooks(readJson(sf, {}), hookCommand(), true);
  const kf = skillFile({ global, cwd });
  if (!dryRun) {
    writeJson(sf, next);
    fs.mkdirSync(path.dirname(kf), { recursive: true });
    fs.writeFileSync(kf, SKILL_MD);
  }
  return { settings: sf, skill: kf };
}
export function disable({ global = false, cwd, dryRun = false }) {
  const sf = settingsFile({ global, cwd });
  const kf = skillFile({ global, cwd });
  if (!dryRun) {
    if (fs.existsSync(sf)) writeJson(sf, mergeHooks(readJson(sf, {}), '', false));
    fs.rmSync(path.dirname(kf), { recursive: true, force: true });
  }
  return { settings: sf, skill: kf };
}
export function enabledAt(cwd) {
  const hit = [];
  for (const global of [false, true]) {
    const s = readJson(settingsFile({ global, cwd }), {});
    if (Object.values(s.hooks ?? {}).flat().some((g) => (g.hooks ?? []).some((h) => OURS.test(h.command ?? '')))) hit.push(global ? 'global' : 'project');
  }
  return hit;
}
