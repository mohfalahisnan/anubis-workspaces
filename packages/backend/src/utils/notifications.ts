import { getStack } from '../services.js'

export function notify(title: string, body: string): void {
  try {
    const stack = getStack()
    const cfg = stack.appConfig.get()
    const enabled = cfg.enableNotifications !== false

    if (enabled) {
      console.log(`__ANUBIS_NOTIFICATION__:${JSON.stringify({ title, body })}`)
    }
  } catch {
    // Fallback if the stack is not yet instantiated
    console.log(`__ANUBIS_NOTIFICATION__:${JSON.stringify({ title, body })}`)
  }
}
