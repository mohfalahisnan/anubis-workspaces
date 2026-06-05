import { useCallback, useState } from 'react'
import type { ProfileSummary } from '@anubis/shared'
import { createConversation, type ReasoningEffort } from '@/api'

interface EnsureState {
  ensure: (firstContent: string) => Promise<string>
  creating: boolean
  error: string | null
}

const TITLE_LIMIT = 60

function deriveTitle(content: string): string {
  const trimmed = content.trim()
  if (!trimmed) return 'New conversation'
  return trimmed.slice(0, TITLE_LIMIT)
}

export function useEnsureConversation(
  conversationId: string | undefined,
  selectedProfile: ProfileSummary | null,
  effort: ReasoningEffort,
  profileDefaultEffort: ReasoningEffort,
  workspacePath: string | null,
): EnsureState {
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const ensure = useCallback(
    async (firstContent: string): Promise<string> => {
      if (conversationId) return conversationId
      if (!selectedProfile) {
        const err = new Error('No profile selected — cannot start a conversation.')
        setError(err.message)
        throw err
      }
      setCreating(true)
      setError(null)
      try {
        const override =
          effort !== profileDefaultEffort ? { reasoningEffort: effort } : undefined
        const created = await createConversation({
          title: deriveTitle(firstContent),
          profileId: selectedProfile.id,
          agent: selectedProfile.config.agent,
          ...(workspacePath ? { workspacePath } : {}),
          ...(override ? { override } : {}),
        })
        return created.id
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        setError(msg)
        throw e
      } finally {
        setCreating(false)
      }
    },
    [conversationId, selectedProfile, effort, profileDefaultEffort, workspacePath],
  )

  return { ensure, creating, error }
}
