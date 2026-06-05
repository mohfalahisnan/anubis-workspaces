# Anubis Scoped Content Memory Spec

> Implementation spec for adding scoped knowledge, workspace-aware retrieval, content context packs, similarity memory, and experience memory into **Anubis AI Content OS**.

---

## 1. Product Name

```txt
Anubis Scoped Content Memory
```

Suggested package name:

```txt
@anubis/content-memory
```

---

## 2. Purpose

Anubis needs a scoped knowledge and memory layer that helps AI generate, review, and improve social media content using the correct business context.

The system must support:

```txt
Global content knowledge
+ Workspace-specific brand memory
+ Platform-specific rules
+ Similarity index
+ Decision memory
+ Experience index
+ Validator feedback
```

The goal is not only search. The goal is to generate an **AI-ready Content Context Pack** for every content operation.

---

## 3. Core Problem

The current similarity index can retrieve similar content, but it lacks proper scope isolation.

This creates several risks:

```txt
1. Wrong context retrieved from unrelated workspace
2. Platform-specific content style mixed incorrectly
3. Global advice overriding brand-specific rules
4. Client data leakage between workspaces
5. AI repeating past mistakes because reviewer feedback is not reused
```

---

## 4. Core Principle

```txt
Scope filtering must happen before ranking.
```

Bad:

```ts
const results = await searchAllKnowledge(query)
return filterByWorkspace(results)
```

Good:

```ts
const results = await searchWithinScope({
  query,
  workspaceId,
  platform,
})
```

The system must never retrieve private workspace knowledge from another workspace, even if semantic similarity is high.

---

## 5. Knowledge Scope Model

### 5.1 Supported Scopes

```ts
type KnowledgeScope =
  | "global"
  | "workspace"
  | "platform"
  | "campaign"
  | "agent"
```

### 5.2 MVP Scopes

For the first implementation:

```ts
type MvpKnowledgeScope =
  | "global"
  | "workspace"
```

Platform should not be a separate scope at first. It should be a filter dimension.

```ts
type Platform =
  | "instagram"
  | "tiktok"
  | "youtube"
  | "facebook"
  | "linkedin"
  | "x"
  | "threads"
  | "general"
```

---

## 6. Scope Definitions

### 6.1 Global Knowledge

Global knowledge is reusable across all workspaces.

Examples:

```txt
- Social media strategy principles
- Copywriting frameworks
- Hook formulas
- CTA patterns
- Platform algorithm notes
- General content SOP
- Generic content anti-patterns
- Global AI workflow rules
- General validation rules
```

Global knowledge answers:

```txt
“What is generally true?”
“What framework should we use?”
“What content structure works for this platform?”
```

### 6.2 Workspace Knowledge

Workspace knowledge is specific to one business, client, brand, or team.

Examples:

```txt
- Brand guideline
- Tone of voice
- Product/service details
- Target audience
- Competitor list
- Past approved posts
- Past rejected posts
- Campaign brief
- Client preferences
- Workspace-specific restrictions
- Previous reviewer feedback
- Workspace-specific AI mistakes
```

Workspace knowledge answers:

```txt
“What is true for this brand?”
“What has worked before?”
“What must AI avoid for this client?”
```

### 6.3 Platform Context

Platform is a context dimension.

The same workspace can have different rules per platform.

Example:

```txt
Instagram:
- polished caption
- carousel-friendly
- visual-first

TikTok:
- faster hook
- more casual
- trend-aware

LinkedIn:
- professional
- insight-driven
- lower hype
```

---

## 7. Conflict Resolution

When multiple knowledge sources conflict, priority must be:

```txt
1. Workspace safety/compliance rules
2. Campaign brief
3. Brand guideline
4. Workspace approved/rejected history
5. Workspace platform-specific memory
6. Global platform knowledge
7. Global content framework
```

Example:

```txt
Global KB:
Use aggressive hooks for TikTok.

Workspace KB:
This brand avoids fear-based hooks.

Result:
AI must avoid fear-based hooks.
```

---

## 8. Required Packages

Recommended package split:

```txt
packages/
  content-memory-core/
  content-memory-storage/
  content-memory-ingestion/
  content-memory-retrieval/
  content-context-pack/
  content-similarity/
  experience-index/
  content-validators/
```

### 8.1 `content-memory-core`

Shared types, interfaces, constants.

Contains:

```txt
- Entity types
- Repository contracts
- Retrieval policies
- Context pack contracts
- Validator interfaces
```

### 8.2 `content-memory-storage`

Database implementation.

Responsibilities:

```txt
- Documents
- Chunks
- Embeddings
- Relations
- Decisions
- Experience memories
- Agent runs
- Validation results
```

### 8.3 `content-memory-ingestion`

Handles source ingestion.

Responsibilities:

```txt
- Import documents
- Extract text
- Normalize content
- Chunk content
- Generate embeddings
- Store documents/chunks
```

### 8.4 `content-memory-retrieval`

Handles scoped search.

Responsibilities:

```txt
- Scope filtering
- Platform filtering
- Hybrid search
- Similarity search
- Keyword search
- Reranking
- Deduplication
```

### 8.5 `content-context-pack`

Builds AI-ready context.

Responsibilities:

```txt
- Retrieve brand context
- Retrieve similar content
- Retrieve global frameworks
- Retrieve mistakes/rules
- Format context pack
- Compress context
- Attach citations
```

### 8.6 `content-similarity`

Wraps the existing similarity index.

Responsibilities:

```txt
- Similar approved content
- Similar rejected content
- Similar competitor content
- Content pattern extraction
- Content cluster discovery
```

### 8.7 `experience-index`

Stores feedback and mistakes.

Responsibilities:

```txt
- AI run trace
- Reviewer feedback
- Mistake memory
- Workflow rules
- Validation rules
- Future prevention rules
```

### 8.8 `content-validators`

Validates AI output before human review.

Responsibilities:

```txt
- Workspace leakage check
- Brand guideline check
- Repeated mistake check
- Platform rule check
- Citation/source check
- Sensitive data check
```

---

## 9. Database Model

### 9.1 `knowledge_documents`

```ts
type KnowledgeDocument = {
  id: string

  scope: "global" | "workspace"
  workspaceId: string | null

  platform:
    | "instagram"
    | "tiktok"
    | "youtube"
    | "facebook"
    | "linkedin"
    | "x"
    | "threads"
    | "general"
    | null

  sourceType:
    | "brand_guideline"
    | "competitor_post"
    | "approved_post"
    | "rejected_post"
    | "campaign_brief"
    | "manual_note"
    | "platform_rule"
    | "global_framework"
    | "sop"
    | "ai_feedback"
    | "transcript"
    | "ocr"
    | "file"

  title: string
  extractedText: string
  summary: string | null

  tags: string[]
  topics: string[]
  entities: string[]

  status: "active" | "archived" | "deprecated"

  contentHash: string

  createdAt: Date
  updatedAt: Date
}
```

Rules:

```txt
If scope = global:
  workspaceId must be null

If scope = workspace:
  workspaceId is required

If platform = null:
  document applies to all platforms

If status = deprecated:
  document should not be used unless explicitly requested
```

### 9.2 `knowledge_chunks`

```ts
type KnowledgeChunk = {
  id: string
  documentId: string

  scope: "global" | "workspace"
  workspaceId: string | null
  platform: string | null

  sourceType: KnowledgeDocument["sourceType"]

  content: string
  summary: string | null

  tokenCount: number
  order: number
  sectionPath: string[] | null

  embeddingId: string | null
  contentHash: string

  createdAt: Date
  updatedAt: Date
}
```

Important:

```txt
scope, workspaceId, platform, and sourceType are duplicated on chunks for faster and safer retrieval.
```

### 9.3 `content_similarity_items`

```ts
type ContentSimilarityItem = {
  id: string

  workspaceId: string
  platform: string

  contentId: string

  contentType:
    | "competitor_post"
    | "own_post"
    | "approved_post"
    | "rejected_post"
    | "generated_draft"

  caption: string | null
  transcript: string | null
  ocrText: string | null
  visualDescription: string | null

  normalizedText: string
  embeddingId: string

  performanceScore: number | null
  engagementScore: number | null
  brandFitScore: number | null

  approvalStatus:
    | "approved"
    | "rejected"
    | "needs_review"
    | null

  rejectionReason: string | null

  createdAt: Date
  updatedAt: Date
}
```

Rule:

```txt
Similarity items must always be workspace-scoped.
```

Do not allow cross-workspace similarity retrieval unless explicitly enabled for anonymized/global learning later.

### 9.4 `experience_memories`

```ts
type ExperienceMemory = {
  id: string

  scope:
    | "global"
    | "workspace"
    | "platform"
    | "campaign"
    | "agent"

  workspaceId: string | null
  platform: string | null
  campaignId: string | null
  agentId: string | null

  type:
    | "mistake"
    | "correction"
    | "workflow_rule"
    | "validation_rule"
    | "preference"
    | "anti_pattern"
    | "lesson"

  title: string
  problem: string
  cause: string | null
  correction: string
  triggerPattern: string | null
  preventionRule: string | null

  severity:
    | "low"
    | "medium"
    | "high"
    | "critical"

  status:
    | "candidate"
    | "active"
    | "reinforced"
    | "deprecated"
    | "rejected"

  usageCount: number
  successCount: number
  failureCount: number
  confidence: number

  sourceRunId: string | null
  sourceDocumentId: string | null

  createdAt: Date
  updatedAt: Date
}
```

Lifecycle:

```txt
candidate → active → reinforced → deprecated/rejected
```

### 9.5 `agent_runs`

```ts
type AgentRun = {
  id: string

  workspaceId: string
  platform: string | null
  campaignId: string | null

  agentId: string
  workflowId: string | null

  taskType:
    | "analyze_competitor"
    | "build_brief"
    | "generate_content"
    | "rewrite_content"
    | "review_content"
    | "create_calendar"

  userInput: string
  intent: string

  retrievedChunkIds: string[]
  retrievedDecisionIds: string[]
  retrievedExperienceMemoryIds: string[]
  retrievedSimilarityItemIds: string[]

  contextPackId: string | null

  plan: string | null
  output: string

  validationStatus:
    | "passed"
    | "failed"
    | "needs_review"

  humanFeedback: string | null
  errorType: string | null
  errorSummary: string | null

  createdAt: Date
}
```

### 9.6 `content_context_packs`

```ts
type ContentContextPackRecord = {
  id: string

  workspaceId: string
  platform: string
  campaignId: string | null

  taskType: AgentRun["taskType"]

  objective: string
  query: string

  contextJson: ContentContextPack

  tokenCount: number

  createdAt: Date
}
```

---

## 10. Retrieval Policy

### 10.1 Retrieval Context

```ts
type RetrievalContext = {
  workspaceId: string
  platform: Platform

  taskType:
    | "analyze_competitor"
    | "build_brief"
    | "generate_content"
    | "rewrite_content"
    | "review_content"
    | "create_calendar"

  campaignId?: string
  brandId?: string

  includeGlobal: boolean
  includeWorkspace: boolean
  includePlatform: boolean
  includeExperience: boolean
  includeRejectedExamples: boolean

  maxTokens: number
}
```

### 10.2 Default Policy

```ts
const defaultRetrievalPolicy = {
  includeGlobal: true,
  includeWorkspace: true,
  includePlatform: true,
  includeExperience: true,
  includeRejectedExamples: true,
  maxTokens: 6000,
}
```

---

## 11. Retrieval Rules

### 11.1 Workspace Retrieval

Workspace query must only return:

```txt
scope = global
OR workspaceId = currentWorkspaceId
```

SQL-like condition:

```sql
WHERE
  (
    scope = 'global'
    OR workspace_id = :workspaceId
  )
```

### 11.2 Platform Retrieval

Platform query must only return:

```txt
platform IS NULL
OR platform = currentPlatform
OR platform = 'general'
```

SQL-like condition:

```sql
AND (
  platform IS NULL
  OR platform = :platform
  OR platform = 'general'
)
```

### 11.3 Status Retrieval

Default:

```txt
status = active
```

Deprecated content should only be returned if explicitly requested.

```sql
AND status = 'active'
```

---

## 12. Ranking Formula

Retrieval should not rank by vector similarity alone.

Suggested scoring:

```ts
type RankingWeights = {
  semanticSimilarity: number
  keywordMatch: number
  workspaceBoost: number
  platformBoost: number
  sourceTypeBoost: number
  recencyBoost: number
  approvalBoost: number
  deprecatedPenalty: number
  rejectedPenalty: number
}
```

Default:

```ts
const rankingWeights: RankingWeights = {
  semanticSimilarity: 0.45,
  keywordMatch: 0.15,
  workspaceBoost: 0.15,
  platformBoost: 0.1,
  sourceTypeBoost: 0.05,
  recencyBoost: 0.05,
  approvalBoost: 0.05,
  deprecatedPenalty: -0.5,
  rejectedPenalty: -0.2,
}
```

Important:

```txt
Rejected content should not be treated as positive examples.
It should be routed into “patterns to avoid”.
```

---

## 13. Content Context Pack

### 13.1 Type

```ts
type ContentContextPack = {
  workspaceId: string
  platform: Platform
  taskType: string

  objective: string

  brandContext: {
    brandSummary: string
    toneOfVoice: string[]
    audience: string[]
    offers: string[]
    constraints: string[]
  }

  campaignContext?: {
    campaignName: string
    goal: string
    keyMessage: string
    offer: string | null
    deadline: string | null
    constraints: string[]
  }

  platformContext: {
    platform: Platform
    formatRules: string[]
    contentPatterns: string[]
    algorithmNotes: string[]
  }

  similarContent: {
    approved: SimilarContent[]
    competitor: SimilarContent[]
    rejected: SimilarContent[]
  }

  globalFrameworks: {
    hooks: string[]
    copywritingPatterns: string[]
    contentStructures: string[]
    ctaPatterns: string[]
  }

  workspaceRules: {
    mustFollow: string[]
    mustAvoid: string[]
    clientPreferences: string[]
  }

  experienceMemory: {
    previousMistakes: string[]
    reviewerFeedback: string[]
    validationRules: string[]
  }

  citations: Citation[]

  finalInstruction: string
}
```

### 13.2 `SimilarContent`

```ts
type SimilarContent = {
  id: string
  contentType:
    | "competitor_post"
    | "own_post"
    | "approved_post"
    | "rejected_post"
    | "generated_draft"

  platform: Platform

  text: string
  reason: string

  performanceScore?: number
  engagementScore?: number
  brandFitScore?: number

  approvalStatus?: "approved" | "rejected" | "needs_review"
  rejectionReason?: string
}
```

### 13.3 `Citation`

```ts
type Citation = {
  sourceId: string
  sourceType:
    | "knowledge_document"
    | "knowledge_chunk"
    | "similarity_item"
    | "experience_memory"
    | "decision"

  title: string
  excerpt: string
}
```

---

## 14. Context Pack Sections

The generated context pack must separate positive and negative memory.

Required sections:

```txt
1. Objective
2. Brand context
3. Platform context
4. Similar approved content
5. Similar competitor content
6. Rejected content / patterns to avoid
7. Global frameworks
8. Workspace rules
9. Previous mistakes
10. Final AI instruction
11. Citations
```

Do not mix rejected content with approved examples.

---

## 15. Main Backend Service

Create one backend-facing orchestration service.

```ts
class ContentMemoryService {
  constructor(
    private retrieval: RetrievalService,
    private contextPack: ContextPackService,
    private similarity: ContentSimilarityService,
    private experience: ExperienceIndexService,
    private validators: ValidationService,
  ) {}

  async buildForContentTask(
    input: BuildContentContextInput,
  ): Promise<ContentContextPack> {
    // 1. Validate workspace access
    // 2. Enforce retrieval scope
    // 3. Retrieve workspace KB
    // 4. Retrieve global KB
    // 5. Retrieve platform context
    // 6. Retrieve similar content
    // 7. Retrieve mistakes/rules
    // 8. Build context pack
    // 9. Validate no workspace leakage
    // 10. Return AI-ready context
  }
}
```

Input:

```ts
type BuildContentContextInput = {
  workspaceId: string
  platform: Platform
  taskType: RetrievalContext["taskType"]

  query: string
  objective: string

  campaignId?: string
  brandId?: string

  competitorPostId?: string
  sourceContentId?: string

  maxTokens?: number
}
```

---

## 16. Public Package API

### 16.1 Create Knowledge Document

```ts
type CreateKnowledgeDocumentInput = {
  scope: "global" | "workspace"
  workspaceId?: string | null
  platform?: Platform | null

  sourceType: KnowledgeDocument["sourceType"]

  title: string
  text: string

  tags?: string[]
  topics?: string[]
  entities?: string[]
}
```

```ts
interface KnowledgeService {
  createDocument(
    input: CreateKnowledgeDocumentInput,
  ): Promise<KnowledgeDocument>
}
```

### 16.2 Search Scoped Knowledge

```ts
type SearchKnowledgeInput = {
  workspaceId: string
  platform: Platform
  query: string

  sourceTypes?: KnowledgeDocument["sourceType"][]
  includeGlobal?: boolean
  includeWorkspace?: boolean

  limit?: number
  maxTokens?: number
}
```

```ts
interface RetrievalService {
  searchKnowledge(input: SearchKnowledgeInput): Promise<ScoredChunk[]>
}
```

### 16.3 Build Context Pack

```ts
interface ContextPackService {
  buildContentContextPack(
    input: BuildContentContextInput,
  ): Promise<ContentContextPack>
}
```

### 16.4 Save Agent Run

```ts
type SaveAgentRunInput = {
  workspaceId: string
  platform?: Platform
  campaignId?: string

  agentId: string
  workflowId?: string

  taskType: AgentRun["taskType"]

  userInput: string
  intent: string

  contextPackId?: string
  output: string

  retrievedChunkIds: string[]
  retrievedDecisionIds?: string[]
  retrievedExperienceMemoryIds?: string[]
  retrievedSimilarityItemIds?: string[]

  validationStatus: AgentRun["validationStatus"]

  humanFeedback?: string
  errorType?: string
  errorSummary?: string
}
```

```ts
interface AgentRunService {
  saveRun(input: SaveAgentRunInput): Promise<AgentRun>
}
```

### 16.5 Save Feedback

```ts
type SaveFeedbackInput = {
  runId: string
  workspaceId: string

  rating:
    | "good"
    | "bad"
    | "partial"

  feedback: string

  createExperienceMemory?: boolean
  memoryType?: ExperienceMemory["type"]
  severity?: ExperienceMemory["severity"]
}
```

```ts
interface ExperienceIndexService {
  saveFeedback(input: SaveFeedbackInput): Promise<void>
}
```

---

## 17. Validators

### 17.1 Validator Interface

```ts
interface OutputValidator {
  name: string

  validate(input: {
    workspaceId: string
    platform: Platform
    contextPack: ContentContextPack
    output: string
  }): Promise<ValidationResult>
}
```

```ts
type ValidationResult = {
  passed: boolean
  severity?: "low" | "medium" | "high" | "critical"
  issues: ValidationIssue[]
}
```

```ts
type ValidationIssue = {
  type:
    | "workspace_leakage"
    | "brand_violation"
    | "platform_violation"
    | "repeated_mistake"
    | "missing_context"
    | "unsupported_claim"
    | "format_error"
    | "sensitive_data"

  message: string
  relatedMemoryId?: string
  suggestedCorrection?: string
}
```

### 17.2 Required MVP Validators

```txt
1. WorkspaceLeakageValidator
2. BrandRuleValidator
3. RepeatedMistakeValidator
4. PlatformRuleValidator
```

---

## 18. Updated Anubis Workflow

```txt
Competitor post
→ Post crawler
→ OCR / transcript / caption extractor
→ Output transformer
→ Scoped Context Builder
   ├── Workspace KB
   ├── Global KB
   ├── Platform context
   ├── Similarity index
   ├── Decision memory
   └── Experience index
→ Agent executor
→ Agent reviewer
→ Validators
→ Human review
→ Approved / Rejected
→ Store feedback into Workspace KB + Experience Index
```

---

## 19. Feedback Loop

### 19.1 Approved Content

Store as:

```txt
sourceType = approved_post
approvalStatus = approved
```

Use for future positive examples.

### 19.2 Rejected Content

Store as:

```txt
sourceType = rejected_post
approvalStatus = rejected
rejectionReason = reviewer reason
```

Use only in:

```txt
Patterns to avoid
Previous mistakes
Reviewer feedback
```

### 19.3 Reviewer Correction

If reviewer says:

```txt
“This brand never uses aggressive fear-based hooks.”
```

Create candidate experience memory:

```ts
{
  type: "workflow_rule",
  scope: "workspace",
  title: "Avoid fear-based hooks",
  problem: "AI generated aggressive fear-based hooks.",
  correction: "Use soft educational hooks instead.",
  triggerPattern: "hook generation",
  preventionRule: "Before generating hooks, check workspace hook restrictions.",
  severity: "medium",
  status: "candidate"
}
```

Human can approve it into:

```txt
active
```

---

## 20. Security Requirements

### 20.1 Workspace Isolation

Strict rule:

```txt
Workspace data must never be retrieved for another workspace.
```

Required enforcement:

```txt
1. Repository-level filtering
2. Service-level validation
3. Validator-level leakage check
4. Test coverage for cross-workspace isolation
```

### 20.2 Sensitive Data

Documents can later support sensitivity level:

```ts
type Sensitivity =
  | "public"
  | "internal"
  | "private"
  | "secret"
```

MVP can default all workspace content to:

```txt
internal
```

### 20.3 AI Context Minimization

The AI should only receive the minimum required context.

Default behavior:

```txt
Do not include entire documents
Do not include unrelated workspace knowledge
Do not include deprecated content
Do not include secret content
```

---

## 21. Implementation Phases

### Phase 1 — Scope Foundation

Goal: make current KB and similarity engine workspace-safe.

Tasks:

```txt
1. Add scope field
2. Add workspaceId field
3. Add platform field
4. Add sourceType field
5. Update retrieval filters
6. Add workspace isolation tests
```

Acceptance criteria:

```txt
- Workspace A cannot retrieve Workspace B knowledge
- Global knowledge can be retrieved by all workspaces
- Platform-specific content only appears for matching platform
```

### Phase 2 — Scoped Context Pack

Goal: generate structured context for content tasks.

Tasks:

```txt
1. Build ContentContextPack type
2. Retrieve brand context
3. Retrieve platform context
4. Retrieve similar content
5. Separate approved/rejected examples
6. Generate final AI instruction
7. Add citations
```

Acceptance criteria:

```txt
- Context pack includes workspace KB
- Context pack includes global KB
- Context pack separates approved and rejected examples
- Context pack has citations/source references
```

### Phase 3 — Experience Index

Goal: make AI learn from review feedback.

Tasks:

```txt
1. Save agent runs
2. Save reviewer feedback
3. Add mistake memory
4. Add workflow rule memory
5. Retrieve relevant memories during context building
```

Acceptance criteria:

```txt
- Rejected content stores rejection reason
- Reviewer correction can become candidate memory
- Active memories appear in future context packs
```

### Phase 4 — Validators

Goal: reduce repeated mistakes and unsafe output.

Tasks:

```txt
1. Workspace leakage validator
2. Brand rule validator
3. Platform rule validator
4. Repeated mistake validator
5. Validation result storage
```

Acceptance criteria:

```txt
- Output is flagged when it violates workspace rules
- Output is flagged when it repeats known mistakes
- Output is flagged if context contains another workspace source
```

### Phase 5 — Agent Integration

Goal: wire memory into Anubis execution flow.

Tasks:

```txt
1. Connect context pack to Agent Executor
2. Connect validators before human review
3. Feed approval/rejection back into memory
4. Save full agent run trace
```

Acceptance criteria:

```txt
- Every AI content task has a saved context pack
- Every AI output has a saved run trace
- Approved/rejected results update future retrieval
```

---

## 22. Testing Requirements

### 22.1 Scope Isolation Test

```ts
it("does not retrieve chunks from another workspace", async () => {
  await createWorkspaceDocument("workspace-a", "Skincare brand A")
  await createWorkspaceDocument("workspace-b", "Skincare brand B")

  const results = await retrieval.searchKnowledge({
    workspaceId: "workspace-a",
    platform: "instagram",
    query: "skincare",
  })

  expect(results.every(r =>
    r.scope === "global" || r.workspaceId === "workspace-a"
  )).toBe(true)
})
```

### 22.2 Global Knowledge Test

```ts
it("allows global knowledge across workspaces", async () => {
  await createGlobalDocument("Instagram hook framework")

  const results = await retrieval.searchKnowledge({
    workspaceId: "workspace-a",
    platform: "instagram",
    query: "hook framework",
  })

  expect(results.some(r => r.scope === "global")).toBe(true)
})
```

### 22.3 Platform Filter Test

```ts
it("does not retrieve TikTok-specific rule for Instagram task", async () => {
  await createGlobalDocument("TikTok trend hook", {
    platform: "tiktok",
  })

  const results = await retrieval.searchKnowledge({
    workspaceId: "workspace-a",
    platform: "instagram",
    query: "trend hook",
  })

  expect(results.every(r => r.platform !== "tiktok")).toBe(true)
})
```

### 22.4 Rejected Content Test

```ts
it("routes rejected content into patterns to avoid", async () => {
  const pack = await contextPack.buildContentContextPack({
    workspaceId: "workspace-a",
    platform: "instagram",
    taskType: "generate_content",
    query: "create skincare campaign post",
    objective: "Generate post",
  })

  expect(pack.similarContent.rejected).toBeDefined()
  expect(pack.similarContent.approved).not.toContainEqual(
    expect.objectContaining({ approvalStatus: "rejected" })
  )
})
```

---

## 23. Non-Goals for MVP

Do not build these first:

```txt
1. Full visual graph
2. Complex workflow engine
3. Multi-workspace shared learning
4. Auto-fine-tuning
5. Fully autonomous agent execution
6. Complex permission model beyond workspace isolation
```

These can come later after scoped retrieval is stable.

---

## 24. MVP Success Criteria

The MVP is successful if:

```txt
1. AI can generate a context pack for a workspace/platform task
2. Context pack uses both global and workspace knowledge
3. AI retrieves similar approved content
4. AI sees rejected patterns separately
5. AI avoids previous workspace mistakes
6. No cross-workspace leakage happens
7. Every generated output can be traced back to sources
```

---

## 25. Final Architecture

```txt
Anubis AI Content OS
└── Scoped Content Memory
    ├── Global Knowledge
    │   ├── content frameworks
    │   ├── platform rules
    │   └── general SOP
    │
    ├── Workspace Knowledge
    │   ├── brand guideline
    │   ├── audience
    │   ├── campaign brief
    │   ├── approved posts
    │   └── rejected posts
    │
    ├── Similarity Index
    │   ├── approved content
    │   ├── competitor content
    │   └── rejected content
    │
    ├── Experience Index
    │   ├── mistakes
    │   ├── corrections
    │   ├── reviewer feedback
    │   └── workflow rules
    │
    ├── Retrieval Engine
    │   ├── scope filter
    │   ├── platform filter
    │   ├── hybrid search
    │   └── reranking
    │
    ├── Context Pack Builder
    │   ├── brand context
    │   ├── platform context
    │   ├── similar content
    │   ├── rules to avoid
    │   └── final AI instruction
    │
    └── Validators
        ├── workspace leakage
        ├── brand rule
        ├── platform rule
        └── repeated mistake
```

The most important implementation constraint remains:

```txt
Workspace and platform filtering must happen before retrieval ranking.
```
