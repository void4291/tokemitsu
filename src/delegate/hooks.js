import fs from 'node:fs';
import path from 'node:path';
import { workerAvailable } from './worker.js';
import { loadConfig } from '../config.js';

const SKIP_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.pdf', '.ipynb', '.ico', '.zip', '.gz', '.mp4', '.mov', '.woff', '.woff2']);
const CAT_LIKE = /^\s*(?:cat|bat|less|more|nl)\s+(?:-[A-Za-z-]+\s+)*(?:"([^"]+)"|'([^']+)'|(\S+))\s*$/;
const HEAD_TAIL = /^\s*(?:head|tail)\s+(?:(?:-n\s*|-)(\d+)\s+)?(?:"([^"]+)"|'([^']+)'|(\S+))\s*$/;

export function countLines(buf) {
  let n = buf.length ? 1 : 0;
  for (const b of buf) if (b === 10) n++;
  return n;
}

/**
 * Pure PreToolUse decision (the two hooks Spotify describes: check-file-size for Read, check-bash-read for shell).
 * Blocks only whole-file reads of big text files. Targeted reads and pipelines pass. Fails open on anything unexpected.
 */
export function decidePreTool(event, cfg, env = process.env) {
  try {
    if (env.TOKEMITSU_IN_WORKER === '1' || env.TOKEMITSU_BYPASS === '1') return { decision: 'allow' };
    if (!workerAvailable(cfg)) return { decision: 'allow' };
    const cwd = event.cwd || cfg.cwd;
    const input = event.tool_input ?? {};
    const max = cfg.delegate.thresholdLines;
    let target = null;

    if (event.tool_name === 'Read') {
      if (input.offset != null) return { decision: 'allow' };
      if (input.limit != null && Number(input.limit) <= max) return { decision: 'allow' };
      target = input.file_path;
    } else if (event.tool_name === 'Bash') {
      const cmd = String(input.command ?? '');
      const m = CAT_LIKE.exec(cmd);
      if (m) target = m[1] ?? m[2] ?? m[3];
      else {
        const h = HEAD_TAIL.exec(cmd);
        if (h?.[1] && Number(h[1]) > max) target = h[2] ?? h[3] ?? h[4];
      }
    }
    if (!target) return { decision: 'allow' };

    const abs = path.resolve(cwd, target);
    if (SKIP_EXT.has(path.extname(abs).toLowerCase())) return { decision: 'allow' };
    const st = fs.statSync(abs, { throwIfNoEntry: false });
    if (!st?.isFile() || st.size > cfg.delegate.maxFileBytes) return { decision: 'allow' };
    const buf = fs.readFileSync(abs);
    if (buf.subarray(0, 8000).includes(0)) return { decision: 'allow' };
    const lines = countLines(buf);
    if (lines <= max) return { decision: 'allow' };

    const rel = path.relative(cwd, abs) || target;
    return {
      decision: 'deny',
      reason:
        `${rel} has ${lines} lines (limit ${max}); reading it whole would flood your context. ` +
        `Ask a cheaper model: tokemitsu delegate read "${rel}" --ask "<specific question>". ` +
        `Or Read a range with offset/limit. To edit, Read only the section you will change.`,
    };
  } catch {
    return { decision: 'allow' };
  }
}

export async function runHook(stdinText, { env = process.env, out = process.stdout } = {}) {
  let event;
  try { event = JSON.parse(stdinText); } catch { return 0; }
  const cfg = loadConfig(event.cwd || env.CLAUDE_PROJECT_DIR || process.cwd(), env);
  const d = decidePreTool(event, cfg, env);
  if (d.decision === 'deny') {
    out.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: d.reason } }) + '\n');
  }
  return 0;
}
