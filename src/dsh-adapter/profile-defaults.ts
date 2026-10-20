import type { Context } from '@deepseek-ai/cordis'
import type { ModelSelection } from '@deepseek-ai/dsh-agent'
import { readModelPref } from '../modelPrefs.js'
import { resolveModelRoute, type ModelRoute } from '../modelRoute.js'

/** Read the owning profile on every new-session operation, including HMR edits. */
export function profileModelSelection(ctx: Context): ModelSelection | undefined {
  const selected = (ctx.get('agentDefaultModel') as {
    currentSelection?(): ModelSelection
  } | undefined)?.currentSelection?.()
  return typeof selected?.provider === 'string' && selected.provider.length > 0
    && typeof selected.model === 'string' && selected.model.length > 0 ? selected : undefined
}

export function profileStartupRoutes(ctx: Context, configured: { provider?: string; model?: string }, followProfileDefaults = false, fallback?: ModelRoute) {
  const shared = profileModelSelection(ctx)
  const deploymentRoute = followProfileDefaults
    ? shared ?? resolveModelRoute(configured, undefined, fallback)
    : resolveModelRoute(configured, undefined, fallback ?? shared)
  return {
    deploymentRoute,
    startupRoute: followProfileDefaults ? deploymentRoute : resolveModelRoute(configured, readModelPref(), fallback ?? shared),
  }
}

/** The same owning service used by Web's model/effort selector. */
export async function saveProfileModelSelection(ctx: Context, selection: ModelSelection): Promise<void> {
  const service = ctx.get('agentDefaultModel') as { saveSelection(next: ModelSelection): Promise<void> } | undefined
  if (service === undefined) throw new Error('agentDefaultModel is unavailable')
  await service.saveSelection(selection)
}

/** Web's preset settings section writes this same registry setting. */
export async function saveProfilePreset(ctx: Context, id: string): Promise<void> {
  const settings = ctx.get('settings') as {
    mutate(ns: string, operations: readonly { op: 'set'; path: readonly string[]; value: string }[]): Promise<void>
  } | undefined
  if (settings === undefined) throw new Error('settings is unavailable')
  await settings.mutate('agent-preset-registry', [{ op: 'set', path: ['selectedDefault'], value: id }])
}
