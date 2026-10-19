import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { which } from '../util.js';

/**
 * Cheap-model worker = a locked-down headless Claude Code call. No API key handling here:
 * it uses whatever login Claude Code already has. Deliberately NOT `--bare` (bare mode only
 * accepts ANTHROPIC_API_KEY and ignores OAuth/subscription logins).
 *
 * Isolation: no tools, no slash commands/skills, no MCP, no session file, user settings only,
 * a neutral working directory (so no project CLAUDE.md), and TOKEMITSU_IN_WORKER=1 so our own hooks stand down.
 */
export function workerArgs({ model, system }) {
  return [
    '-p', '--model', model, '--output-format', 'json',
    '--tools', '', '--disable-slash-commands', '--strict-mcp-config',
    '--no-session-persistence', '--setting-sources', 'user',
    '--system-prompt', system,
  ];
}

export function workerAvailable(cfg) {
  return Boolean(which(cfg.claude.bin));
}

/** Returns { text, costUsd, model, usage:{in,out,cw,cr}, latencyMs }. Throws a readable Error on any failure. */
export async function runWorker({ system, prompt, cfg, env = process.env }) {
  const bin = which(cfg.claude.bin);
  if (!bin) throw new Error(`Claude Code CLI ("${cfg.claude.bin}") not found on PATH`);
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'tk-worker-'));
  const t0 = Date.now();
  try {
    const out = await new Promise((resolve, reject) => {
      const child = spawn(bin, workerArgs({ model: cfg.delegate.model, system }), {
        cwd, env: { ...env, TOKEMITSU_IN_WORKER: '1' }, stdio: ['pipe', 'pipe', 'pipe'],
      });
      let stdout = '', stderr = '';
      const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`worker timed out after ${cfg.delegate.timeoutSec}s`)); }, cfg.delegate.timeoutSec * 1000);
      child.stdout.on('data', (d) => (stdout += d));
      child.stderr.on('data', (d) => (stderr += d));
      child.on('error', (e) => { clearTimeout(timer); reject(e); });
      child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
      child.stdin.on('error', () => { /* worker exited early; surfaced via close */ });
      child.stdin.end(prompt);
    });
    let j;
    try { j = JSON.parse(out.stdout); } catch {
      throw new Error(`worker returned non-JSON output (exit ${out.code}): ${(out.stdout || out.stderr).slice(0, 300)}`);
    }
    if (j.is_error) throw new Error(`worker error: ${String(j.result ?? 'unknown').slice(0, 300)}`);
    const text = String(j.result ?? '');
    if (!text.trim()) throw new Error('worker returned an empty answer');
    const u = j.usage ?? {};
    return {
      text,
      costUsd: Number(j.total_cost_usd) || 0,
      model: Object.keys(j.modelUsage ?? {})[0] ?? cfg.delegate.model,
      usage: { in: u.input_tokens ?? 0, out: u.output_tokens ?? 0, cw: u.cache_creation_input_tokens ?? 0, cr: u.cache_read_input_tokens ?? 0 },
      latencyMs: Date.now() - t0,
    };
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
}
