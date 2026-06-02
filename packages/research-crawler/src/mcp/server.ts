import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { launchChrome } from '../core/chrome/launch-chrome.js'
import { captureInstagramData, discoverInstagramCompetitors } from '../core/instagram-crawler.js'

export async function runMcpServer(): Promise<void> {
  const server = new McpServer({
    name: 'research-crawler',
    version: '0.1.0'
  })

  server.registerTool(
    'open_chrome',
    {
      title: 'Open Chrome',
      description: 'Launch Chrome with remote debugging enabled for crawler access.',
      inputSchema: {
        url: z.string().url().optional(),
        profile: z.enum(['login', 'public', 'flow']).optional(),
        profileDir: z.string().min(1).optional(),
        remoteDebuggingPort: z.number().int().positive().optional(),
        chromePath: z.string().min(1).optional(),
        headless: z.boolean().optional(),
        forceHeadless: z.boolean().optional()
      }
    },
    async (input) => jsonToolResult(await launchChrome(input))
  )

  server.registerTool(
    'capture_instagram_profile',
    {
      title: 'Capture Instagram Profile',
      description: 'Capture Instagram profile and post data from Chrome DevTools network responses. Set openNewTab=true when running multiple concurrent captures on the same Chrome instance.',
      inputSchema: {
        username: z.string().min(1).optional(),
        url: z.string().url().optional(),
        chromeOrigin: z.string().url().optional(),
        remoteDebuggingPort: z.number().int().positive().optional(),
        maxResponses: z.number().int().positive().max(200).optional(),
        timeoutMs: z.number().int().positive().optional(),
        includeRaw: z.boolean().optional(),
        profile: z.enum(['login', 'public', 'flow']).optional(),
        profileDir: z.string().min(1).optional(),
        chromePath: z.string().min(1).optional(),
        headless: z.boolean().optional(),
        forceHeadless: z.boolean().optional(),
        keepChromeOpen: z.boolean().optional(),
        openNewTab: z.boolean().optional(),
        keepTabOpen: z.boolean().optional(),
        scrollIntervalMs: z.number().int().positive().max(10000).optional(),
        initialDelayMs: z.number().int().nonnegative().max(10000).optional()
      }
    },
    async (input) => jsonToolResult(await captureInstagramData(input))
  )

  server.registerTool(
    'discover_instagram_competitors',
    {
      title: 'Discover Instagram Competitors',
      description: 'Crawl Instagram Explore, hashtag, or keyword surfaces to find competitor profile candidates. Returns a list of profiles with username, bio, follower count, and profile URL.',
      inputSchema: {
        source: z.enum(['explore', 'hashtag', 'keyword']).optional(),
        hashtag: z.string().min(1).optional(),
        keyword: z.string().min(1).optional(),
        chromeOrigin: z.string().url().optional(),
        remoteDebuggingPort: z.number().int().positive().optional(),
        targetCompetitors: z.number().int().positive().max(200).optional(),
        timeoutMs: z.number().int().positive().optional(),
        includeRaw: z.boolean().optional(),
        profile: z.enum(['login', 'public', 'flow']).optional(),
        profileDir: z.string().min(1).optional(),
        chromePath: z.string().min(1).optional(),
        headless: z.boolean().optional(),
        forceHeadless: z.boolean().optional(),
        keepChromeOpen: z.boolean().optional()
      }
    },
    async (input) => jsonToolResult(await discoverInstagramCompetitors(input))
  )

  await server.connect(new StdioServerTransport())
}

function jsonToolResult(value: unknown): {
  content: Array<{ type: 'text'; text: string }>
} {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(value, null, 2)
      }
    ]
  }
}
