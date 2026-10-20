/** Shared Web defaults and session choices. Run: node --import tsx/esm scripts/verify-profile-defaults.ts */
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import { syncBuiltinESMExports } from 'node:module'
import { mock } from 'node:test'

// Isolate preference paths without changing HOME or the user's files.
const fixture = mkdtempSync(join(os.tmpdir(), 'dsh-profile-defaults-'))
const homedir = mock.method(os, 'homedir', () => fixture)
syncBuiltinESMExports()
const { profileStartupRoutes } = await import('../src/dsh-adapter/profile-defaults.js')
const { createModelSelection } = await import('../src/dsh-adapter/channel/model-selection.js')
const { createModelSwitchAction } = await import('../src/dsh-adapter/channel/model-switch.js')
const { createModelActions } = await import('../src/dsh-adapter/channel/model-actions.js')
const { createSessionResumeActions } = await import('../src/dsh-adapter/channel/session-resume.js')
const { createPermissionModeActions } = await import('../src/dsh-adapter/channel/mode-permission-actions.js')
const { createChannelOwner } = await import('../src/dsh-adapter/channel/owner.js')
const prefs = join(fixture, '.dsh-tui')
mkdirSync(prefs)
const legacy = { 'model.json': { provider: 'old', model: 'old-model' }, 'effort.json': { effort: 'max' }, 'agent-preset.json': { preset: 'old-preset' }, 'permission.json': { permission: 'danger-full-access' } }
for (const [file, value] of Object.entries(legacy)) writeFileSync(join(prefs, file), JSON.stringify(value))
type Selection = { provider: string; model: string; reasoningEffort?: string }
let shared: Selection = { provider: 'web', model: 'first', reasoningEffort: 'medium' }
let defaultPreset = 'web-preset'
let header: { config: Selection; adapterDefaults?: { reasoningEffort?: boolean } } | undefined
let pending: Selection | null = null
const saved: Selection[] = []
const settingsWrites: unknown[] = []
const events: { type: string; data: unknown }[] = []
const sessionListeners: ((session: unknown, event: { type: string; data: unknown }) => void)[] = []
let created: { agentOptions: Selection; meta: { agentPreset: string } } | undefined
const createdSignal = new Error('captured creation')
const agent = { options: { provider: 'web', model: 'first' }, session: {
  id: 'test-session', header: { id: 'test-session', cwd: fixture }, events, requestHeader: () => header,
  append(type: string, data: unknown) { events.push({ type, data }) },
}, ctx: { on: () => () => {} } }
const ctx = { on(name: string, listener: (session: unknown, event: { type: string; data: unknown }) => void) { if (name === 'session/event') sessionListeners.push(listener); return () => {} }, logger: { warn() {}, debug() {} }, get(name: string): unknown {
  if (name === 'agentDefaultModel') return { currentSelection: () => ({ ...shared }), async saveSelection(value: Selection) { saved.push(value); shared = value } }
  if (name === 'sessionProjections') return { stateOf: () => ({ pending }) }
  if (name === 'agentPresets') return { get defaultId() { return defaultPreset }, resolve: async (id?: string) => ({ id: id ?? defaultPreset }), recompose: async (_ctx: unknown, id: string) => ({ id }), mount: async () => {}, list: async () => [] }
  if (name === 'settings') return { async mutate(namespace: string, operations: { path: string[]; value: string }[]) { settingsWrites.push({ namespace, operations }); if (namespace === 'agent-preset-registry') defaultPreset = operations[0]!.value } }
  if (name === 'llm') return { listModels: async () => [], listProviders: () => [], resolveModelInfo: async () => ({ reasoning: { efforts: ['low', 'medium', 'high', 'max'].map(id => ({ id, name: id })), defaultEffort: 'low' } }) }
  if (name === 'agents') return { async create(options: typeof created) { created = options; throw createdSignal } }
} }
const owner = createChannelOwner()
try {
  assert.deepEqual(profileStartupRoutes(ctx as never, { provider: 'config', model: 'config-model' }, true).startupRoute, shared)
  assert.deepEqual(profileStartupRoutes(ctx as never, {}, false).startupRoute, { provider: 'old', model: 'old-model' }, 'legacy mode remains unchanged')
  const selected = createModelSelection(ctx as never, { owner, agent: () => agent as never, followProfileDefaults: true })
  selected.bind(agent as never, { provider: 'web', model: 'first' })
  assert.deepEqual(selected.selection.current, shared, 'fresh selection includes Web effort')
  shared = { provider: 'web', model: 'second', reasoningEffort: 'high' }
  assert.deepEqual(selected.selection.current, shared, 'blank sessions follow changed defaults')
  header = { config: { provider: 'logged', model: 'resumed', reasoningEffort: 'medium' } }
  assert.deepEqual(selected.selection.current, header.config, 'resume retains logged model and effort')
  header.adapterDefaults = { reasoningEffort: true }
  assert.deepEqual(selected.selection.current, { provider: 'logged', model: 'resumed' }, 'adapter defaults are not explicit choices')
  header = undefined
  const state = { provider: 'web', model: 'second', reasoningEffort: undefined as string | undefined, working: false, agentPreset: 'web-preset', emit() {} }
  const binding = { capture: () => ({}), isCurrent: () => true }
  const actions = createModelActions(ctx as never, state as never, { owner, binding: binding as never, selection: selected.selection, followProfileDefaults: true, initialEffort: 'max', agent: () => agent as never, notify: () => '', checkContextWarning() {} })
  await actions.applyPreferredEffort()
  assert.equal(state.reasoningEffort, 'high', 'legacy effort.json and TUI config are ignored')
  actions.setDefaultEffort('max')
  await actions.applyPreferredEffort()
  assert.equal(state.reasoningEffort, 'high', 'TUI effortDefault cannot override the profile')
  assert.equal(await actions.setEffort('medium'), true)
  await Promise.resolve()
  assert.equal(saved.at(-1)?.reasoningEffort, 'medium', '/effort saves through the Web owner')
  assert.equal(events.at(-1)?.type, 'model/selection', 'explicit choices are durable before a request')
  const switchModel = createModelSwitchAction(ctx as never, state as never, { owner, binding: binding as never, selection: selected.selection, followProfileDefaults: true, supportsRouteSwitch: true, applyPreferredEffort: actions.applyPreferredEffort, dropModelCompletion() {}, seedUpstreamRetry() {}, notify: () => '' })
  assert.equal(await switchModel('web', 'third'), true)
  assert.deepEqual(saved.at(-1), { provider: 'web', model: 'third' }, '/model saves shared defaults')
  shared = { provider: 'web', model: 'external-change', reasoningEffort: 'high' }
  assert.deepEqual(selected.selection.current, { provider: 'web', model: 'third' }, 'explicit session choices survive default changes')
  header = { config: { provider: 'web', model: 'third' } }
  for (const listener of sessionListeners) listener(agent.session, { type: 'request/header', data: { header } })
  header = { config: { provider: 'logged', model: 'later-request' } }
  assert.deepEqual(selected.selection.current, header.config, 'a matching request consumes the pending execution cache')
  header = undefined
  assert.equal(await actions.switchPreset('new-web-preset'), true)
  assert.equal(defaultPreset, 'new-web-preset')
  assert.equal(settingsWrites.length, 1)
  const resume = createSessionResumeActions(ctx as never, {} as never, { followProfileDefaults: true, provider: 'cached', model: 'cached', configuredPreset: 'old-config' }, { settleCompaction: async () => {}, notify: () => '' } as never)
  for (const model of ['new-one', 'new-two']) {
    shared = { provider: 'web', model, reasoningEffort: 'high' }
    defaultPreset = `preset-${model}`
    const plan = await resume.newSessionOpener.plan({ cwd: fixture }, () => true)
    assert.ok(plan)
    await assert.rejects(plan.open(fixture), error => error === createdSignal)
    assert.equal(created?.agentOptions.model, model, '/new reads current defaults')
    assert.equal(created?.meta.agentPreset, defaultPreset, '/new ignores remembered TUI preset')
  }
  const permission = createPermissionModeActions(ctx as never, {} as never, { followProfileDefaults: true, owner, binding: {} as never, sessionModes: [], runtime: { mode: 'native' }, roster: {}, notify() {}, executeRegistryCommand() {} } as never)
  await permission.applyRememberedPermission() // No binding read or permission command allowed.
  pending = { provider: 'pending', model: 'saved-before-restart', reasoningEffort: 'medium' }
  const resumed = { ...agent, session: { ...agent.session, id: 'resumed' } }
  const resumedSelection = createModelSelection(ctx as never, { owner, agent: () => resumed as never, followProfileDefaults: true })
  resumedSelection.bind(resumed as never, { provider: 'web', model: 'first' })
  assert.deepEqual(resumedSelection.selection.current, pending, 'resume restores pending Web selection')
  for (const [file, value] of Object.entries(legacy)) assert.equal(readFileSync(join(prefs, file), 'utf8'), JSON.stringify(value), `${file} is untouched`)
  console.log('verify:profile-defaults OK (dynamic /new, shared setters, resume, permissions, legacy isolation)')
} finally {
  owner.dispose()
  homedir.mock.restore()
  syncBuiltinESMExports()
  rmSync(fixture, { recursive: true, force: true })
}
