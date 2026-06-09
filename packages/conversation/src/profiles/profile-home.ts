import type { SkillDefinition } from '../skills/types.js'
import type { AgentKind } from './types.js'
import {
  copyHomeFromSystem,
  copyProfileHome,
  ensureAgentHome,
  envFor,
  hasCredentials,
  homePathFor,
  resetProfileHome,
  writeProfileInstructions,
  writeProfileSkills,
} from './agent-home.js'

/**
 * One deep handle to a single profile's agent home dir. Wraps directory
 * layout, credential detection, instruction + skill staging, env injection,
 * reset and clone behind a single interface. Callers (conversation-service,
 * profile-service) hold the handle instead of importing the loose helpers
 * — bugs and changes concentrate here.
 *
 * Use {@link ProfileHomeRegistry} to obtain a handle; never construct directly
 * from outside this package.
 */
export class ProfileHome {
  constructor(
    private readonly agentHomeRoot: string,
    private readonly profileId: string,
    private readonly agent: AgentKind,
  ) {}

  /** On-disk path to this profile's home, whether or not it has been created. */
  path(): string {
    return homePathFor(this.agentHomeRoot, this.profileId, this.agent)
  }

  /** True when the profile has a usable login on disk (or auth lives in the OS keyring). */
  hasCredentials(): boolean {
    return hasCredentials(this.profileId, this.agent, this.agentHomeRoot)
  }

  /**
   * Ensure the home directory exists, write profile-level instruction files,
   * and return the env vars the CLI needs to read from this home. Single
   * call replaces ensureAgentHome + writeProfileInstructions + envFor.
   *
   * `instructions` may be undefined or empty — instruction files are removed
   * in that case (no-ops if already absent).
   */
  prepare(instructions: string | undefined): {
    homePath: string
    env: Record<string, string>
    /** True when this call created the directory (no prior state). */
    isNew: boolean
  } {
    const { path, isNew } = ensureAgentHome(this.agentHomeRoot, this.profileId, this.agent)
    writeProfileInstructions(path, instructions)
    return { homePath: path, env: envFor(this.agent, path), isNew }
  }

  /** Delete the home dir. Next prepare() rebuilds it empty. */
  reset(): { existed: boolean } {
    return resetProfileHome(this.agentHomeRoot, this.profileId, this.agent)
  }

  /**
   * Seed this profile's home from a system-wide source (e.g. `~/.claude`) when
   * the profile has no credentials yet. Idempotent — no-op when credentials
   * already exist.
   */
  copyFromSystem(systemSource: string): { copied: boolean } {
    return copyHomeFromSystem({
      systemSource,
      profileId: this.profileId,
      agent: this.agent,
      agentHomeRoot: this.agentHomeRoot,
    })
  }

  /** Copy this profile's home into another profile's slot (same agent). */
  cloneTo(destProfileId: string): { copied: boolean } {
    return copyProfileHome({
      srcProfileId: this.profileId,
      destProfileId,
      agent: this.agent,
      agentHomeRoot: this.agentHomeRoot,
    })
  }
}

/**
 * Materialise the active skill set under `<workspacePath>/.agents/skills/<name>/`.
 *
 * Skill staging is profile-driven but workspace-scoped (the agent reads
 * `.agents/skills/<name>/SKILL.md` from its cwd, not from its home), so this is
 * a stand-alone helper on the registry rather than a {@link ProfileHome} method.
 */

/**
 * Factory + composition-root anchor for {@link ProfileHome} handles.
 * One registry per process; pass it to services that previously took
 * `agentHomeRoot: string` so the directory layout stops leaking outward.
 */
export class ProfileHomeRegistry {
  constructor(private readonly agentHomeRoot: string) {}

  /** Root path under which every profile's per-agent home dir lives. */
  get root(): string {
    return this.agentHomeRoot
  }

  /** Get a handle for one (profile, agent) pair. */
  for(profileId: string, agent: AgentKind): ProfileHome {
    return new ProfileHome(this.agentHomeRoot, profileId, agent)
  }

  /**
   * Stage skills into a conversation workspace. Workspace-scoped because the
   * agent reads them from its cwd; lives on the registry so callers have one
   * profile-home seam instead of two.
   */
  stageSkills(workspacePath: string, skills: SkillDefinition[]): boolean {
    return writeProfileSkills(workspacePath, skills)
  }
}
