import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { projectsDir } from './paths.js';

/**
 * Reads Claude Code's own session logs (~/.claude/projects/**.jsonl) - local, read-only.
 * Extracts: (1) real token usage per day/model, deduped by message.id+requestId (a response is
 * logged once per content block, so we keep the per-field max); (2) GitNexus MCP tool results
 * (their size is what lands in context).
 */
function listJsonl(dir) {
  const out = [];
  const walk = (d) => {
    let ents;
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.jsonl')) out.push(p);
    }
  };
  walk(dir);
  return out;
}

const toolResultText = (c) => {
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map((b) => (typeof b === 'string' ? b : b?.text ?? '')).join('\n');
  return '';
};

export async function scanClaudeLogs({ since = null, project = null, dir = projectsDir() } = {}) {
  const msgs = new Map();        // key -> {ts, model, in, out, cw, cr, session}
  const gnCalls = [];            // {ts, tool, bytes, project}
  const sessions = new Map();    // session -> Set(msg keys)
  let files = 0;

  for (const file of listJsonl(dir)) {
    if (since) {
      try { if (fs.statSync(file).mtimeMs < since) continue; } catch { continue; }
    }
    files++;
    const pendingGn = new Map(); // tool_use_id -> {tool, ts, project}
    const rl = readline.createInterface({ input: fs.createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
    for await (const line of rl) {
      const hasUsage = line.includes('"usage"');
      const hasGn = line.includes('mcp__gitnexus__') || line.includes('"tool_result"');
      if (!hasUsage && !hasGn) continue;
      let o;
      try { o = JSON.parse(line); } catch { continue; }
      const ts = Date.parse(o.timestamp);
      if (since && ts < since) continue;
      if (project && !(o.cwd && (o.cwd === project || o.cwd.startsWith(project + path.sep)))) continue;

      if (o.type === 'assistant' && o.message) {
        const m = o.message;
        const u = m.usage;
        const session = o.sessionId ?? path.basename(file);
        if (u && m.id && m.model && m.model !== '<synthetic>') {
          const key = `${m.id}:${o.requestId ?? ''}`;
          const cur = msgs.get(key) ?? { ts, model: m.model, in: 0, out: 0, cw: 0, cr: 0, session };
          cur.in = Math.max(cur.in, u.input_tokens ?? 0);
          cur.out = Math.max(cur.out, u.output_tokens ?? 0);
          cur.cw = Math.max(cur.cw, u.cache_creation_input_tokens ?? 0);
          cur.cr = Math.max(cur.cr, u.cache_read_input_tokens ?? 0);
          msgs.set(key, cur);
          if (!sessions.has(session)) sessions.set(session, new Set());
          sessions.get(session).add(key);
        }
        for (const b of Array.isArray(m.content) ? m.content : []) {
          if (b?.type === 'tool_use' && typeof b.name === 'string' && b.name.startsWith('mcp__gitnexus__')) {
            pendingGn.set(b.id, { tool: b.name.slice('mcp__gitnexus__'.length), ts, project: o.cwd ?? null });
          }
        }
      } else if (o.type === 'user' && Array.isArray(o.message?.content)) {
        for (const b of o.message.content) {
          if (b?.type !== 'tool_result') continue;
          const p = pendingGn.get(b.tool_use_id);
          if (!p) continue;
          pendingGn.delete(b.tool_use_id);
          gnCalls.push({ ...p, bytes: Buffer.byteLength(toolResultText(b.content)) });
        }
      }
    }
  }

  return { messages: [...msgs.values()], gnCalls, files, sessions: sessions.size };
}
