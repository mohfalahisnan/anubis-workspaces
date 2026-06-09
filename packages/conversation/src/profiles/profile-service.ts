import { newId } from '../util/ids.js'
import { nowMs } from '../util/time.js'
import type { ProfilesRepo } from '../db/repositories/profiles-repo.js'
import { BUILTIN_PROFILES } from './builtin.js'
import { resolveLayers } from './resolve.js'
import type { ProfileHomeRegistry } from './profile-home.js'
import {
  ProfileConfigSchema, ProfileOverrideSchema, ProfileSchema,
  type Profile, type ProfileConfig, type ProfileOverride, type ResolvedProfile,
} from './types.js'

export interface CreateProfileInput {
  name: string
  description?: string
  config: ProfileConfig
}

export interface UpdateProfileInput {
  name?: string
  description?: string
  configPatch?: ProfileOverride
  sortOrder?: number
}

export class ProfileService {
  constructor(
    private repo: ProfilesRepo,
    private profileHomes: ProfileHomeRegistry,
  ) {}

  seedBuiltins(): void {
    const existing = new Set(this.repo.list().filter(p => p.source === 'builtin').map(p => p.id))
    const now = nowMs()
    for (const p of BUILTIN_PROFILES) {
      if (existing.has(p.id)) continue
      this.repo.upsert({ ...p, createdAt: now, updatedAt: now })
    }
  }

  /**
   * One-shot: if the default Claude profile's home is empty *and* the user
   * already has system-wide Claude credentials at `systemSource`, copy them
   * into the profile's home so the default profile is usable without a fresh
   * login. Idempotent — re-running after credentials exist is a no-op.
   */
  bootstrapDefaultClaudeProfile(opts: {
    systemSource: string
    profileId?: string
  }): { copied: boolean } {
    const profileId = opts.profileId ?? 'claude-coding'
    const profile = this.repo.findById(profileId)
    if (!profile || profile.config.agent !== 'claude') return { copied: false }
    return this.profileHomes.for(profileId, 'claude').copyFromSystem(opts.systemSource)
  }

  copyProfile(
    sourceId: string,
    input: { name: string; description?: string },
  ): Profile {
    const src = this.repo.findById(sourceId)
    if (!src) throw new Error(`profile ${sourceId} not found`)

    const created = this.create({
      name: input.name,
      description: input.description ?? src.description,
      config: { ...src.config },
    })

    try {
      this.profileHomes.for(sourceId, src.config.agent).cloneTo(created.id)
    } catch (e) {
      // Roll back the profile so we don't leave a half-copied row.
      this.repo.delete(created.id)
      throw e
    }
    return created
  }

  list(): Profile[] {
    return this.repo.list().map(p => this.withOverride(p))
  }

  get(id: string): Profile | null {
    const p = this.repo.findById(id)
    return p ? this.withOverride(p) : null
  }

  create(input: CreateProfileInput): Profile {
    const config = ProfileConfigSchema.parse(input.config)
    const now = nowMs()
    const p: Profile = {
      id: newId(),
      name: input.name,
      description: input.description,
      source: 'user',
      config,
      sortOrder: 1000,
      createdAt: now,
      updatedAt: now,
    }
    ProfileSchema.parse(p)
    this.repo.upsert(p)
    return p
  }

  update(id: string, patch: UpdateProfileInput): Profile {
    const existing = this.repo.findById(id)
    if (!existing) throw new Error(`Profile not found: ${id}`)
    if (existing.source === 'builtin') {
      if (patch.configPatch) this.setOverride(id, patch.configPatch)
      if (patch.sortOrder !== undefined) {
        const cur = this.repo.getOverride(id)
        this.repo.setOverride(id, cur?.patch ?? {}, patch.sortOrder)
      }
      return this.get(id)!
    }
    const merged: Profile = {
      ...existing,
      name: patch.name ?? existing.name,
      description: patch.description ?? existing.description,
      config: patch.configPatch
        ? ProfileConfigSchema.parse({ ...existing.config, ...patch.configPatch })
        : existing.config,
      sortOrder: patch.sortOrder ?? existing.sortOrder,
      updatedAt: nowMs(),
    }
    this.repo.upsert(merged)
    return merged
  }

  delete(id: string): void {
    const existing = this.repo.findById(id)
    if (!existing) return
    if (existing.source === 'builtin') {
      this.repo.deleteOverride(id)
      return
    }
    this.repo.delete(id)
  }

  setOverride(id: string, patch: ProfileOverride): void {
    ProfileOverrideSchema.parse(patch)
    const cur = this.repo.getOverride(id)
    this.repo.setOverride(id, patch, cur?.sortOrder ?? undefined)
  }

  resolve(profileId: string | null, override?: ProfileOverride): ResolvedProfile {
    const layers: Array<ProfileConfig | ProfileOverride | undefined> = []
    if (profileId) {
      const p = this.get(profileId)
      if (!p) throw new Error(`Profile not found: ${profileId}`)
      layers.push(p.config)
    }
    if (override) layers.push(ProfileOverrideSchema.parse(override))
    return resolveLayers(layers)
  }

  touchLastUsed(id: string): void {
    this.repo.touchLastUsed(id, nowMs())
  }

  private withOverride(p: Profile): Profile {
    if (p.source !== 'builtin') return p
    const ov = this.repo.getOverride(p.id)
    if (!ov) return p
    return {
      ...p,
      config: ProfileConfigSchema.parse({ ...p.config, ...ov.patch }),
      sortOrder: ov.sortOrder ?? p.sortOrder,
    }
  }
}
