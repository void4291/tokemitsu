import { run, runInherit, which, confirm } from './util.js';
import { patchState, loadState } from './state.js';
import * as rtk from './tools/rtk.js';
import * as gn from './tools/gitnexus.js';
import { enable } from './delegate/enable.js';

/**
 * Installs/configures the upstream tools from THEIR official channels. Nothing is vendored or patched.
 * Every mutating step asks first (or --yes). Returns a list of step results for display.
 */
export async function setup({ cfg, cwd, yes = false, acceptGitnexusLicense = false, skipRtk = false, skipGitnexus = false, index = false, withDelegate = false, log = console.log }) {
  const steps = [];
  const step = (name, status, detail = '') => { steps.push({ name, status, detail }); log(`${{ ok: '✓', skip: '-', fail: '✗', warn: '!' }[status]} ${name}${detail ? ' - ' + detail : ''}`); };

  if (!which(cfg.claude.bin)) step('Claude Code CLI', 'warn', 'not found; this kit targets Claude Code only. Install it first: https://docs.claude.com/en/docs/claude-code');

  // ---- rtk
  if (skipRtk) step('rtk', 'skip', '--skip-rtk');
  else {
    let st = rtk.rtkStatus(cfg);
    if (!st.installed || !st.isReal) {
      const plan = rtk.planInstall();
      if (!plan.cmd) step('rtk install', 'fail', plan.help);
      else {
        log(`rtk (${rtk.RTK_REPO}) will be installed with: ${rtk.describePlan(plan)}`);
        if (!(await confirm('Install rtk now?', { yes }))) step('rtk install', 'skip', 'declined');
        else if (rtk.execPlan(plan) !== 0) step('rtk install', 'fail', `command failed (${plan.method})`);
        else {
          patchState({ rtkMethod: plan.method });
          st = rtk.rtkStatus(cfg);
          st.installed && st.isReal ? step('rtk install', 'ok', `${st.version} via ${plan.method}`) : step('rtk install', 'fail', 'installed but not found on PATH (open a new shell, or add ~/.local/bin to PATH)');
        }
      }
    } else step('rtk install', 'ok', `already installed (${st.version})`);

    if (st.installed && st.isReal) {
      if (rtk.hookWired()) step('rtk Claude Code hook', 'ok', 'already wired');
      else {
        const a = rtk.initArgs();
        log(`Wiring rtk into Claude Code: rtk ${a.join(' ')}`);
        if (!(await confirm('Patch ~/.claude/settings.json via rtk init?', { yes }))) step('rtk Claude Code hook', 'skip', 'declined');
        else runInherit(st.bin, a) === 0 && rtk.hookWired() ? step('rtk Claude Code hook', 'ok') : step('rtk Claude Code hook', 'fail', `run manually: rtk ${a.join(' ')}`);
      }
    }
  }

  // ---- GitNexus
  if (skipGitnexus) step('GitNexus', 'skip', '--skip-gitnexus');
  else {
    let st = gn.gitnexusStatus(cfg);
    if (!st.installed) {
      const accepted = acceptGitnexusLicense || loadState().gitnexusLicenseAccepted;
      if (!accepted) {
        log(`\nGitNexus is licensed under ${gn.GITNEXUS_LICENSE} (${gn.GITNEXUS_LICENSE_URL}).`);
        log('That license allows noncommercial use only. Using it for work at a company needs a commercial license from its authors.');
        if (!(await confirm('I will use GitNexus only in compliance with its license.', { yes: acceptGitnexusLicense, defaultNo: true }))) {
          step('GitNexus install', 'skip', 'license not accepted (re-run with --accept-gitnexus-license, or --skip-gitnexus)');
          st = null;
        } else patchState({ gitnexusLicenseAccepted: true });
      }
      if (st !== null) {
        if (gn.npmMajor() >= 11) log('note: npm 11 can crash installing native packages; if it fails, use pnpm: ' + gn.installPlan().alt);
        log('GitNexus will be installed with: npm install -g gitnexus@latest');
        if (!(await confirm('Install GitNexus now?', { yes }))) step('GitNexus install', 'skip', 'declined');
        else if (gn.execInstall() !== 0) step('GitNexus install', 'fail', `npm failed. Try: ${gn.installPlan().alt}`);
        else { st = gn.gitnexusStatus(cfg); st.installed ? step('GitNexus install', 'ok', st.version) : step('GitNexus install', 'fail', 'not on PATH after install (check your npm global bin dir)'); }
      }
    } else step('GitNexus install', 'ok', `already installed (${st.version})`);

    if (st?.installed) {
      if (!st.nodeOk) step('GitNexus Node engine', 'fail', `needs Node ${st.engines}; you have ${process.versions.node}`);
      else {
        const d = gn.doctor(cfg);
        step('GitNexus doctor', d.ok ? (d.warnings.length ? 'warn' : 'ok') : 'fail', d.warnings.join('; ') || 'healthy');
        if (gn.mcpRegistered()) step('GitNexus MCP for Claude Code', 'ok', 'already registered');
        else {
          log('Registering GitNexus with Claude Code: gitnexus ' + gn.setupArgs().join(' '));
          if (!(await confirm('Run gitnexus setup for Claude Code?', { yes }))) step('GitNexus MCP for Claude Code', 'skip', 'declined');
          else runInherit(st.bin, gn.setupArgs()) === 0 && gn.mcpRegistered() ? step('GitNexus MCP for Claude Code', 'ok') : step('GitNexus MCP for Claude Code', 'fail', `run manually: gitnexus ${gn.setupArgs().join(' ')}`);
        }
        if (index) {
          log('Indexing this repo: gitnexus analyze (local; may take a while)');
          runInherit(st.bin, ['analyze'], { cwd }) === 0 ? step('Index this repo', 'ok') : step('Index this repo', 'fail', 'gitnexus analyze failed');
        } else step('Index this repo', 'skip', 'run `tokemitsu index` inside each repo you want in the graph');
      }
    }
  }

  // ---- delegation (opt-in)
  if (withDelegate) {
    const r = enable({ global: false, cwd });
    step('Delegation hooks', 'ok', `project-local: ${r.settings}`);
  } else step('Delegation hooks', 'skip', 'opt-in: `tokemitsu delegate enable`');

  return steps;
}
