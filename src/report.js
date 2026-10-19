import { fmtInt, fmtUsd, fmtPct } from './util.js';

const pad = (s, n) => String(s).padEnd(n);
const lpad = (s, n) => String(s).padStart(n);

export function formatReport(r) {
  const t = r.totals;
  const L = [];
  const win = [r.window.since ? `since ${r.window.since.slice(0, 10)}` : 'all time', r.window.project ? `project ${r.window.project}` : 'all projects'].join(', ');
  L.push(`tokemitsu - spent vs saved (${win})`, '');
  L.push(`  Without these tools   ${lpad(fmtUsd(t.withoutUsd), 10)}   what the same work would have cost`);
  L.push(`  What you spent        ${lpad(fmtUsd(t.spentUsd), 10)}   Claude Code ${fmtUsd(t.logsUsd)} + cheap worker ${fmtUsd(t.workerUsd)}`);
  L.push(`  You saved (net)       ${lpad(fmtUsd(t.netSavedUsd), 10)}   ${fmtPct(t.netSavedPct)} (conservative)`);
  L.push(`  Modeled upper bound   ${lpad(fmtUsd(t.modeled.netSavedUsd), 10)}   ${fmtPct(t.modeled.netSavedPct)} (counts re-reads across later turns)`, '');
  L.push(`  ${pad('Lane', 44)}${pad('Basis', 20)}${lpad('Tokens avoided', 16)}${lpad('Value', 10)}`);
  for (const l of r.lanes) {
    L.push(`  ${pad(l.name, 44)}${pad(l.available === false ? 'not available' : l.kind, 20)}${lpad(fmtInt(l.avoidedTokens), 16)}${lpad(fmtUsd(l.conservativeUsd), 10)}`);
  }
  const d = r.lanes.find((l) => l.id === 'delegate');
  if (d?.workerUsd) L.push(`  ${pad('  minus cheap-worker spend', 80)}${lpad('-' + fmtUsd(d.workerUsd), 10)}`);
  L.push('', `  Real usage in logs: ${fmtInt(t.messages)} responses, ${fmtInt(t.sessions)} sessions; tokens in/out/cache-write/cache-read = ${fmtInt(t.tokens.in)}/${fmtInt(t.tokens.out)}/${fmtInt(t.tokens.cw)}/${fmtInt(t.tokens.cr)}`);
  L.push('', 'How to read this:');
  for (const l of r.lanes) if (l.note) L.push(`  - ${l.name}: ${l.note}`);
  L.push(`  - ${r.assumptions.pricingNote}`, `  - Token counts for savings are bytes/4 estimates. ${r.assumptions.valuation}`);
  return L.join('\n');
}
