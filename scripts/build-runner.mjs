#!/usr/bin/env node
// The overnight factory.
//
// Runs on the MacBook under launchd between 02:00 and 06:00. NOT on GitHub
// Actions: the Free plan includes 2,000 minutes a month for private repos and a
// four-hour nightly run is 240 of them, so a full month would cost around $31 —
// more than the entire AI budget this project was shaped to avoid.
//
// The rules it obeys live in src/lib/builds.js and are tested there, without a
// network or a clock. This file is plumbing: fetch, write files, run npm, push.
// Where a judgement is needed it asks that module, because a judgement made
// inline at four in the morning is a judgement nobody reviewed.
//
// Env (scripts/.build.env, chmod 600):
//   SUPABASE_URL, SUPABASE_SERVICE_KEY, NVIDIA_API_KEY
// GitHub comes from the `gh` CLI already authenticated on this machine, so no
// token is stored by this script and there is nothing here to leak.

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';

import {
  inWindow, minutesLeft, canSpend, waitFor, backoffFor, MAX_RETRIES,
  NIGHTLY_CAP, repoNameOf, canCreateRepo, isPushAllowed, findSecrets,
  nextPhase, nextIteration, MAX_REPAIR,
} from '../src/lib/builds.js';

const {
  SUPABASE_URL, SUPABASE_SERVICE_KEY, NVIDIA_API_KEY,
  BUILD_MODEL = 'z-ai/glm-5.2',
} = process.env;

const ROOT = join(homedir(), '.player-one-builds');
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const sleep = ms => new Promise(r => setTimeout(r, ms));

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !NVIDIA_API_KEY) {
  // A missing config is a state, not a crash — same reasoning as meeting-worker.
  // Exiting non-zero here would email a failure every night until it is set up.
  log('Missing env. Expected SUPABASE_URL, SUPABASE_SERVICE_KEY, NVIDIA_API_KEY.');
  process.exit(0);
}

// ---------------------------------------------------------------- Supabase
const SB = SUPABASE_URL.replace(/\/$/, '');
const H = {
  apikey: SUPABASE_SERVICE_KEY,
  Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
  'Content-Type': 'application/json',
};
async function sb(path, init = {}) {
  const r = await fetch(`${SB}/rest/v1/${path}`, { ...init, headers: { ...H, ...(init.headers || {}) } });
  if (!r.ok) throw new Error(`Supabase ${init.method || 'GET'} ${path}: ${r.status} ${await r.text()}`);
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}
const patchBuild = (id, patch) =>
  sb(`builds?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify(patch) });

// Appends rather than replaces. The log is the only account of a night nobody
// watched, and a phase that overwrites it destroys the record of the phase
// before — invariably the one that explains the failure.
async function note(b, line) {
  log(`[${b.name}] ${line}`);
  b.log = [...(b.log || []), { at: new Date().toISOString(), line }].slice(-200);
  try { await patchBuild(b.id, { log: b.log }); } catch { /* logging must not fail the run */ }
}

// ------------------------------------------------------------------- GLM
let lastCall = 0;
let spent = 0;

async function ask(prompt, { system, maxTokens = 4096, attempt = 0 } = {}) {
  const gate = canSpend({ used: spent, now: new Date(), attempts: attempt });
  if (!gate.ok) throw Object.assign(new Error(gate.message), { stop: gate.why });

  const wait = waitFor(lastCall, Date.now());
  if (wait) await sleep(wait);

  lastCall = Date.now();
  spent += 1;

  const r = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${NVIDIA_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: BUILD_MODEL,
      max_tokens: maxTokens,
      // Lower than the chat default on purpose: this output has to compile.
      temperature: 0.4,
      messages: system
        ? [{ role: 'system', content: system }, { role: 'user', content: prompt }]
        : [{ role: 'user', content: prompt }],
    }),
  });

  if (r.status === 429 || r.status >= 500) {
    if (attempt >= MAX_RETRIES - 1) throw new Error(`GLM ${r.status} after ${MAX_RETRIES} attempts`);
    const ms = backoffFor(attempt);
    log(`  ${r.status} — backing off ${ms / 1000}s`);
    await sleep(ms);
    return ask(prompt, { system, maxTokens, attempt: attempt + 1 });
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error?.message || j?.detail || `GLM ${r.status}`);
  return j.choices?.[0]?.message?.content || '';
}

// Models wrap JSON in prose and fences however firmly you ask them not to.
// Parsing defensively is cheaper than another request, and another request at
// 4am is a request that might not fit inside the window.
function parseJson(text) {
  const fenced = String(text).match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : String(text);
  const start = body.search(/[[{]/);
  if (start < 0) return null;
  for (let end = body.length; end > start; end--) {
    try { return JSON.parse(body.slice(start, end)); } catch { /* keep shrinking */ }
  }
  return null;
}

// --------------------------------------------------------------- the phases

const SYSTEM = 'You are a senior engineer producing a small, complete, runnable project. '
  + 'Prefer boring, well-supported choices over clever ones. No placeholder TODOs and no '
  + 'stub functions that throw. Every file you write must be complete and syntactically valid.';

async function phaseBrief(b) {
  // Nothing is built from a one-liner. An unclear brief produces a confident,
  // useless repo, and the cost of discovering that is a whole night.
  const idea = b.brief_request || b.name;
  const out = await ask(
    `Expand this project idea into a short build brief.\n\nIDEA: ${idea}\n\n`
    + 'Reply as JSON: {"summary":"one paragraph","stack":["..."],"features":["..."],'
    + '"done_when":["..."],"out_of_scope":["..."]}\n'
    + 'Scope it to something one engineer finishes in a few hours. This is a seed to grow over '
    + 'several nights, not a finished product.',
    { system: SYSTEM },
  );
  const j = parseJson(out);
  if (!j) throw new Error('brief did not come back as JSON');
  b.brief = JSON.stringify(j, null, 2);
  await patchBuild(b.id, { brief: b.brief, phase: 'plan' });
  await note(b, `brief: ${String(j.summary || '').slice(0, 120) || '(no summary)'}`);
}

async function phasePlan(b) {
  // The manifest keeps a build coherent. Without it, file 14 contradicts file 3
  // and nothing notices until verify.
  const out = await ask(
    `BRIEF:\n${b.brief}\n\nList every file this project needs.\n`
    + 'Reply as JSON: {"files":[{"path":"src/index.js","purpose":"one line"}]}\n'
    + 'Include package.json, a README, and at least one test. Order them so a file only '
    + 'depends on files earlier in the list. Twenty files maximum.',
    { system: SYSTEM },
  );
  const j = parseJson(out);
  if (!j || !Array.isArray(j.files) || !j.files.length) throw new Error('plan did not come back as a file list');
  const files = j.files.filter(f => f && f.path).slice(0, 20);
  b.manifest = files;
  await patchBuild(b.id, { manifest: files, phase: 'generate' });
  await note(b, `plan: ${files.length} files`);
}

function writeFile(dir, path, body) {
  // Paths come from a model, so they are untrusted input. A generated "path" of
  // ../../.ssh/authorized_keys is not a hypothetical worry for a process that
  // writes files unattended as your user.
  const clean = String(path).replace(/^[/\\]+/, '');
  if (clean.split(/[/\\]/).includes('..')) throw new Error(`refusing to write outside the workspace: ${path}`);
  const full = join(dir, clean);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, body);
  return clean;
}

async function phaseGenerate(b, dir) {
  const files = b.manifest || [];
  const written = b.written || {};

  for (const f of files) {
    if (written[f.path]) continue;   // resumable: skip whatever a previous night wrote
    if (!inWindow(new Date())) { await note(b, 'window closed mid-generate — resuming tomorrow'); return false; }

    // Signatures of what already exists, not the whole codebase: context cost
    // grows quadratically and quality falls with it.
    const context = Object.entries(written)
      .map(([p, body]) => `${p}: ${String(body).split('\n').slice(0, 3).join(' ').slice(0, 160)}`)
      .join('\n');

    const out = await ask(
      `BRIEF:\n${b.brief}\n\nFILES ALREADY WRITTEN:\n${context || '(none yet)'}\n\n`
      + `Write the complete contents of ${f.path} — ${f.purpose || ''}.\n`
      + 'Output ONLY the file contents. No fences, no commentary, no explanation.',
      { system: SYSTEM, maxTokens: 6000 },
    );
    const body = String(out).replace(/^```[a-z]*\n?/i, '').replace(/```\s*$/, '');
    written[f.path] = body;
    writeFile(dir, f.path, body);
    await patchBuild(b.id, { requests_used: spent });
    await note(b, `wrote ${f.path} (${body.length} chars)`);
  }

  // Any key-shaped string fails the build rather than shipping. Even a fake one:
  // a fake key in a committed file is indistinguishable from a real one to
  // everyone who reads it afterwards.
  const leaks = findSecrets(written);
  if (leaks.length) {
    await patchBuild(b.id, { status: 'failed', fail_reason: `secret-shaped string in ${leaks[0].path}` });
    await note(b, `REFUSED to continue: ${leaks.map(l => l.path).join(', ')}`);
    return false;
  }

  b.written = written;
  await patchBuild(b.id, { phase: 'verify' });
  return true;
}

function run(cmd, args, cwd) {
  try {
    const out = execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: 'pipe', timeout: 10 * 60_000 });
    return { ok: true, out: String(out) };
  } catch (e) {
    return { ok: false, out: `${e.stdout || ''}\n${e.stderr || ''}`.trim().slice(-4000) };
  }
}

async function phaseVerify(b, dir) {
  // The phase that separates a repo from a demo.
  const steps = [];
  if (existsSync(join(dir, 'package.json'))) {
    steps.push(['npm', ['install', '--no-audit', '--no-fund']]);
    let pkg = {};
    try { pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')); } catch { /* malformed shows up as install failing */ }
    if (pkg.scripts?.build) steps.push(['npm', ['run', 'build']]);
    if (pkg.scripts?.test) steps.push(['npm', ['test']]);
  }
  const failures = [];
  for (const [cmd, args] of steps) {
    const r = run(cmd, args, dir);
    await note(b, `${cmd} ${args[0]}: ${r.ok ? 'ok' : 'FAILED'}`);
    if (!r.ok) failures.push({ cmd: `${cmd} ${args.join(' ')}`, out: r.out });
  }
  b.failures = failures;
  await patchBuild(b.id, { verify_failures: failures.length });
  return failures.length === 0;
}

async function phaseRepair(b, dir, round) {
  const f = b.failures?.[0];
  if (!f) return;
  const out = await ask(
    `This command failed:\n\n${f.cmd}\n\n${f.out}\n\n`
    + 'Reply as JSON: {"path":"the file to fix","contents":"the complete corrected file"}\n'
    + 'One file. Full contents, not a diff.',
    { system: SYSTEM, maxTokens: 6000 },
  );
  const j = parseJson(out);
  if (!j?.path || typeof j.contents !== 'string') { await note(b, `repair ${round}: no usable fix returned`); return; }
  const clean = writeFile(dir, j.path, j.contents);
  b.written[clean] = j.contents;
  await note(b, `repair ${round}: rewrote ${clean}`);
}

async function phaseShip(b, dir) {
  const name = repoNameOf(b.name);
  const fresh = !b.repo_url;

  if (fresh) {
    const guard = canCreateRepo(name);
    if (!guard.ok) {
      await patchBuild(b.id, { status: 'failed', fail_reason: guard.message });
      await note(b, `will not create a repo called ${name}: ${guard.message}`);
      return;
    }
  }

  const push = isPushAllowed({
    targetUrl: b.repo_url || '', ownedUrl: b.repo_url || '', isNew: fresh, private: true,
  });
  if (!push.ok) {
    await patchBuild(b.id, { status: 'failed', fail_reason: push.message });
    await note(b, `refused to push: ${push.message}`);
    return;
  }

  run('git', ['init', '-q', '-b', 'main'], dir);
  run('git', ['add', '-A'], dir);
  run('git', ['commit', '-q', '-m', fresh ? 'Initial build' : `Iteration ${(b.iteration || 0) + 1}`], dir);

  let url = b.repo_url;
  if (fresh) {
    const r = run('gh', ['repo', 'create', name, '--private', '--source', '.', '--push'], dir);
    if (!r.ok) {
      await patchBuild(b.id, { status: 'failed', fail_reason: 'gh repo create failed' });
      await note(b, r.out.slice(-500));
      return;
    }
    const found = r.out.match(/https:\/\/github\.com\/\S+/);
    url = found ? found[0].replace(/\.git$/, '') : null;
    if (!url) { await patchBuild(b.id, { status: 'failed', fail_reason: 'could not read the created repo URL' }); return; }
  } else {
    // force-with-lease rather than force: if something else moved that branch,
    // the safe outcome is a failed push and a note, not an overwrite nobody saw.
    const r = run('git', ['push', url, 'HEAD:main', '--force-with-lease'], dir);
    if (!r.ok) { await note(b, `push failed: ${r.out.slice(-500)}`); return; }
  }

  await patchBuild(b.id, {
    status: 'done', phase: 'ship', repo_url: url,
    iteration: (b.iteration || 0) + 1,
    last_run: new Date().toISOString(),
    requests_used: spent,
    verify_failures: b.failures?.length || 0,
  });
  await note(b, `shipped → ${url}${b.failures?.length ? ` (with ${b.failures.length} known failure(s))` : ''}`);
}

// -------------------------------------------------------------------- main

async function runBuild(b) {
  const dir = join(ROOT, repoNameOf(b.name));
  // A first build starts clean; an iteration keeps what is already there so the
  // repo grows rather than being rewritten from nothing every night.
  if (!b.repo_url && (b.phase || 'brief') === 'brief') rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });

  let phase = b.phase || 'brief';
  let repairs = 0;

  while (phase && inWindow(new Date())) {
    await note(b, `phase ${phase} · ${spent}/${NIGHTLY_CAP} requests · ${minutesLeft(new Date())}m left`);

    if (phase === 'brief') { await phaseBrief(b); phase = 'plan'; continue; }
    if (phase === 'plan') { await phasePlan(b); phase = 'generate'; continue; }
    if (phase === 'generate') { if (!(await phaseGenerate(b, dir))) return; phase = 'verify'; continue; }
    if (phase === 'verify') {
      const clean = await phaseVerify(b, dir);
      phase = nextPhase('verify', { verifyClean: clean, repairRounds: repairs });
      if (phase === 'failed') {
        // Not a failure worth throwing away. A repo that builds with two known
        // test failures and a note saying so is more use than nothing at all.
        await note(b, `giving up on repair after ${MAX_REPAIR} rounds — shipping with known failures`);
        phase = 'ship';
      }
      continue;
    }
    if (phase === 'repair') { repairs += 1; await phaseRepair(b, dir, repairs); phase = 'verify'; continue; }
    if (phase === 'ship') { await phaseShip(b, dir); return; }
  }

  await patchBuild(b.id, { phase, requests_used: spent, last_run: new Date().toISOString() });
  await note(b, 'window closed — will resume tomorrow from here');
}

async function main() {
  if (!inWindow(new Date())) { log('outside 02:00–06:00, nothing to do'); return; }

  const rows = await sb('builds?select=*&order=created_at.asc');
  const queue = [];
  for (const b of rows || []) {
    if (b.status === 'pending' || b.status === 'in_progress') { queue.push(b); continue; }
    const it = nextIteration(b);
    if (it) queue.push({ ...b, ...it, status: 'in_progress', phase: 'brief', brief_request: it.brief });
  }
  if (!queue.length) { log('nothing queued'); return; }

  log(`${queue.length} build(s) queued · ${minutesLeft(new Date())} minutes in the window`);

  for (const b of queue) {
    if (!inWindow(new Date())) break;
    const gate = canSpend({ used: spent, now: new Date() });
    if (!gate.ok) { log(`stopping: ${gate.message}`); break; }
    try {
      await patchBuild(b.id, { status: 'in_progress', last_run: new Date().toISOString() });
      await runBuild(b);
    } catch (e) {
      // One bad build must not take the night down with it.
      await patchBuild(b.id, {
        status: 'failed',
        fail_reason: String(e.message).slice(0, 300),
        requests_used: spent,
      }).catch(() => {});
      log(`✗ ${b.name}: ${e.message}`);
    }
  }
  log(`done · ${spent} requests spent`);
}

main().catch(e => { console.error(e); process.exit(1); });
