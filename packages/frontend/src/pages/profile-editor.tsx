import { useEffect, useMemo, useState } from 'react'
import { ArrowLeftIcon } from 'lucide-react'

import type { AgentKind, ProfileSummary } from '@anubis/shared'

import {
  getCatalog,
  getProfile,
  updateProfile,
  type AgentCatalog,
} from '@/api'
import { cn } from '@/lib/utils'
import { useNavigation } from '@/lib/navigation'

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
}

const PERMISSION_MODES: PermissionMode[] = ['default', 'acceptEdits', 'plan', 'bypassPermissions']
const SANDBOX_MODES: SandboxMode[] = ['read-only', 'workspace-write', 'danger-full-access']
const APPROVAL_POLICIES: ApprovalPolicy[] = ['untrusted', 'on-request', 'on-failure', 'never']

type Banner = { kind: 'error' | 'success'; message: string }

export function ProfileEditorPage({ profileId }: { profileId: string }) {
  const { navigate } = useNavigation()
  const [profile, setProfile] = useState<ProfileSummary | null>(null)
  const [catalog, setCatalog] = useState<AgentCatalog | null>(null)
  const [form, setForm] = useState<FormState | null>(null)
  const [initial, setInitial] = useState<FormState | null>(null)
  const [busy, setBusy] = useState(false)
  const [banner, setBanner] = useState<Banner | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    Promise.all([getProfile(profileId), getCatalog()])
      .then(([p, c]) => {
        if (!active) return
        const f = formStateFromProfile(p, c)
        setProfile(p)
        setCatalog(c)
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
      // Reset runtime knobs that don't apply to the new agent
      permissionMode: agent === 'claude' ? form.permissionMode : '',
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
                disabled={busy || !dirty || !form.name.trim()}
                className={cn(
                  'inline-flex h-9 items-center gap-1.5 rounded-md px-4 text-[13.5px] font-semibold transition-colors',
                  busy || !dirty || !form.name.trim()
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

        {/* Agent & Model */}
        <Section title='Agent & Model'>
          <Field label='Agent'>
            <Segmented
              value={form.agent}
              onChange={(v) => onAgentChange(v as AgentKind)}
              options={[
                { value: 'claude', label: 'Claude' },
                { value: 'codex', label: 'Codex' },
              ]}
            />
          </Field>

          <Field label='Model' htmlFor='profile-model'>
            <select
              id='profile-model'
              value={form.model}
              onChange={(e) => update('model', e.target.value)}
              className={selectInput}
            >
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.id} — {m.description}
                </option>
              ))}
            </select>
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
          {isClaude ? (
            <>
              <Field label='Permission mode' htmlFor='profile-perm' hint='How Claude treats edits and shell calls.'>
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

        {/* Coming soon */}
        <Section
          title='Tools, env vars, skills'
          hint='Per-tool allowlists, environment variables, and skill checklists land in the next pass.'
        >
          <div className='rounded-md border border-dashed border-border bg-card/50 p-4 text-[12.5px] text-muted-foreground'>
            Not editable yet — for now, manage these by editing the profile config directly via the API.
          </div>
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
  }
}

function buildConfigPatch(form: FormState): Record<string, unknown> {
  const out: Record<string, unknown> = {
    agent: form.agent,
    model: form.model,
    reasoningEffort: form.reasoningEffort,
  }
  if (form.agent === 'claude') {
    if (form.permissionMode) out.permissionMode = form.permissionMode
    if (form.claudeCliProfile.trim()) out.claudeCliProfile = form.claudeCliProfile.trim()
  } else {
    if (form.sandboxMode) out.sandboxMode = form.sandboxMode
    if (form.approvalPolicy) out.approvalPolicy = form.approvalPolicy
  }
  if (form.appendSystemPrompt.trim()) {
    out.appendSystemPrompt = form.appendSystemPrompt
  }
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

