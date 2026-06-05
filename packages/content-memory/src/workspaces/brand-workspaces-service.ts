import { randomUUID } from 'node:crypto'
import type {
  BrandWorkspace,
  BrandWorkspacesRepo,
} from '../db/repositories/brand-workspaces-repo.js'

export interface CreateBrandWorkspaceInput {
  name: string
  brandSummary?: string | null
  toneOfVoice?: string[]
  audience?: string[]
  offers?: string[]
  constraints?: string[]
}

export class BrandWorkspacesService {
  constructor(private repo: BrandWorkspacesRepo) {}

  create(input: CreateBrandWorkspaceInput, now: number = Date.now()): BrandWorkspace {
    const ws: BrandWorkspace = {
      id: randomUUID(),
      name: input.name,
      brandSummary: input.brandSummary ?? null,
      toneOfVoice: input.toneOfVoice ?? [],
      audience: input.audience ?? [],
      offers: input.offers ?? [],
      constraints: input.constraints ?? [],
      status: 'active',
      createdAt: now,
      updatedAt: now,
    }
    this.repo.insert(ws)
    return ws
  }

  get(id: string): BrandWorkspace | null {
    return this.repo.findById(id)
  }

  list(): BrandWorkspace[] {
    return this.repo.list()
  }
}
