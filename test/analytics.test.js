import test from 'node:test';
import assert from 'node:assert/strict';
import { sandbox, writeLog, assistant } from './helpers.js';
import { computeReport } from '../src/analytics.js';
import { loadConfig } from '../src/config.js';
import { appendEvent } from '../src/ledger.js';

test('dedupes streamed duplicates and values spend at list price', async () => {
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
    assert.ok(Math.abs(r.totals.logsUsd - (1000 * 3 + 500 * 15) / 1e6) < 1e-9);
  } finally { s.cleanup(); }
});

test('net savings = gross avoided - worker; without = spent - worker + gross', async () => {
  const s = sandbox();
  try {
    const ts = new Date().toISOString();
    writeLog(s.claude, '/p/a', [assistant('/p/a', ts, 'm1', 'claude-sonnet-5-5', [100000, 1000])]);
    appendEvent({ lane: 'delegate', kind: 'measured', tool: 'read', project: '/p/a', avoidedIn: 50000, avoidedOut: 0, worker: { costUsd: 0.01 }, latencyMs: 1000, meta: {} });
    const gain = { summary: { total_saved: 200000, total_input: 250000, total_commands: 10 }, daily: [] };
    const r = await computeReport({ cfg: loadConfig(s.proj), gain });
    const t = r.totals;
    const gross = (200000 * 3 + 50000 * 3) / 1e6;
    assert.ok(Math.abs(t.netSavedUsd - (gross - 0.01)) < 1e-9);
    assert.ok(Math.abs(t.withoutUsd - (t.logsUsd + gross)) < 1e-9);
    assert.ok(Math.abs(t.spentUsd - (t.logsUsd + 0.01)) < 1e-9);
    assert.ok(t.modeled.netSavedUsd >= t.netSavedUsd, 'modeled is an upper bound');
    assert.equal(r.lanes.find((l) => l.id === 'rtk').kind, 'reported');
  } finally { s.cleanup(); }
});

test('GitNexus savings come from MCP tool results in the logs, marked estimated', async () => {
  const s = sandbox();
  try {
    const ts = new Date().toISOString();
    const big = 'x'.repeat(4000); // 1000 tokens
    writeLog(s.claude, '/p/a', [
      assistant('/p/a', ts, 'm1', 'claude-sonnet-5-5', [10, 10], [{ type: 'tool_use', id: 't1', name: 'mcp__gitnexus__context', input: {} }]),
      { type: 'user', cwd: '/p/a', timestamp: ts, message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: [{ type: 'text', text: big }] }] } },
    ]);
    const r = await computeReport({ cfg: loadConfig(s.proj), gain: null });
    const g = r.lanes.find((l) => l.id === 'graph');
    assert.equal(g.detail.calls, 1);
    assert.equal(g.avoidedTokens, 1000 * 2); // returned x (multiplier 3 - 1)
    assert.equal(g.kind, 'estimated');
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

test('pricing override file is honoured', async () => {
  const s = sandbox();
  try {
    const ts = new Date().toISOString();
    writeLog(s.claude, '/p/a', [assistant('/p/a', ts, 'm1', 'claude-sonnet-5-5', [1000000, 0])]);
    const r = await computeReport({ cfg: loadConfig(s.proj), gain: null, overrides: { sonnet: { in: 10 } } });
    assert.ok(Math.abs(r.totals.logsUsd - 10) < 1e-9);
  } finally { s.cleanup(); }
});
