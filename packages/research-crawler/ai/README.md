# AI Setup

Copy these files into any AI client that supports skills and MCP servers.

## 1. Install The Binary

Download or build the executable for your OS:

```text
research-crawler.exe   # Windows
research-crawler       # macOS/Linux
```

Put it somewhere stable, for example:

```text
C:/Tools/research-crawler/research-crawler.exe
/Applications/research-crawler/research-crawler
/usr/local/bin/research-crawler
```

## 2. Add MCP

Copy one config from `ai/mcp/` and update `command` to the real executable path:

```text
ai/mcp/research-crawler.windows.json
ai/mcp/research-crawler.macos.json
ai/mcp/research-crawler.linux.json
ai/mcp/research-crawler.dev.json
```

Most MCP clients use this shape:

```json
{
  "mcpServers": {
    "research-crawler": {
      "command": "C:/Tools/research-crawler/research-crawler.exe",
      "args": ["mcp"]
    }
  }
}
```

Restart the AI client after adding the server.

## 3. Add Skill

Copy this folder into the AI client's skills directory:

```text
ai/skills/research-crawler
```

The skill tells the assistant when to use the MCP tools and how to handle results.

## 4. Test

Ask the AI:

```text
Use Research Crawler to open Chrome for Instagram research.
```

Expected MCP tool:

```text
open_chrome
```

Then ask:

```text
Capture Instagram data for @example.
```

Expected MCP tool:

```text
capture_instagram_profile
```
