import { useEffect, useMemo, useState } from 'react'
import { ArrowLeftIcon, CheckIcon, CopyIcon, FolderIcon, FolderOpenIcon, PlusIcon, XIcon } from 'lucide-react'

import type { AgentKind, ProfileSummary, SkillSummary } from '@anubis/shared'

import {
  getCatalog,
  getProfile,
  listSkills,
  updateProfile,
  type AgentCatalog,
} from '@/api'
import { cn } from '@/lib/utils'
import { useNavigation } from '@/lib/navigation'
import { ModelSelect } from '@/components/model-select'

/* -----------------------------------------------------------
   Profile editor
   -----------------------------------------------------------
   Full-page form for editing a profile. Loads the live profile
   and the ai-agent catalog (model list per agent), lets the
   user tweak identity + agent/model/reasoning + runtime knobs
   + a freeform system prompt, then PATCHes the result.

   Backend semantics:
   - For user profiles, configPatch is shallow-merged onto the
     existing config.
   - For built-in profiles, configPatch becomes a `profile_overrides`
     row layered on top of the canonical defaults. Deleting the
     profile (via the Delete action on the list page) clears
     this override.
   ----------------------------------------------------------- */

type PermissionMode = 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions'
type SandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access'
type ApprovalPolicy = 'untrusted' | 'on-request' | 'on-failure' | 'never'
type ReasoningEffort = 'minimal' | 'low' | 'medium' | 'high'

interface EnvRow {
  /** Stable per-row id so React keys don't shuffle as the user edits. */
  id: string
  key: string
  value: string
}

interface FormState {
  name: string
  description: string
  agent: AgentKind
  model: string
  reasoningEffort: ReasoningEffort
  permissionMode: PermissionMode | ''
  sandboxMode: SandboxMode | ''
  approvalPolicy: ApprovalPolicy | ''
  claudeCliProfile: string
  appendSystemPrompt: string
  /** Lines (one tool per line). */
  allowedTools: string
  disallowedTools: string
  env: EnvRow[]
  /** Names of opt-in / user skills the user has explicitly turned on. */
  enabledSkills: string[]
  /** Names of builtin-auto skills the user has explicitly turned off. */
  disabledBuiltinSkills: string[]
}

const PERMISSION_MODES: PermissionMode[] = ['default', 'acceptEdits', 'plan', 'bypassPermissions']
const SANDBOX_MODES: SandboxMode[] = ['read-only', 'workspace-write', 'danger-full-access']
const APPROVAL_POLICIES: ApprovalPolicy[] = ['untrusted', 'on-request', 'on-failure', 'never']

type Banner = { kind: 'error' | 'success'; message: string }

export function ProfileEditorPage({ profileId }: { profileId: string }) {
  const { navigate } = useNavigation()
  const [profile, setProfile] = useState<ProfileSummary | null>(null)
  const [catalog, setCatalog] = useState<AgentCatalog | null>(null)
  const [skills, setSkills] = useState<SkillSummary[] | null>(null)
  const [form, setForm] = useState<FormState | null>(null)
  const [initial, setInitial] = useState<FormState | null>(null)
  const [busy, setBusy] = useState(false)
  const [banner, setBanner] = useState<Banner | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    Promise.all([getProfile(profileId), getCatalog(), listSkills()])
      .then(([p, c, s]) => {
        if (!active) return
        const f = formStateFromProfile(p, c)
        setProfile(p)
        setCatalog(c)
        setSkills(s)
        setForm(f)
        setInitial(f)
      })
      .catch((e: unknown) => {
        if (!active) return
        setLoadError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      active = false
    }
  }, [profileId])

  const dirty = useMemo(() => {
    if (!form || !initial) return false
    return JSON.stringify(form) !== JSON.stringify(initial)
  }, [form, initial])

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev))
  }

  function onAgentChange(agent: AgentKind) {
    if (!form || !catalog) return
    const defaultModel = catalog.defaultModel[agent]
    const known = catalog.models[agent].some((m) => m.id === form.model)
    setForm({
      ...form,
      agent,
      model: known ? form.model : defaultModel,
      // Reset runtime knobs that don't apply to the new agent. Permission mode
      // applies to claude and antigravity (agy maps bypassPermissions onto
      // --dangerously-skip-permissions); sandbox/approval are codex-only;
      // the Claude CLI profile is claude-only.
      permissionMode: agent === 'claude' || agent === 'antigravity' ? form.permissionMode : '',
      sandboxMode: agent === 'codex' ? form.sandboxMode : '',
      approvalPolicy: agent === 'codex' ? form.approvalPolicy : '',
      claudeCliProfile: agent === 'claude' ? form.claudeCliProfile : '',
    })
  }

  async function handleSave() {
    if (!form || !profile) return
    setBusy(true)
    setBanner(null)
    try {
      const next = await updateProfile(profileId, {
        name: form.name.trim(),
        description: form.description.trim() ? form.description.trim() : undefined,
        configPatch: buildConfigPatch(form),
      })
      const refreshedCatalog = catalog ?? (await getCatalog())
      const f = formStateFromProfile(next, refreshedCatalog)
      setProfile(next)
      setForm(f)
      setInitial(f)
      setBanner({ kind: 'success', message: 'Saved.' })
    } catch (e) {
      setBanner({
        kind: 'error',
        message: e instanceof Error ? e.message : 'Could not save the profile.',
      })
    } finally {
      setBusy(false)
    }
  }

  function handleCancel() {
    if (dirty) {
      const ok = window.confirm('Discard unsaved changes?')
      if (!ok) return
    }
    navigate({ page: 'profiles' })
  }

  if (loadError) {
    return (
      <div className='flex flex-1 items-center justify-center bg-background px-6 py-10'>
        <div className='max-w-md rounded-md border border-border bg-card p-5 text-center'>
          <h2 className='text-[16px] font-semibold text-destructive'>
            Couldn't load this profile
          </h2>
          <p className='mt-2 text-[13px] text-muted-foreground'>{loadError}</p>
          <button
            type='button'
            onClick={() => navigate({ page: 'profiles' })}
            className='mt-4 inline-flex h-9 items-center gap-1.5 rounded-md border border-border px-3.5 text-[13px] font-medium text-foreground transition-colors hover:bg-muted'
          >
            Back to Profiles
          </button>
        </div>
      </div>
    )
  }

  if (!form || !profile || !catalog) {
    return (
      <div className='flex flex-1 items-center justify-center bg-background px-6 py-10'>
        <div className='font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground'>
          Loading profile…
        </div>
      </div>
    )
  }

  const isBuiltin = profile.source === 'builtin'
  const models = catalog.models[form.agent]
  const isClaude = form.agent === 'claude'
  const isCodex = form.agent === 'codex'
  // claude and antigravity both expose a permission-mode knob.
  const hasPermissionMode = isClaude || form.agent === 'antigravity'

  return (
    <div className='flex flex-1 flex-col overflow-y-auto bg-background'>
      <div className='mx-auto w-full max-w-[860px] px-7 pb-16'>
        {/* Header */}
        <div className='flex flex-col gap-4 pt-7'>
          <button
            type='button'
            onClick={handleCancel}
            className='inline-flex w-fit items-center gap-1.5 text-[12.5px] text-muted-foreground transition-colors hover:text-foreground'
          >
            <ArrowLeftIcon className='size-3.5' strokeWidth={2} />
            Back to Profiles
          </button>

          <div className='flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between'>
            <div>
              <div className='flex items-center gap-2'>
                <h1 className='text-[28px] font-semibold leading-[1.1] tracking-[-0.025em]'>
                  Edit profile
                </h1>
                <SourceBadge source={profile.source} />
              </div>
              <p className='mt-1.5 font-mono text-[12px] text-muted-foreground'>
                {profile.id}
              </p>
              {isBuiltin && (
                <p className='mt-2 text-[12.5px] text-muted-foreground'>
                  Edits are saved as a personal override layered on top of the built-in
                  defaults. Use Delete on the list to clear the override.
                </p>
              )}
            </div>

            <div className='flex shrink-0 items-center gap-2'>
              <button
                type='button'
                onClick={handleCancel}
                disabled={busy}
                className='inline-flex h-9 items-center gap-1.5 rounded-md px-3.5 text-[13.5px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50'
              >
                Cancel
              </button>
              <button
                type='button'
                onClick={() => void handleSave()}
                disabled={busy || !dirty || !form.name.trim() || !form.model.trim()}
                className={cn(
                  'inline-flex h-9 items-center gap-1.5 rounded-md px-4 text-[13.5px] font-semibold transition-colors',
                  busy || !dirty || !form.name.trim() || !form.model.trim()
                    ? 'cursor-not-allowed bg-[var(--anubis-gold)] text-[#0B0C0F] opacity-50'
                    : 'bg-[var(--anubis-gold)] text-[#0B0C0F] hover:bg-[var(--anubis-gold-deep)]',
                )}
              >
                {busy ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}
              </button>
            </div>
          </div>
        </div>

        {banner && (
          <div
            role='status'
            className={cn(
              'mt-5 rounded-md border px-3.5 py-2.5 text-[13px]',
              banner.kind === 'error'
                ? 'border-[color-mix(in_oklab,var(--destructive)_40%,var(--border))] bg-[color-mix(in_oklab,var(--destructive)_10%,transparent)] text-destructive'
                : 'border-[color-mix(in_oklab,var(--anubis-gold)_40%,var(--border))] bg-[color-mix(in_oklab,var(--anubis-gold)_8%,transparent)] text-foreground',
            )}
          >
            {banner.message}
          </div>
        )}

        {/* Identity */}
        <Section title='Identity'>
          <Field label='Name' htmlFor='profile-name'>
            <input
              id='profile-name'
              type='text'
              value={form.name}
              onChange={(e) => update('name', e.target.value)}
              placeholder='e.g. Claude — Research'
              className={textInput}
            />
          </Field>

          <Field label='Description' htmlFor='profile-desc' hint='Shown on the profile card. One or two lines is enough.'>
            <textarea
              id='profile-desc'
              rows={2}
              value={form.description}
              onChange={(e) => update('description', e.target.value)}
              placeholder='What this profile is good for.'
              className={cn(textInput, 'h-auto min-h-[64px] resize-y py-2.5')}
            />
          </Field>
        </Section>

        {/* Profile home — read-only, surfaces the isolated config dir
            that Claude/Codex are pointed at via CLAUDE_CONFIG_DIR /
            CODEX_HOME. Useful for power users who want to drop
            credentials in by hand or inspect what Anubis wrote. */}
        {profile.home && (
          <Section
            title='Profile home'
            hint='Each profile has its own config / credentials / instruction folder. CLAUDE.md and AGENTS.md are auto-generated here.'
          >
            <ProfileHomePath
              path={profile.home.path}
              exists={profile.home.exists}
              hasCredentials={profile.home.hasCredentials}
            />
          </Section>
        )}

        {/* Agent & Model */}
        <Section title='Agent & Model'>
          <Field label='Agent'>
            <Segmented
              value={form.agent}
              onChange={(v) => onAgentChange(v as AgentKind)}
              options={[
                { value: 'claude', label: 'Claude' },
                { value: 'codex', label: 'Codex' },
                { value: 'antigravity', label: 'Antigravity' },
              ]}
            />
          </Field>

          <Field
            label='Model'
            htmlFor='profile-model'
            hint='Pick from the catalog or enter any model id the agent CLI accepts.'
          >
            <ModelSelect
              id='profile-model'
              models={models}
              value={form.model}
              onChange={(m) => update('model', m)}
              selectClassName={selectInput}
              inputClassName={textInput}
            />
          </Field>

          <Field label='Reasoning effort' hint='Higher tiers think longer and cost more tokens.'>
            <Segmented
              value={form.reasoningEffort}
              onChange={(v) => update('reasoningEffort', v as ReasoningEffort)}
              options={catalog.reasoningEfforts.map((r) => ({ value: r, label: r }))}
            />
          </Field>
        </Section>

        {/* Runtime — agent-conditional */}
        <Section title='Runtime'>
          {!isCodex ? (
            <>
              <Field
                label='Permission mode'
                htmlFor='profile-perm'
                hint={
                  isClaude
                    ? 'How Claude treats edits and shell calls.'
                    : 'bypassPermissions auto-approves all tool calls (agy --dangerously-skip-permissions). Other modes prompt as usual.'
                }
              >
                <select
                  id='profile-perm'
                  value={form.permissionMode}
                  onChange={(e) => update('permissionMode', e.target.value as PermissionMode | '')}
                  className={selectInput}
                >
                  <option value=''>— inherit —</option>
                  {PERMISSION_MODES.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </Field>

              {isClaude && (
                <Field
                  label='Claude CLI profile'
                  htmlFor='profile-cliprofile'
                  hint='Optional: a named profile from your Claude CLI config (passed to --profile).'
                >
                  <input
                    id='profile-cliprofile'
                    type='text'
                    value={form.claudeCliProfile}
                    onChange={(e) => update('claudeCliProfile', e.target.value)}
                    placeholder='leave empty to use the default'
                    className={textInput}
                  />
                </Field>
              )}
            </>
          ) : (
            <>
              <Field label='Sandbox mode' htmlFor='profile-sandbox' hint='Filesystem access scope for Codex.'>
                <select
                  id='profile-sandbox'
                  value={form.sandboxMode}
                  onChange={(e) => update('sandboxMode', e.target.value as SandboxMode | '')}
                  className={selectInput}
                >
                  <option value=''>— inherit —</option>
                  {SANDBOX_MODES.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </Field>

              <Field label='Approval policy' htmlFor='profile-approval' hint='When Codex pauses to ask before acting.'>
                <select
                  id='profile-approval'
                  value={form.approvalPolicy}
                  onChange={(e) => update('approvalPolicy', e.target.value as ApprovalPolicy | '')}
                  className={selectInput}
                >
                  <option value=''>— inherit —</option>
                  {APPROVAL_POLICIES.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </Field>
            </>
          )}
        </Section>

        {/* System prompt */}
        <Section title='System prompt'>
          <Field
            label='Append system prompt'
            htmlFor='profile-sp'
            hint='Prepended to the agent every turn. Skills are appended automatically beneath this.'
          >
            <textarea
              id='profile-sp'
              rows={6}
              value={form.appendSystemPrompt}
              onChange={(e) => update('appendSystemPrompt', e.target.value)}
              placeholder='You are in research mode. Cite sources. Prefer breadth-first exploration over premature synthesis.'
              className={cn(textInput, 'h-auto min-h-[148px] resize-y py-3 font-mono text-[12.5px] leading-[1.55]')}
            />
          </Field>
        </Section>

        {/* Skills */}
        <Section
          title='Skills'
          hint='Auto-injected skills are on by default — disable them per profile. Opt-in and user skills are off by default until you enable them here.'
        >
          <SkillsEditor
            skills={skills}
            enabled={form.enabledSkills}
            disabled={form.disabledBuiltinSkills}
            onChange={(next) =>
              setForm((prev) =>
                prev
                  ? {
                      ...prev,
                      enabledSkills: next.enabled,
                      disabledBuiltinSkills: next.disabled,
                    }
                  : prev,
              )
            }
          />
        </Section>

        {/* Environment variables */}
        <Section
          title='Environment variables'
          hint='Injected into the spawned CLI process. Useful for API keys, regional endpoints, or feature flags.'
        >
          <EnvEditor
            rows={form.env}
            onChange={(env) => update('env', env)}
          />
        </Section>

        {/* Tools */}
        <Section
          title='Tools'
          hint={
            isClaude
              ? 'Passed to Claude as --allowedTools / --disallowedTools. One pattern per line (e.g. Bash, Edit, mcp__github__*).'
              : 'Only Claude honours these directly today; stored for parity with Claude profiles.'
          }
        >
          <Field
            label='Allowed tools'
            htmlFor='profile-allowed'
            hint='If non-empty, ONLY these tools are available. One per line.'
          >
            <textarea
              id='profile-allowed'
              rows={4}
              value={form.allowedTools}
              onChange={(e) => update('allowedTools', e.target.value)}
              placeholder={'Bash\nEdit\nmcp__github__*'}
              className={cn(textInput, 'h-auto min-h-[96px] resize-y py-2.5 font-mono text-[12.5px] leading-[1.55]')}
            />
          </Field>

          <Field
            label='Disallowed tools'
            htmlFor='profile-disallowed'
            hint='Blocked even when in the allow list. One per line.'
          >
            <textarea
              id='profile-disallowed'
              rows={3}
              value={form.disallowedTools}
              onChange={(e) => update('disallowedTools', e.target.value)}
              placeholder={'Bash(rm *)\nWebFetch'}
              className={cn(textInput, 'h-auto min-h-[76px] resize-y py-2.5 font-mono text-[12.5px] leading-[1.55]')}
            />
          </Field>
        </Section>
      </div>
    </div>
  )
}

/* ---------- form helpers ---------- */

function formStateFromProfile(p: ProfileSummary, catalog: AgentCatalog): FormState {
  const cfg = p.config
  const agent = cfg.agent
  const model =
    typeof cfg.model === 'string' && cfg.model.length > 0
      ? cfg.model
      : catalog.defaultModel[agent]
  const reasoningEffort = isReasoning(cfg.reasoningEffort)
    ? (cfg.reasoningEffort as ReasoningEffort)
    : catalog.defaultReasoningEffort

  const envObj = (cfg.env as Record<string, string> | undefined) ?? {}
  const envRows: EnvRow[] = Object.entries(envObj).map(([key, value], i) => ({
    id: `env-${i}-${key}`,
    key,
    value,
  }))

  return {
    name: p.name,
    description: p.description ?? '',
    agent,
    model,
    reasoningEffort,
    permissionMode: isPermissionMode(cfg.permissionMode)
      ? (cfg.permissionMode as PermissionMode)
      : '',
    sandboxMode: isSandboxMode(cfg.sandboxMode)
      ? (cfg.sandboxMode as SandboxMode)
      : '',
    approvalPolicy: isApprovalPolicy(cfg.approvalPolicy)
      ? (cfg.approvalPolicy as ApprovalPolicy)
      : '',
    claudeCliProfile:
      typeof cfg.claudeCliProfile === 'string' ? cfg.claudeCliProfile : '',
    appendSystemPrompt:
      typeof cfg.appendSystemPrompt === 'string' ? cfg.appendSystemPrompt : '',
    allowedTools: Array.isArray(cfg.allowedTools) ? cfg.allowedTools.join('\n') : '',
    disallowedTools: Array.isArray(cfg.disallowedTools) ? cfg.disallowedTools.join('\n') : '',
    env: envRows,
    enabledSkills: Array.isArray(cfg.enabledSkills) ? [...cfg.enabledSkills] : [],
    disabledBuiltinSkills: Array.isArray(cfg.disabledBuiltinSkills)
      ? [...cfg.disabledBuiltinSkills]
      : [],
  }
}

function parseToolLines(raw: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim()
    if (!t || seen.has(t)) continue
    seen.add(t)
    out.push(t)
  }
  return out
}

function buildEnvObject(rows: EnvRow[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const r of rows) {
    const k = r.key.trim()
    if (!k) continue
    out[k] = r.value
  }
  return out
}

function buildConfigPatch(form: FormState): Record<string, unknown> {
  const out: Record<string, unknown> = {
    agent: form.agent,
    model: form.model,
    reasoningEffort: form.reasoningEffort,
  }
  if (form.agent === 'codex') {
    if (form.sandboxMode) out.sandboxMode = form.sandboxMode
    if (form.approvalPolicy) out.approvalPolicy = form.approvalPolicy
  } else {
    // claude + antigravity both carry a permission mode.
    if (form.permissionMode) out.permissionMode = form.permissionMode
    if (form.agent === 'claude' && form.claudeCliProfile.trim()) {
      out.claudeCliProfile = form.claudeCliProfile.trim()
    }
  }
  if (form.appendSystemPrompt.trim()) {
    out.appendSystemPrompt = form.appendSystemPrompt
  }
  // Always include the array/record fields so an emptied UI clears them on
  // the server (shallow merge replaces the key with [] / {}).
  out.allowedTools = parseToolLines(form.allowedTools)
  out.disallowedTools = parseToolLines(form.disallowedTools)
  out.env = buildEnvObject(form.env)
  out.enabledSkills = [...form.enabledSkills].sort()
  out.disabledBuiltinSkills = [...form.disabledBuiltinSkills].sort()
  return out
}

function isReasoning(v: unknown): boolean {
  return v === 'minimal' || v === 'low' || v === 'medium' || v === 'high'
}
function isPermissionMode(v: unknown): boolean {
  return PERMISSION_MODES.includes(v as PermissionMode)
}
function isSandboxMode(v: unknown): boolean {
  return SANDBOX_MODES.includes(v as SandboxMode)
}
function isApprovalPolicy(v: unknown): boolean {
  return APPROVAL_POLICIES.includes(v as ApprovalPolicy)
}

/* ---------- presentational bits ---------- */

const textInput =
  'h-10 w-full rounded-md border border-border bg-card px-3 text-[13.5px] text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-[color-mix(in_oklab,var(--anubis-gold)_50%,var(--border))] focus:ring-1 focus:ring-[var(--anubis-gold-hi)]'

const selectInput = cn(textInput, 'pr-9 appearance-none cursor-pointer')

function Section({
  title,
  hint,
  children,
}: {
  title: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <section className='mt-8 border-t border-border pt-6'>
      <div className='mb-4'>
        <h2 className='font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground'>
          {title}
        </h2>
        {hint && (
          <p className='mt-1 text-[12.5px] text-muted-foreground'>{hint}</p>
        )}
      </div>
      <div className='flex flex-col gap-5'>{children}</div>
    </section>
  )
}

function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string
  htmlFor?: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className='flex flex-col gap-1.5'>
      <label
        htmlFor={htmlFor}
        className='text-[12.5px] font-medium tracking-[-0.005em] text-foreground'
      >
        {label}
      </label>
      <div className='relative'>{children}</div>
      {hint && <p className='text-[11.5px] text-muted-foreground'>{hint}</p>}
    </div>
  )
}

function Segmented({
  value,
  onChange,
  options,
}: {
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
}) {
  return (
    <div className='inline-flex gap-1 rounded-md border border-border bg-background p-1'>
      {options.map((opt) => {
        const active = opt.value === value
        return (
          <button
            key={opt.value}
            type='button'
            onClick={() => onChange(opt.value)}
            aria-pressed={active}
            className={cn(
              'h-8 rounded-[5px] px-3.5 text-[12.5px] font-medium capitalize transition-colors',
              active
                ? 'bg-card text-foreground shadow-[inset_0_-2px_0_var(--anubis-gold)]'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

/* ---------- Skills editor ---------- */

function SkillsEditor({
  skills,
  enabled,
  disabled,
  onChange,
}: {
  skills: SkillSummary[] | null
  enabled: string[]
  disabled: string[]
  onChange: (next: { enabled: string[]; disabled: string[] }) => void
}) {
  if (skills === null) {
    return (
      <div className='font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground'>
        Loading skills…
      </div>
    )
  }
  if (skills.length === 0) {
    return (
      <div className='rounded-md border border-dashed border-border bg-card/50 p-4 text-[12.5px] text-muted-foreground'>
        No skills discovered. Drop SKILL.md files under the user skills root to add your own.
      </div>
    )
  }

  const enabledSet = new Set(enabled)
  const disabledSet = new Set(disabled)

  const groups: { source: SkillSummary['source']; title: string; hint: string }[] = [
    {
      source: 'builtin-auto',
      title: 'Auto-injected (built-in)',
      hint: 'On by default. Untick to disable for this profile.',
    },
    {
      source: 'builtin-opt-in',
      title: 'Opt-in (built-in)',
      hint: 'Off by default. Tick to enable for this profile.',
    },
    { source: 'user', title: 'Your skills', hint: 'Off by default. Tick to enable.' },
  ]

  function toggle(skill: SkillSummary, checked: boolean) {
    if (skill.source === 'builtin-auto') {
      // On = remove from disabled list; Off = add.
      const next = new Set(disabledSet)
      if (checked) next.delete(skill.name)
      else next.add(skill.name)
      onChange({ enabled, disabled: [...next].sort() })
    } else {
      const next = new Set(enabledSet)
      if (checked) next.add(skill.name)
      else next.delete(skill.name)
      onChange({ enabled: [...next].sort(), disabled })
    }
  }

  function isOn(skill: SkillSummary): boolean {
    return skill.source === 'builtin-auto'
      ? !disabledSet.has(skill.name)
      : enabledSet.has(skill.name)
  }

  return (
    <div className='flex flex-col gap-5'>
      {groups.map((g) => {
        const items = skills.filter((s) => s.source === g.source)
        if (items.length === 0) return null
        return (
          <div key={g.source} className='flex flex-col gap-2'>
            <div className='flex items-baseline justify-between'>
              <h3 className='text-[12.5px] font-medium text-foreground'>{g.title}</h3>
              <span className='text-[11.5px] text-muted-foreground'>{g.hint}</span>
            </div>
            <div className='flex flex-col gap-1 rounded-md border border-border bg-card'>
              {items.map((skill, i) => {
                const on = isOn(skill)
                return (
                  <label
                    key={skill.name}
                    className={cn(
                      'flex cursor-pointer items-start gap-3 px-3.5 py-2.5 transition-colors hover:bg-muted/55',
                      i > 0 && 'border-t border-border',
                    )}
                  >
                    <input
                      type='checkbox'
                      checked={on}
                      onChange={(e) => toggle(skill, e.target.checked)}
                      className='mt-[3px] size-[14px] cursor-pointer accent-[var(--anubis-gold)]'
                    />
                    <div className='flex min-w-0 flex-1 flex-col gap-0.5'>
                      <span className='truncate text-[13px] font-medium text-foreground'>
                        {skill.name}
                      </span>
                      {skill.description && (
                        <span className='text-[12px] leading-[1.45] text-muted-foreground'>
                          {skill.description}
                        </span>
                      )}
                      {skill.whenToUse && (
                        <span className='text-[11.5px] italic text-muted-foreground/85'>
                          When to use: {skill.whenToUse}
                        </span>
                      )}
                    </div>
                  </label>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}

/* ---------- Env editor ---------- */

let envRowSeq = 0
function nextEnvRowId(): string {
  envRowSeq += 1
  return `env-row-${envRowSeq}`
}

function EnvEditor({
  rows,
  onChange,
}: {
  rows: EnvRow[]
  onChange: (next: EnvRow[]) => void
}) {
  // Detect duplicate keys to warn the user — the last one wins on save.
  const dupKeys = new Set<string>()
  const seen = new Set<string>()
  for (const r of rows) {
    const k = r.key.trim()
    if (!k) continue
    if (seen.has(k)) dupKeys.add(k)
    seen.add(k)
  }

  function add() {
    onChange([...rows, { id: nextEnvRowId(), key: '', value: '' }])
  }
  function update(id: string, patch: Partial<EnvRow>) {
    onChange(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  }
  function remove(id: string) {
    onChange(rows.filter((r) => r.id !== id))
  }

  return (
    <div className='flex flex-col gap-2'>
      {rows.length === 0 ? (
        <div className='rounded-md border border-dashed border-border bg-card/50 px-3.5 py-3 text-[12.5px] text-muted-foreground'>
          No environment variables. Click + Add to define one.
        </div>
      ) : (
        <div className='flex flex-col gap-1.5'>
          {rows.map((r) => {
            const trimmed = r.key.trim()
            const isDup = trimmed.length > 0 && dupKeys.has(trimmed)
            return (
              <div key={r.id} className='flex items-center gap-2'>
                <input
                  type='text'
                  value={r.key}
                  onChange={(e) => update(r.id, { key: e.target.value })}
                  placeholder='KEY'
                  aria-invalid={isDup || undefined}
                  className={cn(
                    'h-9 w-[180px] shrink-0 rounded-md border border-border bg-card px-3 font-mono text-[12.5px] uppercase tracking-[0.04em] text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-[color-mix(in_oklab,var(--anubis-gold)_50%,var(--border))]',
                    isDup && 'border-destructive/60 focus:border-destructive',
                  )}
                />
                <input
                  type='text'
                  value={r.value}
                  onChange={(e) => update(r.id, { value: e.target.value })}
                  placeholder='value'
                  className='h-9 min-w-0 flex-1 rounded-md border border-border bg-card px-3 font-mono text-[12.5px] text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-[color-mix(in_oklab,var(--anubis-gold)_50%,var(--border))]'
                />
                <button
                  type='button'
                  onClick={() => remove(r.id)}
                  aria-label={`Remove ${r.key || 'row'}`}
                  className='flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/15 hover:text-destructive'
                >
                  <XIcon className='size-4' strokeWidth={2} />
                </button>
              </div>
            )
          })}
        </div>
      )}
      <div className='flex items-center justify-between'>
        <button
          type='button'
          onClick={add}
          className='inline-flex items-center gap-1.5 self-start rounded-md border border-border bg-card px-3 py-1.5 text-[12.5px] font-medium text-foreground transition-colors hover:bg-muted'
        >
          <PlusIcon className='size-[14px]' strokeWidth={2.2} />
          Add variable
        </button>
        {dupKeys.size > 0 && (
          <span className='text-[11.5px] text-destructive'>
            Duplicate key{dupKeys.size > 1 ? 's' : ''}: {[...dupKeys].join(', ')} — last value wins.
          </span>
        )}
      </div>
    </div>
  )
}

/* ---------- Profile home path ---------- */

function ProfileHomePath({
  path,
  exists,
  hasCredentials,
}: {
  path: string
  exists: boolean
  hasCredentials: boolean
}) {
  const [copied, setCopied] = useState(false)
  const [openErr, setOpenErr] = useState<string | null>(null)

  async function copy() {
    try {
      await navigator.clipboard.writeText(path)
      setCopied(true)
      setTimeout(() => setCopied(false), 1400)
    } catch {
      // Some browsers without focus can reject — ignore silently.
    }
  }

  async function open() {
    setOpenErr(null)
    if (!window.anubis) {
      setOpenErr('Folder opening is only available in the desktop app.')
      return
    }
    const err = await window.anubis.shell.openPath(path)
    if (err) setOpenErr(err)
  }

  return (
    <div className='flex flex-col gap-2'>
      <div className='flex items-center gap-2'>
        <code className='flex min-w-0 flex-1 items-center gap-2 truncate rounded-md border border-border bg-card px-3 py-2 font-mono text-[12.5px] text-foreground'>
          <FolderIcon className='size-[14px] shrink-0 text-[var(--anubis-gold)]' strokeWidth={2} />
          <span className='truncate' title={path}>{path}</span>
        </code>
        <button
          type='button'
          onClick={() => void copy()}
          aria-label='Copy path'
          className='inline-flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-card text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
        >
          {copied ? <CheckIcon className='size-4' strokeWidth={2} /> : <CopyIcon className='size-4' strokeWidth={2} />}
        </button>
        <button
          type='button'
          onClick={() => void open()}
          disabled={!exists}
          aria-label='Open folder'
          className='inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-[12.5px] font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50'
        >
          <FolderOpenIcon className='size-4' strokeWidth={2} />
          Open
        </button>
      </div>
      <div className='flex flex-wrap items-center gap-2 text-[11.5px] text-muted-foreground'>
        <Pill ok={exists} okLabel='Folder exists' offLabel='Not created yet' />
        <Pill ok={hasCredentials} okLabel='Has credentials' offLabel='No credentials' />
        {!exists && (
          <span>Folder will be created on first message sent with this profile.</span>
        )}
        {openErr && <span className='text-destructive'>Open failed: {openErr}</span>}
      </div>
    </div>
  )
}

function Pill({ ok, okLabel, offLabel }: { ok: boolean; okLabel: string; offLabel: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 font-mono text-[10.5px] uppercase tracking-[0.08em]',
        ok
          ? 'border-[color-mix(in_oklab,var(--anubis-gold)_38%,transparent)] bg-[color-mix(in_oklab,var(--anubis-gold)_10%,transparent)] text-[var(--anubis-gold)]'
          : 'border-border bg-muted text-muted-foreground',
      )}
    >
      <span className={cn('size-[6px] rounded-full', ok ? 'bg-[var(--anubis-gold)]' : 'bg-muted-foreground/55')} />
      {ok ? okLabel : offLabel}
    </span>
  )
}

function SourceBadge({ source }: { source: ProfileSummary['source'] }) {
  if (source === 'builtin') {
    return (
      <span className='inline-flex items-center rounded-md border border-[color-mix(in_oklab,var(--anubis-gold)_38%,transparent)] bg-[color-mix(in_oklab,var(--anubis-gold)_16%,transparent)] px-2 py-0.5 text-[10.5px] font-medium uppercase tracking-[0.08em] text-[var(--anubis-gold)]'>
        Built-in
      </span>
    )
  }
  return (
    <span className='inline-flex items-center rounded-md border border-border bg-muted px-2 py-0.5 text-[10.5px] font-medium uppercase tracking-[0.08em] text-muted-foreground'>
      Custom
    </span>
  )
}

