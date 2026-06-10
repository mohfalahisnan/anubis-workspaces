import { createContext, useContext, type ReactNode, createElement } from 'react'

interface MdxConversationValue {
  conversationId: string
}

const MdxConversationContext = createContext<MdxConversationValue | null>(null)

export function MdxConversationProvider({
  value,
  children,
}: {
  value: MdxConversationValue
  children: ReactNode
}) {
  return createElement(MdxConversationContext.Provider, { value }, children)
}

export function useMdxConversation(): MdxConversationValue {
  const v = useContext(MdxConversationContext)
  return v ?? { conversationId: '' }
}
