import fs from 'node:fs';
import path from 'node:path';
import { ledgerPath } from './paths.js';

/**
 * Append-only JSONL of delegation events. Schema v1:
 * { v, ts, lane, kind, tool, project, avoidedIn, avoidedOut, keptIn, worker:{costUsd,model,in,out,cw,cr}, latencyMs, meta }
 * kind: measured | estimated | reported
 */
export function appendEvent(ev, file = ledgerPath()) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const rec = { v: 1, ts: new Date().toISOString(), ...ev };
  fs.appendFileSync(file, JSON.stringify(rec) + '\n');
  return rec;
}
export function readEvents({ since = null, project = null, file = ledgerPath() } = {}) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch { return []; }
  const out = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line);
      if (since && Date.parse(e.ts) < since) continue;
      if (project && e.project !== project) continue;
      out.push(e);
    } catch { /* skip corrupt line */ }
  }
  return out;
}
