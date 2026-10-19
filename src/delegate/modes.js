import fs from 'node:fs';
import path from 'node:path';
import { runWorker } from './worker.js';
import { appendEvent } from '../ledger.js';
import { estimateTokens, numberLines } from '../util.js';

// Two "modes", following the pattern described by Spotify Engineering (see NOTICE.md).
// The prompts below are our own wording.

const BULK_READER = `You are a bulk reader for a coding agent that will NOT open the file itself.
Answer only what is asked, as a compact list. Start every item with the exact name, type, or line number (L<n> or L<a>-L<b>).
Quote code only when exact text matters, and keep quotes short. If something is not in the file, say so; never invent symbols or behaviour.
Do not add introductions, summaries, opinions, or advice about correctness.`;

const CODE_WRITER = `You are a code writer. Produce ONLY the requested code: no explanations, no markdown fences, no commentary.
Match the conventions of the reference files exactly (naming, structure, imports, test style, formatting).
Do not invent APIs that the references do not show; if something is ambiguous, follow the closest reference.`;

const workerEvent = (r) => ({ costUsd: r.costUsd, model: r.model, ...r.usage });

export function checkReadable(abs, cfg) {
  const st = fs.statSync(abs);
  if (!st.isFile()) throw new Error(`${abs} is not a file`);
  if (st.size > cfg.delegate.maxFileBytes) throw new Error(`${path.basename(abs)} is ${st.size} bytes (limit ${cfg.delegate.maxFileBytes}); read a range instead`);
  const buf = fs.readFileSync(abs);
  if (buf.subarray(0, 8000).includes(0)) throw new Error(`${path.basename(abs)} looks binary`);
  return buf.toString('utf8');
}

/** bulk-reader: answer a question about a big file without the main model loading it. */
export async function delegateRead({ file, question, cfg, env }) {
  const abs = path.resolve(cfg.cwd, file);
  const content = checkReadable(abs, cfg);
  const numbered = numberLines(content);
  const rel = path.relative(cfg.cwd, abs) || file;
  const r = await runWorker({ system: BULK_READER, prompt: `FILE: ${rel}\n\n${numbered}\n\nQUESTION: ${question}`, cfg, env });
  const before = estimateTokens(numbered); // what a whole-file Read would have put in context
  const kept = estimateTokens(r.text);
  appendEvent({
    lane: 'delegate', kind: 'measured', tool: 'read', project: cfg.cwd,
    avoidedIn: Math.max(0, before - kept), avoidedOut: 0, keptIn: kept,
    worker: workerEvent(r), latencyMs: r.latencyMs, meta: { file: rel, lines: content.split('\n').length, tokenizer: 'bytes/4' },
  });
  return { answer: r.text, tokensBefore: before, tokensAfter: kept, latencyMs: r.latencyMs, workerCostUsd: r.costUsd };
}

export function stripFences(text) {
  const m = /^\s*```[\w+-]*\n([\s\S]*?)\n```\s*$/.exec(text);
  return (m ? m[1] : text).replace(/\s+$/, '') + '\n';
}

function insideProject(cfg, abs) {
  const rel = path.relative(cfg.cwd, abs);
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/** code-writer: generate boilerplate matching reference files; optionally write straight to disk. */
export async function delegateWrite({ spec, refs, out, force = false, allowOutside = false, cfg, env }) {
  if (!refs?.length) throw new Error('at least one --like <reference file> is required');
  let outAbs = null;
  if (out) {
    outAbs = path.resolve(cfg.cwd, out);
    if (!allowOutside && !insideProject(cfg, outAbs)) throw new Error(`refusing to write outside the project (${out}); pass --allow-outside to override`);
    if (fs.existsSync(outAbs) && !force) throw new Error(`${out} already exists; pass --force to overwrite`);
  }
  const refText = refs.map((f) => {
    const abs = path.resolve(cfg.cwd, f);
    return `REFERENCE FILE: ${path.relative(cfg.cwd, abs) || f}\n${checkReadable(abs, cfg)}`;
  }).join('\n\n----\n\n');
  const r = await runWorker({ system: CODE_WRITER, prompt: `${refText}\n\n----\n\nSPEC:\n${spec}\n\nOutput only the code.`, cfg, env });
  const code = stripFences(r.text);
  const generated = estimateTokens(code);
  let shown = '';
  if (outAbs) {
    fs.mkdirSync(path.dirname(outAbs), { recursive: true });
    fs.writeFileSync(outAbs, code);
    shown = `wrote ${path.relative(cfg.cwd, outAbs)} (${code.split('\n').length - 1} lines)`;
  } else shown = code;
  const kept = estimateTokens(shown);
  appendEvent({
    lane: 'delegate', kind: 'estimated', tool: 'write', project: cfg.cwd,
    // baseline assumption: the main model would have generated this same code itself
    avoidedIn: 0, avoidedOut: Math.max(0, generated - (outAbs ? 0 : kept)), keptIn: kept,
    worker: workerEvent(r), latencyMs: r.latencyMs, meta: { out: out ?? null, refs, lines: code.split('\n').length - 1 },
  });
  return { output: shown, code, written: outAbs, latencyMs: r.latencyMs, workerCostUsd: r.costUsd };
}
