import test from 'node:test';
import assert from 'node:assert/strict';
import { sandbox, writeLog, assistant } from './helpers.js';
import { computeReport } from '../src/analytics.js';
import { loadConfig } from '../src/config.js';
import { appendEvent } from '../src/ledger.js';

test('dedupes streamed duplicates and reports only logged tokens, no dollar value', async () => {
  const s = sandbox();
  try {
    const ts = new Date().toISOString();
    writeLog(s.claude, '/p/a', [
      assistant('/p/a', ts, 'm1', 'claude-sonnet-5-5', [1000, 10]),
      assistant('/p/a', ts, 'm1', 'claude-sonnet-5-5', [1000, 500]), // same message, later block: keep max
    ]);
    const r = await computeReport({ cfg: loadConfig(s.proj), gain: null });
    assert.equal(r.totals.messages, 1);
    assert.equal(r.totals.tokens.out, 500);
    assert.equal(r.totals.tokens.in, 1000);
    assert.equal(r.totals.models['claude-sonnet-5-5'].responses, 1);
    const json = JSON.stringify(r);
    for (const w of ['logsUsd', 'spentUsd', 'withoutUsd', 'netSaved', 'modeled', 'conservative']) assert.ok(!json.includes(w), w);
  } finally { s.cleanup(); }
});

test('rtk lane is rtk-reported counters; delegation lane sums ledger worker figures', async () => {
  const s = sandbox();
  try {
    appendEvent({ lane: 'delegate', kind: 'measured', tool: 'read', project: '/p/a', worker: { costUsd: 0.01, in: 10, out: 5, cw: 0, cr: 0 }, latencyMs: 1000, meta: { lines: 120 } });
    appendEvent({ lane: 'delegate', kind: 'estimated', tool: 'write', project: '/p/a', worker: { costUsd: 0.02, in: 20, out: 8, cw: 0, cr: 0 }, latencyMs: 3000, meta: {} });
    const gain = { summary: { total_saved: 200000, total_input: 250000, total_commands: 10 }, daily: [] };
    const r = await computeReport({ cfg: loadConfig(s.proj), gain });
    const rtk = r.lanes.find((l) => l.id === 'rtk');
    assert.equal(rtk.kind, 'reported');
    assert.equal(rtk.metrics.savedTokens, 200000);
    const d = r.lanes.find((l) => l.id === 'delegate').metrics;
    assert.equal(d.calls, 2); assert.equal(d.reads, 1); assert.equal(d.writes, 1); assert.equal(d.linesRead, 120);
    assert.equal(d.workerTokens.in, 30);
    assert.ok(Math.abs(d.workerUsd - 0.03) < 1e-9);
    assert.ok(Math.abs(r.totals.workerUsd - 0.03) < 1e-9);
  } finally { s.cleanup(); }
});

test('GitNexus lane counts calls and returned bytes from the logs, with no savings figure', async () => {
  const s = sandbox();
  try {
    const ts = new Date().toISOString();
    const big = 'x'.repeat(4000);
    writeLog(s.claude, '/p/a', [
      assistant('/p/a', ts, 'm1', 'claude-sonnet-5-5', [10, 10], [{ type: 'tool_use', id: 't1', name: 'mcp__gitnexus__context', input: {} }]),
      { type: 'user', cwd: '/p/a', timestamp: ts, message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: [{ type: 'text', text: big }] }] } },
    ]);
    const r = await computeReport({ cfg: loadConfig(s.proj), gain: null });
    const g = r.lanes.find((l) => l.id === 'graph');
    assert.equal(g.metrics.calls, 1);
    assert.equal(g.metrics.resultBytes, 4000);
    assert.equal(g.metrics.byTool.context, 1);
    assert.equal(g.kind, 'measured');
    assert.equal(g.avoidedTokens, undefined);
  } finally { s.cleanup(); }
});

test('project filter limits logs and ledger but rtk note says machine-wide', async () => {
  const s = sandbox();
  try {
    const ts = new Date().toISOString();
    writeLog(s.claude, '/p/a', [assistant('/p/a', ts, 'm1', 'claude-sonnet-5-5', [1000, 10])]);
    const r = await computeReport({ cfg: loadConfig(s.proj), project: '/p/zzz', gain: { summary: { total_saved: 10, total_input: 20, total_commands: 1 }, daily: [] } });
    assert.equal(r.totals.messages, 0);
    assert.match(r.lanes.find((l) => l.id === 'rtk').note, /NOT limited/);
  } finally { s.cleanup(); }
});
