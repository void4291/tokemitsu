import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { sandbox, fakeClaude } from './helpers.js';
import { loadConfig } from '../src/config.js';
import { decidePreTool, runHook } from '../src/delegate/hooks.js';
import { delegateRead, delegateWrite, stripFences } from '../src/delegate/modes.js';
import { mergeHooks, enable, disable, enabledAt } from '../src/delegate/enable.js';
import { readEvents } from '../src/ledger.js';
import { readJson } from '../src/util.js';

const bigFile = (dir, n = 800) => { const p = path.join(dir, 'big.js'); fs.writeFileSync(p, Array.from({ length: n }, (_, i) => `line ${i}`).join('\n')); return p; };

test('hook blocks whole-file Read of big files, allows narrow and small reads', () => {
  const s = sandbox();
  try {
    fakeClaude(s.bin);
    const cfg = loadConfig(s.proj);
    const big = bigFile(s.proj);
    const ev = (tool_name, tool_input) => ({ tool_name, tool_input, cwd: s.proj });
    assert.equal(decidePreTool(ev('Read', { file_path: big }), cfg).decision, 'deny');
    assert.match(decidePreTool(ev('Read', { file_path: big }), cfg).reason, /tokemitsu delegate read/);
    assert.equal(decidePreTool(ev('Read', { file_path: big, offset: 10, limit: 50 }), cfg).decision, 'allow');
    assert.equal(decidePreTool(ev('Read', { file_path: big, limit: 100 }), cfg).decision, 'allow');
    assert.equal(decidePreTool(ev('Bash', { command: `cat ${big}` }), cfg).decision, 'deny');
    assert.equal(decidePreTool(ev('Bash', { command: `cat ${big} | grep line` }), cfg).decision, 'allow');
    assert.equal(decidePreTool(ev('Bash', { command: `grep -n foo ${big}` }), cfg).decision, 'allow');
    const small = path.join(s.proj, 'small.js'); fs.writeFileSync(small, 'a\nb\n');
    assert.equal(decidePreTool(ev('Read', { file_path: small }), cfg).decision, 'allow');
    assert.equal(decidePreTool(ev('Read', { file_path: '/nonexistent/x' }), cfg).decision, 'allow');
  } finally { s.cleanup(); }
});

test('hook fails open: no claude CLI, bypass env, worker recursion guard, binary file', () => {
  const s = sandbox();
  try {
    const big = bigFile(s.proj);
    const ev = { tool_name: 'Read', tool_input: { file_path: big }, cwd: s.proj };
    const cfg = loadConfig(s.proj, { ...process.env, TOKEMITSU_CLAUDE_BIN: 'definitely-not-installed' });
    assert.equal(decidePreTool(ev, cfg).decision, 'allow');
    fakeClaude(s.bin);
    const cfg2 = loadConfig(s.proj);
    assert.equal(decidePreTool(ev, cfg2, { TOKEMITSU_BYPASS: '1' }).decision, 'allow');
    assert.equal(decidePreTool(ev, cfg2, { TOKEMITSU_IN_WORKER: '1' }).decision, 'allow');
    const bin = path.join(s.proj, 'blob.js'); fs.writeFileSync(bin, Buffer.concat([Buffer.from([0, 1, 2]), Buffer.alloc(100000, 10)]));
    assert.equal(decidePreTool({ ...ev, tool_input: { file_path: bin } }, cfg2).decision, 'allow');
  } finally { s.cleanup(); }
});

test('runHook emits Claude Code deny JSON and nothing on allow or garbage input', async () => {
  const s = sandbox();
  try {
    fakeClaude(s.bin);
    const big = bigFile(s.proj);
    let buf = '';
    const out = { write: (x) => (buf += x) };
    await runHook(JSON.stringify({ tool_name: 'Read', tool_input: { file_path: big }, cwd: s.proj }), { out });
    const j = JSON.parse(buf);
    assert.equal(j.hookSpecificOutput.hookEventName, 'PreToolUse');
    assert.equal(j.hookSpecificOutput.permissionDecision, 'deny');
    buf = '';
    await runHook('not json', { out });
    await runHook(JSON.stringify({ tool_name: 'Read', tool_input: { file_path: '/etc/hostname' }, cwd: s.proj }), { out });
    assert.equal(buf, '');
  } finally { s.cleanup(); }
});

test('delegate read: locked-down worker call, stdin prompt, ledger entry with real cost', async () => {
  const s = sandbox();
  try {
    const rec = path.join(s.root, 'rec.json');
    fakeClaude(s.bin, { record: rec, cost: 0.0031 });
    const cfg = loadConfig(s.proj);
    const big = bigFile(s.proj, 2000);
    const r = await delegateRead({ file: big, question: 'what is on line 5?', cfg });
    assert.match(r.answer, /foo/);
    const seen = JSON.parse(fs.readFileSync(rec, 'utf8'));
    for (const flag of ['-p', '--output-format', '--no-session-persistence', '--disable-slash-commands', '--strict-mcp-config']) assert.ok(seen.args.includes(flag), flag);
    assert.ok(!seen.args.includes('--bare'), 'must not use --bare (breaks OAuth logins)');
    assert.equal(seen.args[seen.args.indexOf('--tools') + 1], '');
    assert.equal(seen.args[seen.args.indexOf('--model') + 1], 'haiku');
    assert.equal(seen.env, '1');
    assert.notEqual(seen.cwd, s.proj, 'worker runs in a neutral cwd');
    assert.match(seen.stdin, /QUESTION: what is on line 5\?/);
    assert.match(seen.stdin, /^FILE: /);
    const [ev] = readEvents();
    assert.equal(ev.tool, 'read'); assert.equal(ev.kind, 'measured');
    assert.equal(ev.worker.costUsd, 0.0031);
    assert.ok(ev.avoidedIn > 2000);
  } finally { s.cleanup(); }
});

test('worker failures surface as errors and write no ledger entry', async () => {
  const s = sandbox();
  try {
    fakeClaude(s.bin, { reply: 'Not logged in', isError: true });
    const cfg = loadConfig(s.proj);
    const big = bigFile(s.proj);
    await assert.rejects(delegateRead({ file: big, question: 'q', cfg }), /worker error: Not logged in/);
    assert.equal(readEvents().length, 0);
  } finally { s.cleanup(); }
});

test('delegate write: strips fences, stays inside project, refuses overwrite without --force', async () => {
  const s = sandbox();
  try {
    fakeClaude(s.bin, { reply: '```js\nexport const a = 1;\n```' });
    const cfg = loadConfig(s.proj);
    const ref = path.join(s.proj, 'ref.js'); fs.writeFileSync(ref, 'export const ref = 0;\n');
    const r = await delegateWrite({ spec: 'make a', refs: ['ref.js'], out: 'src/new.js', cfg });
    assert.equal(fs.readFileSync(path.join(s.proj, 'src/new.js'), 'utf8'), 'export const a = 1;\n');
    assert.ok(r.written);
    await assert.rejects(delegateWrite({ spec: 'x', refs: ['ref.js'], out: 'src/new.js', cfg }), /already exists/);
    await assert.rejects(delegateWrite({ spec: 'x', refs: ['ref.js'], out: '../escape.js', cfg }), /outside the project/);
    await assert.rejects(delegateWrite({ spec: 'x', refs: [], out: 'a.js', cfg }), /--like/);
    const [ev] = readEvents();
    assert.equal(ev.kind, 'estimated'); assert.equal(ev.tool, 'write');
  } finally { s.cleanup(); }
});

test('stripFences leaves plain code alone', () => {
  assert.equal(stripFences('a\nb'), 'a\nb\n');
});

test('enable/disable merges hooks idempotently and preserves other hooks', () => {
  const s = sandbox();
  try {
    const f = path.join(s.proj, '.claude', 'settings.local.json');
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, JSON.stringify({ permissions: { allow: ['x'] }, hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'rtk hook claude' }] }] } }));
    enable({ cwd: s.proj }); enable({ cwd: s.proj });
    let j = readJson(f);
    const ours = j.hooks.PreToolUse.flatMap((g) => g.hooks).filter((h) => /hook pre-tool/.test(h.command));
    assert.equal(ours.length, 2, 'Read + Bash, no duplicates after enabling twice');
    assert.ok(j.hooks.PreToolUse.some((g) => g.hooks.some((h) => h.command === 'rtk hook claude')), 'rtk hook kept');
    assert.deepEqual(j.permissions, { allow: ['x'] });
    assert.deepEqual(enabledAt(s.proj), ['project']);
    assert.ok(fs.existsSync(path.join(s.proj, '.claude/skills/tokemitsu-delegate/SKILL.md')));
    disable({ cwd: s.proj });
    j = readJson(f);
    assert.ok(!JSON.stringify(j).includes('hook pre-tool'));
    assert.ok(JSON.stringify(j).includes('rtk hook claude'));
    assert.deepEqual(enabledAt(s.proj), []);
  } finally { s.cleanup(); }
});

test('mergeHooks removes empty containers when nothing is left', () => {
  const out = mergeHooks({ hooks: { PreToolUse: [{ matcher: 'Read', hooks: [{ command: 'tokemitsu hook pre-tool' }] }] } }, 'x', false);
  assert.equal(out.hooks, undefined);
});
