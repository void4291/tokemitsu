import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function sandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tk-test-'));
  const dirs = { root, home: path.join(root, 'tk'), claude: path.join(root, 'claude'), bin: path.join(root, 'bin'), proj: path.join(root, 'proj') };
  for (const d of Object.values(dirs)) fs.mkdirSync(d, { recursive: true });
  const prev = { ...process.env };
  process.env.TOKEMITSU_HOME = dirs.home;
  process.env.CLAUDE_CONFIG_DIR = dirs.claude;
  process.env.PATH = dirs.bin + path.delimiter + process.env.PATH;
  delete process.env.TOKEMITSU_IN_WORKER; delete process.env.TOKEMITSU_BYPASS;
  return { ...dirs, cleanup() { process.env = prev; fs.rmSync(root, { recursive: true, force: true }); } };
}

export function shim(dir, name, js) {
  const p = path.join(dir, name);
  fs.writeFileSync(p, `#!/usr/bin/env node\n${js}\n`, { mode: 0o755 });
  return p;
}

/** Fake `claude -p`: echoes a canned worker reply as the real CLI's --output-format json would. */
export function fakeClaude(dir, { reply = 'L10: foo() calls bar()', cost = 0.002, isError = false, record } = {}) {
  return shim(dir, 'claude', `
const fs=require('fs');
let a=process.argv.slice(2);
if(a[0]==='--version'){console.log('2.9.9 (Claude Code)');process.exit(0);}
let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
  ${record ? `fs.writeFileSync(${JSON.stringify(record)},JSON.stringify({args:a,stdin:s,env:process.env.TOKEMITSU_IN_WORKER,cwd:process.cwd()}));` : ''}
  console.log(JSON.stringify({type:'result',subtype:'success',is_error:${isError},result:${JSON.stringify(reply)},total_cost_usd:${cost},duration_ms:900,
    usage:{input_tokens:1200,output_tokens:60,cache_creation_input_tokens:0,cache_read_input_tokens:0},modelUsage:{'claude-haiku-4-5':{}}}));
});`);
}

export function writeLog(claudeDir, projectCwd, lines) {
  const d = path.join(claudeDir, 'projects', projectCwd.replace(/[^\w]/g, '-'));
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'sess1.jsonl'), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
}

export const assistant = (cwd, ts, id, model, u, content = []) => ({
  type: 'assistant', cwd, sessionId: 's1', timestamp: ts, requestId: 'r' + id,
  message: { id, model, usage: { input_tokens: u[0], output_tokens: u[1], cache_creation_input_tokens: u[2] ?? 0, cache_read_input_tokens: u[3] ?? 0 }, content },
});
