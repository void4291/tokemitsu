import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import { sandbox, shim, fakeClaude, writeLog, assistant } from './helpers.js';
import { loadConfig } from '../src/config.js';
import { verify, summarize } from '../src/verify.js';
import { setup } from '../src/setup.js';
import { createServer, listen } from '../src/dashboard/server.js';

const BIN = path.resolve('bin/tokemitsu.js');
const GAIN = { summary: { total_commands: 40, total_input: 100000, total_output: 20000, total_saved: 80000, avg_savings_pct: 80 }, daily: [{ date: new Date().toISOString().slice(0, 10), commands: 40, input_tokens: 100000, output_tokens: 20000, saved_tokens: 80000, savings_pct: 80, total_time_ms: 1 }] };

const fakeRtk = (s) => shim(s.bin, 'rtk', `
const a=process.argv.slice(2),fs=require('fs'),path=require('path');
if(a[0]==='--version')console.log('rtk 0.99.0');
else if(a[0]==='--help')console.log('Commands: gain init');
else if(a[0]==='gain')console.log(JSON.stringify(${JSON.stringify(GAIN)}));
else if(a[0]==='init'){const f=path.join(process.env.CLAUDE_CONFIG_DIR,'settings.json');fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,JSON.stringify({hooks:{PreToolUse:[{matcher:'Bash',hooks:[{type:'command',command:'rtk hook claude'}]}]}}));}
else console.log('rtk ran: '+a.join(' '));`);

const fakeGitnexus = (s) => shim(s.bin, 'gitnexus', `
const a=process.argv.slice(2),fs=require('fs'),path=require('path');
if(a[0]==='--version')console.log('1.6.12');
else if(a[0]==='doctor')console.log('Runtime: ok\\nGraph store: ok');
else if(a[0]==='setup'){const f=path.join(process.env.CLAUDE_CONFIG_DIR,'.claude.json');fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,JSON.stringify({mcpServers:{gitnexus:{command:'gitnexus'}}}));}
else console.log('gitnexus ran: '+a.join(' '));`);

const cli = (s, args, extra = {}) => spawnSync(process.execPath, [BIN, ...args], { cwd: s.proj, encoding: 'utf8', env: { ...process.env, ...extra } });

test('passthrough runs the real tool with arguments untouched (before our own parsing)', () => {
  const s = sandbox();
  try {
    fakeRtk(s); fakeGitnexus(s);
    assert.match(cli(s, ['rtk', '--weird-flag', 'git', 'status']).stdout, /rtk ran: --weird-flag git status/);
    assert.match(cli(s, ['gn', 'query', 'auth flow', '--limit', '3']).stdout, /gitnexus ran: query auth flow --limit 3/);
    assert.match(cli(s, ['gitnexus', '--help']).stdout, /gitnexus ran: --help/);
    assert.match(cli(s, ['index', '--force']).stdout, /gitnexus ran: analyze --force/);
  } finally { s.cleanup(); }
});

test('passthrough with the tool missing gives an actionable message and non-zero exit', () => {
  const s = sandbox();
  try {
    const r = cli(s, ['rtk', 'gain'], { PATH: s.bin + path.delimiter + path.dirname(process.execPath), HOME: s.root });
    assert.equal(r.status, 127);
    assert.match(r.stderr, /tokemitsu setup/);
  } finally { s.cleanup(); }
});

test('verify: all green with shims, then specific failures are reported with fixes', async () => {
  const s = sandbox();
  try {
    fakeClaude(s.bin); fakeRtk(s); fakeGitnexus(s);
    const cfg = loadConfig(s.proj);
    let checks = await verify({ cfg });
    assert.equal(summarize(checks).ok, false, 'rtk hook + gitnexus MCP not wired yet');
    assert.ok(checks.find((c) => c.id === 'rtk-hook').fix.includes('tokemitsu setup'));
    const steps = await setup({ cfg, cwd: s.proj, yes: true, acceptGitnexusLicense: true, log: () => {} });
    assert.ok(steps.every((x) => x.status !== 'fail'), JSON.stringify(steps));
    checks = await verify({ cfg, worker: true });
    assert.equal(summarize(checks).ok, true, JSON.stringify(checks.filter((c) => c.status === 'fail')));
    assert.equal(checks.find((c) => c.id === 'worker').status, 'ok');
    assert.equal(checks.find((c) => c.id === 'delegate').status, 'skip');
  } finally { s.cleanup(); }
});

test('setup refuses to install GitNexus without license acceptance (non-interactive)', async () => {
  const s = sandbox();
  try {
    fakeClaude(s.bin); fakeRtk(s);
    const steps = await setup({ cfg: loadConfig(s.proj), cwd: s.proj, yes: true, skipRtk: true, log: () => {} });
    const g = steps.find((x) => x.name === 'GitNexus install');
    assert.equal(g.status, 'skip');
    assert.match(g.detail, /license/);
  } finally { s.cleanup(); }
});

test('report CLI prints with/without/net and honest labels', async () => {
  const s = sandbox();
  try {
    fakeRtk(s);
    const ts = new Date().toISOString();
    writeLog(s.claude, '/p/a', [assistant('/p/a', ts, 'm1', 'claude-sonnet-5-5', [100000, 2000])]);
    const r = cli(s, ['report', '--since', '7d'], { TOKEMITSU_HOME: s.home, CLAUDE_CONFIG_DIR: s.claude });
    assert.equal(r.status, 0, r.stderr);
    for (const w of ['Without these tools', 'What you spent', 'You saved (net)', 'reported', 'estimated', 'bytes/4']) assert.ok(r.stdout.includes(w), w);
    const j = JSON.parse(cli(s, ['report', '--json'], { TOKEMITSU_HOME: s.home, CLAUDE_CONFIG_DIR: s.claude }).stdout);
    assert.ok(j.totals.netSavedUsd > 0);
  } finally { s.cleanup(); }
});

test('dashboard serves page + JSON on loopback and rejects foreign Host headers', async () => {
  const s = sandbox();
  try {
    fakeRtk(s); fakeClaude(s.bin);
    const server = createServer({ cfg: loadConfig(s.proj) });
    const port = await listen(server, 0);
    const get = (p, host) => new Promise((res, rej) => http.get({ host: '127.0.0.1', port, path: p, headers: host ? { host } : {} }, (r) => { let b = ''; r.on('data', (d) => (b += d)); r.on('end', () => res({ code: r.statusCode, body: b })); }).on('error', rej));
    assert.equal(server.address().address, '127.0.0.1');
    const page = await get('/');
    assert.equal(page.code, 200); assert.match(page.body, /spent vs saved/);
    const sum = JSON.parse((await get('/api/summary?since=30d')).body);
    assert.equal(sum.lanes.find((l) => l.id === 'rtk').avoidedTokens, 80000);
    assert.ok(Array.isArray(JSON.parse((await get('/api/health')).body).checks));
    assert.equal((await get('/', 'evil.example.com')).code, 403);
    assert.equal((await get('/nope')).code, 404);
    server.close();
  } finally { s.cleanup(); }
});

test('unknown command exits 2; help exits 0', () => {
  const s = sandbox();
  try {
    assert.equal(cli(s, ['wat']).status, 2);
    assert.equal(cli(s, ['help']).status, 0);
    assert.match(cli(s, ['--version']).stdout, /^\d+\.\d+\.\d+/);
  } finally { s.cleanup(); }
});
