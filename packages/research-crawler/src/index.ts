export { launchChrome, killChrome } from './core/chrome/launch-chrome.js'
// Canonical Chrome remote-debugging ports for the three-profile architecture.
// Re-exported so the backend resolves profiles against these values instead of
// re-stating 9222/9223/9224 as magic numbers (which would silently drift).
export {
  LOGIN_PROFILE_PORT,
  PUBLIC_PROFILE_PORT,
  FLOW_PROFILE_PORT,
} from './core/chrome/profile-resolver.js'
export type { ProfileName } from './core/chrome/profile-resolver.js'
export { captureInstagramData, discoverInstagramCompetitors } from './core/instagram-crawler.js'
export { captureChatGPTConversations, captureChatGPTConversationDetails, sendChatGPTPrompt } from './core/chatgpt-crawler.js'
export { captureQwenConversations, captureQwenConversationDetails, sendQwenPrompt } from './core/qwen-crawler.js'
export { calculateAvgLikesSummary } from './core/instagram/avg-likes.js'
export { silentReporter, stderrReporter } from './core/progress/progress-reporter.js'
export { flowGenerate, ensureFlowChrome, openFlowUrl } from './core/flow/flow-generate.js'

export type { LaunchChromeInput, LaunchChromeResult } from './core/chrome/launch-chrome.js'
export type {
  CaptureInstagramInput,
  DiscoverInstagramInput,
} from './core/instagram-crawler.js'
export type {
  CaptureChatGPTConversationsInput,
  CaptureChatGPTConversationDetailsInput,
  SendChatGPTPromptInput,
} from './core/chatgpt-crawler.js'
export type {
  CaptureQwenConversationsInput,
  CaptureQwenConversationDetailsInput,
  SendQwenPromptInput,
} from './core/qwen-crawler.js'
export type {
  PostData,
  ProfileData,
  StandardCrawlerOutput,
  ChatGPTConversation,
  ChatGPTMessage,
  QwenConversation,
  QwenMessage,
} from './core/standard-output.js'
export type {
  FlowGenerateInput,
  FlowGenerateResult,
  FlowGenerateRatio,
  FlowGenerateVariations,
} from './core/flow/flow-generate.js'
