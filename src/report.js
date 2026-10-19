import { fmtInt, fmtUsd } from './util.js';

const pad = (s, n) => String(s).padEnd(n);
const lpad = (s, n) => String(s).padStart(n);

export function formatReport(r) {
  const t = r.totals, tk = t.tokens;
  const L = [];
  const win = [r.window.since ? `since ${r.window.since.slice(0, 10)}` : 'all time', r.window.project ? `project ${r.window.project}` : 'all projects'].join(', ');
  L.push(`tokemitsu - usage (${win})`, '');
  L.push('  Claude Code (from its session logs)');
  L.push(`    Responses            ${lpad(fmtInt(t.messages), 14)}   in ${fmtInt(t.sessions)} sessions`);
  L.push(`    Input (uncached)     ${lpad(fmtInt(tk.in), 14)}`);
  L.push(`    Output               ${lpad(fmtInt(tk.out), 14)}`);
  L.push(`    Cache writes         ${lpad(fmtInt(tk.cw), 14)}`);
  L.push(`    Cache reads          ${lpad(fmtInt(tk.cr), 14)}`);
  const models = Object.entries(t.models);
  if (models.length) {
    L.push('', `    ${pad('Model', 28)}${lpad('Responses', 11)}${lpad('Output tok', 14)}`);
    for (const [name, m] of models) L.push(`    ${pad(name, 28)}${lpad(fmtInt(m.responses), 11)}${lpad(fmtInt(m.out), 14)}`);
  }
  L.push('', '  Tools');
  for (const l of r.lanes) {
    const m = l.metrics;
    L.push(`    ${l.name}  [${l.available === false ? 'not available' : l.kind}]`);
    if (l.id === 'rtk' && l.available !== false) L.push(`      ${fmtInt(m.commands)} commands, ${fmtInt(m.rawTokens)} raw tokens, rtk reports ${fmtInt(m.savedTokens)} saved (${m.reductionPct.toFixed(1)}%)`);
    if (l.id === 'graph') L.push(`      ${fmtInt(m.calls)} calls, ${fmtInt(m.resultBytes)} bytes returned` + (m.calls ? ` (${Object.entries(m.byTool).map(([k, v]) => `${k} ${v}`).join(', ')})` : ''));
    if (l.id === 'delegate') {
      L.push(`      ${fmtInt(m.calls)} calls (${m.reads} read, ${m.writes} write), ${fmtInt(m.linesRead)} lines read by the worker, avg ${(m.avgLatencyMs / 1000).toFixed(1)}s`);
      if (m.calls) L.push(`      worker tokens in/out/cache-write/cache-read = ${fmtInt(m.workerTokens.in)}/${fmtInt(m.workerTokens.out)}/${fmtInt(m.workerTokens.cw)}/${fmtInt(m.workerTokens.cr)}; cost reported by Claude CLI ${fmtUsd(m.workerUsd)}`);
    }
  }
  L.push('', 'How to read this:');
  for (const l of r.lanes) if (l.note) L.push(`  - ${l.name}: ${l.note}`);
  for (const n of r.notes) L.push(`  - ${n}`);
  return L.join('\n');
}
