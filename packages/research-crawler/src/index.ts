export { launchChrome, killChrome } from './core/chrome/launch-chrome.js'
export { captureInstagramData, discoverInstagramCompetitors } from './core/instagram-crawler.js'
export { silentReporter, stderrReporter } from './core/progress/progress-reporter.js'

export type { LaunchChromeInput, LaunchChromeResult } from './core/chrome/launch-chrome.js'
export type {
  CaptureInstagramInput,
  DiscoverInstagramInput,
} from './core/instagram-crawler.js'
export type {
  PostData,
  ProfileData,
  StandardCrawlerOutput,
} from './core/standard-output.js'
export { applyAvgLikesToOutput } from './core/instagram/avg-likes.js'
