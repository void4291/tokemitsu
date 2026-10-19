import { scanClaudeLogs } from './claudelogs.js';
import { readEvents } from './ledger.js';
import { readGain } from './tools/rtk.js';
import { dayOf, pct } from './util.js';

/**
 * Usage report. Only counters that something actually recorded; nothing is priced or extrapolated.
 *   Claude Code : token counts from its own session logs (deduped per response)
 *   rtk         : counters reported by rtk itself (machine-wide)
 *   GitNexus    : number and size of GitNexus MCP results seen in the Claude Code logs
 *   delegation  : this tool's ledger of delegated calls; worker tokens and cost are what the Claude CLI reported
 * No dollar value is computed for Claude Code usage (a subscription has no per-token bill). The only dollar
 * figure is the cost the Claude CLI itself reported for cheap-worker calls.
 */
export async function computeReport({ since = null, project = null, cfg, logsDir, ledgerFile, gain } = {}) {
  const logs = await scanClaudeLogs({ since, project, dir: logsDir });
  const events = readEvents({ since, project, file: ledgerFile });

  const tokens = { in: 0, out: 0, cw: 0, cr: 0 };
  const models = {};
  const days = {};
  const day = (d) => (days[d] ??= { day: d, in: 0, out: 0, cw: 0, cr: 0, workerUsd: 0 });
  for (const m of logs.messages) {
    for (const k of ['in', 'out', 'cw', 'cr']) { tokens[k] += m[k]; day(dayOf(m.ts))[k] += m[k]; }
    const mm = (models[m.model] ??= { responses: 0, in: 0, out: 0, cw: 0, cr: 0 });
    mm.responses++;
    for (const k of ['in', 'out', 'cw', 'cr']) mm[k] += m[k];
  }

  const lanes = [];

  // --- rtk (counted by rtk itself; machine-wide, not per-project)
  const g = gain === undefined ? readGain(cfg) : gain;
  if (g) {
    let saved = 0, commands = 0, raw = 0;
    const rows = since && g.daily.length ? g.daily.filter((r) => Date.parse(r.date) >= since - 86400e3) : null;
    if (rows) for (const r of rows) { saved += r.saved_tokens; commands += r.commands; raw += r.input_tokens; }
    else { saved = g.summary.total_saved; commands = g.summary.total_commands; raw = g.summary.total_input; }
    lanes.push({
      id: 'rtk', name: 'rtk - shell output compression', kind: 'reported',
      metrics: { commands, rawTokens: raw, savedTokens: saved, reductionPct: pct(saved, raw) },
      note: 'Counted by rtk itself (its own bytes/4 token estimate). Covers all projects on this machine' + (project ? ', so it is NOT limited to --project.' : '.'),
    });
  } else lanes.push({ id: 'rtk', name: 'rtk - shell output compression', kind: 'reported', available: false, metrics: {}, note: 'rtk not installed or no data yet. Run: tokemitsu setup' });

  // --- GitNexus (what was actually returned to Claude Code)
  {
    const byTool = {};
    let bytes = 0;
    for (const c of logs.gnCalls) { bytes += c.bytes; byTool[c.tool] = (byTool[c.tool] ?? 0) + 1; }
    lanes.push({
      id: 'graph', name: 'GitNexus - code knowledge graph', kind: 'measured',
      metrics: { calls: logs.gnCalls.length, resultBytes: bytes, byTool },
      note: 'Calls and result sizes seen in your Claude Code logs. What they replaced is not estimated here; use "tokemitsu graph-bench <symbol>" for a comparison on one symbol.',
    });
  }

  // --- delegation (ledger)
  {
    const dl = events.filter((e) => e.lane === 'delegate');
    const w = { in: 0, out: 0, cw: 0, cr: 0 };
    let workerUsd = 0, latency = 0, reads = 0, writes = 0, linesRead = 0;
    for (const e of dl) {
      const c = e.worker?.costUsd ?? 0;
      workerUsd += c; day(dayOf(e.ts)).workerUsd += c;
      for (const k of ['in', 'out', 'cw', 'cr']) w[k] += e.worker?.[k] ?? 0;
      latency += e.latencyMs ?? 0;
      if (e.tool === 'read') { reads++; linesRead += e.meta?.lines ?? 0; } else if (e.tool === 'write') writes++;
    }
    lanes.push({
      id: 'delegate', name: 'Cheap-model delegation (Spotify pattern)', kind: 'measured',
      metrics: { calls: dl.length, reads, writes, linesRead, workerTokens: w, workerUsd, avgLatencyMs: dl.length ? Math.round(latency / dl.length) : 0 },
      note: 'Worker tokens and cost are as reported by the Claude CLI for each call. Nothing is assumed about what the main model would have done instead.',
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    window: { since: since ? new Date(since).toISOString() : null, project },
    totals: { tokens, messages: logs.messages.length, sessions: logs.sessions, models, workerUsd: lanes.find((l) => l.id === 'delegate').metrics.workerUsd },
    lanes,
    daily: Object.values(days).sort((a, b) => a.day.localeCompare(b.day)),
    notes: [
      'Claude Code token counts come from its own logs. Input = uncached input, cache writes = context stored for reuse, cache reads = re-reads of already-cached context (usually the largest number and the cheapest per token).',
      'No dollar value is shown for Claude Code usage: on a subscription you are not billed per token, and any price would be an assumption.',
    ],
  };
}
