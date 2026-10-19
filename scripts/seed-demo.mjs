#!/usr/bin/env node
// Builds a SYNTHETIC environment (fake Claude Code logs, ledger and rtk) so you can preview the dashboard
// without any real data:   node scripts/seed-demo.mjs /tmp/tk-demo && follow the printed command.
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.argv[2] || './tk-demo');
const home = path.join(root, 'tokemitsu'), claude = path.join(root, 'claude'), bin = path.join(root, 'bin');
for (const d of [home, claude, bin]) fs.mkdirSync(d, { recursive: true });
let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

const lines = [], ledger = [], daily = [];
const proj = '/demo/shop-api';
for (let i = 29; i >= 0; i--) {
  const d = new Date(Date.now() - i * 86400e3);
  const day = d.toISOString().slice(0, 10);
  const turns = 20 + Math.floor(rnd() * 60);
  for (let t = 0; t < turns; t++) {
    const ts = new Date(d.getTime() - t * 60e3).toISOString();
    const id = `m${i}_${t}`;
    const content = [];
    if (rnd() < 0.15) content.push({ type: 'tool_use', id: 'g' + id, name: 'mcp__gitnexus__context', input: {} });
    lines.push({ type: 'assistant', cwd: proj, sessionId: 's' + i, timestamp: ts, requestId: 'r' + id, message: { id, model: 'claude-sonnet-5-5', usage: { input_tokens: 800 + Math.floor(rnd() * 2000), output_tokens: 200 + Math.floor(rnd() * 900), cache_creation_input_tokens: Math.floor(rnd() * 4000), cache_read_input_tokens: 20000 + Math.floor(rnd() * 60000) }, content } });
    if (content.length) lines.push({ type: 'user', cwd: proj, timestamp: ts, message: { content: [{ type: 'tool_result', tool_use_id: 'g' + id, content: 'x'.repeat(2000 + Math.floor(rnd() * 6000)) }] } });
  }
  const cmds = 30 + Math.floor(rnd() * 80), input = cmds * (1500 + Math.floor(rnd() * 2500)), saved = Math.floor(input * 0.78);
  daily.push({ date: day, commands: cmds, input_tokens: input, output_tokens: input - saved, saved_tokens: saved, savings_pct: 78, total_time_ms: 1 });
  if (i < 12) for (let k = 0; k < 1 + Math.floor(rnd() * 4); k++) {
    const write = rnd() < 0.3, tok = 4000 + Math.floor(rnd() * 20000);
    ledger.push({ v: 1, ts: new Date(d.getTime() + k * 600e3).toISOString(), lane: 'delegate', kind: write ? 'estimated' : 'measured', tool: write ? 'write' : 'read', project: proj,
      avoidedIn: write ? 0 : tok, avoidedOut: write ? Math.floor(tok / 6) : 0, keptIn: 300, worker: { costUsd: 0.002 + rnd() * 0.01, model: 'claude-haiku-4-5' }, latencyMs: 3000 + Math.floor(rnd() * 9000), meta: { file: write ? undefined : 'src/orders/OrderService.ts', out: write ? 'test/orders.test.ts' : undefined } });
  }
}
const pdir = path.join(claude, 'projects', 'demo'); fs.mkdirSync(pdir, { recursive: true });
fs.writeFileSync(path.join(pdir, 's.jsonl'), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
fs.writeFileSync(path.join(home, 'ledger.jsonl'), ledger.map((l) => JSON.stringify(l)).join('\n') + '\n');
const total = (k) => daily.reduce((s, r) => s + r[k], 0);
const gain = { summary: { total_commands: total('commands'), total_input: total('input_tokens'), total_output: total('output_tokens'), total_saved: total('saved_tokens'), avg_savings_pct: 78 }, daily };
fs.writeFileSync(path.join(bin, 'rtk'), `#!/usr/bin/env node\nconst a=process.argv.slice(2);if(a[0]==='--version')console.log('rtk 0.0.0-demo');else if(a[0]==='--help')console.log('gain');else if(a[0]==='gain')console.log(JSON.stringify(${JSON.stringify(gain)}));\n`, { mode: 0o755 });
console.log(`Synthetic demo data written to ${root}\n\nPreview it:\n  TOKEMITSU_HOME=${home} CLAUDE_CONFIG_DIR=${claude} PATH=${bin}:$PATH tokemitsu dashboard`);
