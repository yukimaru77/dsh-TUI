/** Terminal transport settings over the unchanged Web profile. */
import type { Context } from '@deepseek-ai/cordis'

export const name = 'tui-web-profile-startup'

/** Keep the Web host services available without opening another browser. */
export function apply(ctx: Context): void {
  ctx.provide('webStartup', {
    host: '127.0.0.1',
    port: 0,
    openBrowser: false,
    trustedHosts: [],
  })
}
