// Debug harness for ChatGPT conversation-detail capture.
//
// Usage (from repo root):
//   node scripts/debug-chatgpt-details.mjs <conversationId>
//
// It enables verbose CDP logging, keeps Chrome + the tab open so you can inspect,
// and prints every network response the listener observed. The "login" Chrome
// profile (port 9222) must already be logged in to ChatGPT.

import { join } from 'node:path'
import { captureChatGPTConversationDetails } from '../packages/research-crawler/dist/index.js'

process.env.ANUBIS_DEBUG_CDP = '1'

// Resolve the SAME login profile the playground UI uses (services.ts + chrome-defaults.ts).
function loginProfileDir() {
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    return join(process.env.LOCALAPPDATA, 'Anubis', 'anubis', 'chrome-profiles', 'chrome-profile-login')
  }
  const base = process.env.XDG_DATA_HOME || join(process.env.HOME || '', '.local', 'share')
  return join(base, 'anubis', 'chrome-profiles', 'chrome-profile-login')
}

const conversationId = process.argv[2]
if (!conversationId) {
  console.error('Usage: node scripts/debug-chatgpt-details.mjs <conversationId>')
  process.exit(1)
}

console.error(`\n=== capturing details for ${conversationId} ===\n`)

const result = await captureChatGPTConversationDetails({
  conversationId,
  profile: 'login',
  profileDir: loginProfileDir(),
  openNewTab: true,
  keepTabOpen: true,
  keepChromeOpen: true,
  includeRaw: true,
  timeoutMs: 30000,
})

console.error('\n=== RESULT ===')
console.error('ok:', result.ok)
const messages = result?.output?.chatMessages
console.error('messages:', Array.isArray(messages) ? messages.length : '(none)')
if (!result.ok) console.error('error:', JSON.stringify(result.error))
console.error('\nFull result JSON:')
console.error(JSON.stringify(result, null, 2))
