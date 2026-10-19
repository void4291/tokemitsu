import { scanClaudeLogs } from './claudelogs.js';
import { readEvents } from './ledger.js';
import { readGain } from './tools/rtk.js';
import { priceFor, usd } from './pricing.js';
import { dayOf, pct } from './util.js';

/**
 * Spent-vs-saved model.
 *   spent    = real usage from Claude Code logs (list-price valued) + cheap-worker spend
 *   without  = (spent - worker) + gross avoided   <- what the same work would have cost with no tool
 *   net      = without - spent = gross avoided - worker
 * Two valuations of avoided tokens:
 *   conservative: avoided tokens x price once (the minimum they would have cost)
 *   modeled     : also counts that tokens in context are re-read (cache) on later turns, capped by carry-over turns
 * Honesty labels per lane: measured | reported | estimated.
 */
const valueIn = (t, p) => usd(t, p.in);
const valueOut = (t, p) => usd(t, p.out);
const modeledIn = (t, p, carry) => usd(t, p.cw + carry * p.cr);
const modeledOut = (t, p, carry) => usd(t, p.out + p.cw + carry * p.cr);

export async function computeReport({ since = null, project = null, cfg, logsDir, ledgerFile, gain, overrides } = {}) {
  const logs = await scanClaudeLogs({ since, project, dir: logsDir });
  const events = readEvents({ since, project, file: ledgerFile });
  const carry = Math.min(cfg.analytics.carryTurnsCap, Math.round(logs.meanRemainingTurns));
  const mult = cfg.graph.estimatedExplorationMultiplier;

  // price per day = that day's dominant model by output+input volume
  const perDayModel = {};
  const overall = {};
  for (const m of logs.messages) {
    const d = dayOf(m.ts);
    const w = m.in + m.out + m.cw + m.cr;
    (perDayModel[d] ??= {})[m.model] = ((perDayModel[d] ??= {})[m.model] ?? 0) + w;
    overall[m.model] = (overall[m.model] ?? 0) + w;
  }
  const top = (o) => Object.entries(o).sort((a, b) => b[1] - a[1])[0]?.[0];
  const overallModel = top(overall) ?? 'sonnet';
  const priceDay = (d) => priceFor(top(perDayModel[d] ?? {}) ?? overallModel, overrides);
  const priceOverall = priceFor(overallModel, overrides);

  const days = {};
  const day = (d) => (days[d] ??= { day: d, spentUsd: 0, grossUsd: 0, workerUsd: 0 });
  const tokens = { in: 0, out: 0, cw: 0, cr: 0 };
  let logsUsd = 0;
  const modelUsd = {};
  for (const m of logs.messages) {
    const p = priceFor(m.model, overrides);
    const c = usd(m.in, p.in) + usd(m.out, p.out) + usd(m.cw, p.cw) + usd(m.cr, p.cr);
    logsUsd += c; day(dayOf(m.ts)).spentUsd += c;
    modelUsd[m.model] = (modelUsd[m.model] ?? 0) + c;
    tokens.in += m.in; tokens.out += m.out; tokens.cw += m.cw; tokens.cr += m.cr;
  }

  const lanes = [];

  // --- rtk (reported by rtk itself; machine-wide, not per-project)
  const g = gain === undefined ? readGain(cfg) : gain;
  if (g) {
    let saved = 0, cmds = 0, input = 0, conservative = 0, modeled = 0;
    const rows = since && g.daily.length ? g.daily.filter((r) => Date.parse(r.date) >= since - 86400e3) : null;
    if (rows) for (const r of rows) {
      const p = priceDay(r.date);
      saved += r.saved_tokens; cmds += r.commands; input += r.input_tokens;
      conservative += valueIn(r.saved_tokens, p); modeled += modeledIn(r.saved_tokens, p, carry);
      day(r.date).grossUsd += valueIn(r.saved_tokens, p);
    } else {
      saved = g.summary.total_saved; cmds = g.summary.total_commands; input = g.summary.total_input;
      conservative = valueIn(saved, priceOverall); modeled = modeledIn(saved, priceOverall, carry);
    }
    lanes.push({
      id: 'rtk', name: 'rtk - shell output compression', kind: 'reported', avoidedTokens: saved, conservativeUsd: conservative, modeledUsd: modeled,
      detail: { commands: cmds, rawTokens: input, reductionPct: pct(saved, input) },
      note: 'Counted by rtk itself (bytes/4). Covers all projects on this machine' + (project ? ', so it is NOT limited to --project.' : '.'),
    });
  } else lanes.push({ id: 'rtk', name: 'rtk - shell output compression', kind: 'reported', available: false, avoidedTokens: 0, conservativeUsd: 0, modeledUsd: 0, note: 'rtk not installed or no data yet. Run: tokemitsu setup' });

  // --- GitNexus (estimated from MCP result size seen in Claude Code logs)
  {
    let ret = 0, avoided = 0, conservative = 0, modeled = 0;
    const byTool = {};
    for (const c of logs.gnCalls) {
      const a = c.tokens * (mult - 1), p = priceDay(dayOf(c.ts));
      ret += c.tokens; avoided += a;
      conservative += valueIn(a, p); modeled += modeledIn(a, p, carry);
      day(dayOf(c.ts)).grossUsd += valueIn(a, p);
      byTool[c.tool] = (byTool[c.tool] ?? 0) + 1;
    }
    lanes.push({
      id: 'graph', name: 'GitNexus - code knowledge graph', kind: 'estimated', avoidedTokens: Math.round(avoided), conservativeUsd: conservative, modeledUsd: modeled,
      detail: { calls: logs.gnCalls.length, returnedTokens: ret, multiplier: mult, byTool },
      note: `Estimate: each answer is assumed to replace ${mult}x its size in grep/read exploration. Calibrate with "tokemitsu graph-bench <symbol>".`,
    });
  }

  // --- delegation (ledger)
  {
    const dl = events.filter((e) => e.lane === 'delegate');
    let aIn = 0, aOut = 0, conservative = 0, modeled = 0, worker = 0, lat = 0;
    const wTok = { in: 0, out: 0, cw: 0, cr: 0 };
    let reads = 0, writes = 0;
    for (const e of dl) {
      const p = priceDay(dayOf(e.ts));
      aIn += e.avoidedIn ?? 0; aOut += e.avoidedOut ?? 0;
      const gross = valueIn(e.avoidedIn ?? 0, p) + valueOut(e.avoidedOut ?? 0, p);
      conservative += gross;
      modeled += modeledIn(e.avoidedIn ?? 0, p, carry) + modeledOut(e.avoidedOut ?? 0, p, carry);
      day(dayOf(e.ts)).grossUsd += gross;
      const w = e.worker?.costUsd ?? 0; worker += w; day(dayOf(e.ts)).workerUsd += w; day(dayOf(e.ts)).spentUsd += w;
      for (const k of ['in', 'out', 'cw', 'cr']) wTok[k] += e.worker?.[k] ?? 0;
      lat += e.latencyMs ?? 0;
      if (e.tool === 'read') reads++; else if (e.tool === 'write') writes++;
    }
    lanes.push({
      id: 'delegate', name: 'Cheap-model delegation (Spotify pattern)', kind: dl.some((e) => e.kind === 'estimated') ? 'measured+estimated' : 'measured',
      avoidedTokens: aIn + aOut, conservativeUsd: conservative, modeledUsd: modeled, workerUsd: worker,
      detail: { events: dl.length, reads, writes, avoidedIn: aIn, avoidedOut: aOut, workerTokens: wTok, avgLatencyMs: dl.length ? Math.round(lat / dl.length) : 0 },
      note: 'Reads: measured (whole-file tokens minus the answer kept). Writes: estimated (assumes the main model would have generated the same code). Worker spend is real and subtracted.',
    });
  }

  const gross = lanes.reduce((s, l) => s + l.conservativeUsd, 0);
  const grossModeled = lanes.reduce((s, l) => s + l.modeledUsd, 0);
  const workerUsd = lanes.find((l) => l.id === 'delegate').workerUsd;
  const spentUsd = logsUsd + workerUsd;
  const withoutUsd = logsUsd + gross;
  const netUsd = gross - workerUsd;
  const withoutModeled = logsUsd + grossModeled;
  const netModeled = grossModeled - workerUsd;

  return {
    generatedAt: new Date().toISOString(),
    window: { since: since ? new Date(since).toISOString() : null, project },
    totals: {
      spentUsd, logsUsd, workerUsd, withoutUsd, netSavedUsd: netUsd, netSavedPct: pct(netUsd, withoutUsd),
      modeled: { withoutUsd: withoutModeled, netSavedUsd: netModeled, netSavedPct: pct(netModeled, withoutModeled) },
      avoidedTokens: lanes.reduce((s, l) => s + l.avoidedTokens, 0),
      tokens, messages: logs.messages.length, sessions: logs.sessions, models: modelUsd,
    },
    lanes,
    daily: Object.values(days).sort((a, b) => a.day.localeCompare(b.day)).map((d) => ({
      ...d, withoutUsd: d.spentUsd - d.workerUsd + d.grossUsd,
    })),
    assumptions: {
      pricing: priceOverall, pricingNote: 'List-price assumptions by model family (override in ~/.tokemitsu/pricing.json). On a subscription this is API-equivalent value, not your bill.',
      tokenizer: 'bytes/4', carryTurns: carry, explorationMultiplier: mult,
      valuation: 'Headline = conservative (avoided tokens priced once). "modeled" adds re-read/cache carry-over across remaining turns.',
    },
  };
}
