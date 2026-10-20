/** Keyless real-profile test: unchanged backend composition and live Web edits. */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtemp, mkdir, readFile, writeFile, cp, rm } from 'node:fs/promises'
import { tmpdir, homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'

const root = fileURLToPath(new URL('../', import.meta.url))
const cli = process.env.DSH_CLI ?? '/Users/nonaka/deepseek-harness/apps/cli/lib/bin.js'
const require = createRequire(cli)
const boot = await import(require.resolve('@deepseek-ai/dsh-app-boot'))
// Cordis exports FiberState as a compile-time-only enum (ACTIVE = 2).
const ACTIVE = 2
const source = process.env.DSH_WEB_PROFILE_SOURCE ?? join(homedir(), '.dsh/profiles/web')
const scratch = await mkdtemp(join(tmpdir(), 'dsh-tui-web-follow-'))
const home = join(scratch, 'home')
const profile = join(home, 'profiles/web')
const report = join(scratch, 'report.json')
let child
let log = ''
try {
  await mkdir(profile, { recursive: true })
  const manifest = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'))
  await writeFile(join(profile, 'package.json'), JSON.stringify(manifest))
  // A physical profile copy keeps DSH's scoped module-resolution boundary
  // valid while isolating package and manifest changes from production.
  await cp(join(source, 'node_modules'), join(profile, 'node_modules'), { recursive: true, dereference: false, verbatimSymlinks: true })
  const original = await readFile(join(source, 'cordis.patch.yml'), 'utf8')
  await writeFile(join(profile, 'cordis.patch.yml'), original)
  const loaded = boot.loadProfileDirectory('test', profile, cli.replace(/lib\/bin.js$/, 'package.json'))
  const context = {
    name: 'web', dir: profile, patchPath: join(profile, 'cordis.patch.yml'),
    installAnchor: cli.replace(/lib\/bin.js$/, 'package.json'), home,
    startedBundles: loaded.layers.map(layer => layer.packageName), overlays: [],
  }
  const base = boot.readProfilePatches('test', context, loaded)
  const ui = boot.loadOverlayPatches('test', join(root, 'cordis.web-ui.patch.yml'))
  const webRows = boot.composeEntries([base])
  const tuiRows = boot.composeEntries([[...base, ...ui]])
  const uiChanges = new Set(['web-startup', 'webserver', 'web-runtime'])
  for (const row of webRows) {
    if (!uiChanges.has(row.id)) assert.deepEqual(tuiRows.find(value => value.id === row.id), row, row.id)
  }
  const additions = tuiRows.filter(row => !webRows.some(value => value.id === row.id))
  assert.equal(additions.length, 9)
  assert.equal(additions.find(row => row.id === 'dsh-tui').config.followProfileDefaults, true)
  console.log(`Composition: ${webRows.length - uiChanges.size} Web rows preserved; 9 terminal presentation rows added`)

  await writeFile(join(scratch, 'no-network.mjs'), "globalThis.fetch = async () => { throw new Error('Network disabled in fixture'); };\n")
  await writeFile(join(scratch, 'probe.mjs'), `
import { writeFileSync } from 'node:fs';
export const name = 'web-follow-probe';
export const inject = ['agentDefaultModel', 'loader', 'appReady'];
export function apply(ctx) {
  let reloads = 0;
  ctx.on('app-boot/config-reload', () => { reloads++; });
  ctx.appReady.onReady(() => {
    const timer = setInterval(() => writeFileSync(process.env.WEB_FOLLOW_REPORT, JSON.stringify({
      selection: ctx.agentDefaultModel.currentSelection(), reloads,
      marker: ctx.get('followMarker') === true,
      plugins: Object.fromEntries([...ctx.loader.entries()].filter(e => ['ssh-remote', 'dsh-livevoice', 'kb'].includes(e.options.id)).map(e => [e.options.id, e.fiber?.state])),
      failures: [...ctx.loader.entries()].filter(e => !e.disabled && e.error).map(e => e.options.id)
    })), 75);
    ctx.effect(() => () => clearInterval(timer));
  });
}
`)
  // The UI itself is exercised with a PTY separately. This test keeps the
  // real Web/TUI services and Loader running, with no session or model call.
  await writeFile(join(scratch, 'probe.patch.yml'), `- id: dsh-tui\n  disabled: true\n- insert:\n    - id: web-follow-probe\n      name: ${JSON.stringify(join(scratch, 'probe.mjs'))}\n`)
  child = spawn(process.execPath, [cli, '--profile', 'web', '--patch', join(root, 'cordis.web-ui.patch.yml'), '--patch', join(scratch, 'probe.patch.yml')], {
    cwd: scratch,
    env: { ...process.env, HOME: scratch, DSH_HOME: home, WEB_FOLLOW_REPORT: report,
      NODE_OPTIONS: `--import=${join(scratch, 'no-network.mjs')}`, DSH_TELEMETRY_DISABLED: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.on('data', data => { log += data })
  child.stderr.on('data', data => { log += data })
  async function until(check) {
    const deadline = Date.now() + 20000
    while (Date.now() < deadline) {
      if (child.exitCode !== null) throw new Error(`Fixture exited ${child.exitCode}: ${log}`)
      let value
      try { value = JSON.parse(await readFile(report, 'utf8')) } catch {}
      if (value && check(value)) return value
      await delay(100)
    }
    throw new Error(`Fixture timed out: ${log}`)
  }
  const ready = await until(value => value.selection.provider)
  assert.equal(ready.plugins['ssh-remote'], ACTIVE)
  assert.equal(ready.plugins['dsh-livevoice'], ACTIVE)
  await writeFile(join(profile, 'cordis.patch.yml'), original + '\n- id: agent-default-model\n  config: {provider: fixture, model: changed-live, reasoningEffort: high}\n')
  const changed = await until(value => value.selection.model === 'changed-live')
  assert.equal(changed.selection.reasoningEffort, 'high')
  assert.ok(changed.reloads > 0)
  const bundle = join(profile, 'node_modules/web-follow-fixture')
  await mkdir(bundle)
  await writeFile(join(bundle, 'package.json'), JSON.stringify({ name: 'web-follow-fixture', type: 'module', version: '0.0.0', dsh: { bundle: { patch: './cordis.patch.yml' } } }))
  await writeFile(join(bundle, 'cordis.patch.yml'), '- insert:\n    - id: follow-marker\n      name: ./marker.mjs\n')
  await writeFile(join(bundle, 'marker.mjs'), "export const name = 'follow-marker'; export function apply(ctx) { ctx.provide('followMarker', true); }\n")
  manifest.dsh.profile.bundles.push('web-follow-fixture')
  await writeFile(join(profile, 'package.json'), JSON.stringify(manifest))
  await until(value => value.marker)
  manifest.dsh.profile.bundles.pop()
  await writeFile(join(profile, 'package.json'), JSON.stringify(manifest))
  await until(value => !value.marker)
  console.log('Live follow: Web model/effort edits and bundle add/remove applied without restarting')
} finally {
  if (child && child.exitCode === null) {
    child.kill('SIGTERM')
    await Promise.race([new Promise(resolve => child.once('exit', resolve)), delay(3000)])
    if (child.exitCode === null) child.kill('SIGKILL')
  }
  await rm(scratch, { recursive: true, force: true })
}
