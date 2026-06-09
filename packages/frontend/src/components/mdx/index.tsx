import { Fragment, useMemo } from 'react'
import type { MessageImageReference } from '@anubis/shared'
import { splitMdxSource, type Segment, type ComponentName } from './parser'
import { parseProps } from './props-parser'
import { MdxConversationProvider } from './conversation-context'
import { MdxMarkdown } from './markdown'
import { MessageImageList } from './message-image'
import { extractImageReferencesFromMarkdown } from '@/lib/message-image-detection'
import { Buttons } from './components/Buttons'
import { Button } from './components/Button'
import { DataTable } from './components/DataTable'
import { KeyValueList } from './components/KeyValueList'
import { LineChart } from './components/LineChart'
import { HtmlPreview } from './components/HtmlPreview'
import { ReactPreview } from './components/ReactPreview'

export interface MdxContentProps {
  source: string
  conversationId: string
  imageReferences?: MessageImageReference[]
}

/**
 * Strip the [CRON_*] protocol blocks the agent uses to signal scheduled-task
 * intent. They're consumed by `cron-detect.ts` server-side; users shouldn't
 * see the raw markers (and certainly not wrapped in a fenced code block).
 * Also peels any surrounding ``` fence the model wraps them in.
 */
function stripCronProtocol(source: string): string {
  return source
    // Fenced versions: ```anything\n[CRON_CREATE]...[/CRON_CREATE]\n```
    .replace(/```[\w-]*\s*\n?\[CRON_(?:CREATE|UPDATE(?::[^\]]+)?)\][\s\S]*?\[\/CRON_(?:CREATE|UPDATE)\]\s*\n?```/g, '')
    // Bare versions
    .replace(/\[CRON_CREATE\][\s\S]*?\[\/CRON_CREATE\]/g, '')
    .replace(/\[CRON_UPDATE:\s*[^\]]+\][\s\S]*?\[\/CRON_UPDATE\]/g, '')
    .replace(/\[CRON_DELETE:\s*[^\]]+\]/g, '')
    .replace(/\[CRON_LIST\]/g, '')
    // Collapse the blank lines those replacements leave behind
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function MdxContent({ source, conversationId, imageReferences = [] }: MdxContentProps) {
  const strippedSource = useMemo(() => stripCronProtocol(source), [source])
  const segments = useMemo(() => splitMdxSource(strippedSource), [strippedSource])
  const extraImageReferences = useMemo(() => {
    if (imageReferences.length === 0) return []
    const inline = new Set(extractImageReferencesFromMarkdown(strippedSource).map((ref) => ref.src))
    return imageReferences.filter((ref) => !inline.has(ref.src))
  }, [imageReferences, strippedSource])

  return (
    <MdxConversationProvider value={{ conversationId }}>
      <div className='flex flex-col gap-2'>
        {segments.map((seg, i) => (
          <Fragment key={i}>{renderSegment(seg)}</Fragment>
        ))}
        <MessageImageList refs={extraImageReferences} conversationId={conversationId} />
      </div>
    </MdxConversationProvider>
  )
}

function renderSegment(seg: Segment) {
  if (seg.kind === 'markdown') {
    if (!seg.text.trim()) return null
    return <MdxMarkdown source={seg.text} />
  }
  return <ComponentSegment name={seg.name} propsRaw={seg.propsRaw} childrenRaw={seg.childrenRaw} />
}

function ComponentSegment({
  name,
  propsRaw,
  childrenRaw,
}: {
  name: ComponentName
  propsRaw: string
  childrenRaw: string
}) {
  const parsed = parseProps(propsRaw)
  if (!parsed.ok) {
    return <Fallback raw={`<${name} ${propsRaw}>`} reason={parsed.reason} />
  }
  const props = parsed.value as Record<string, unknown>

  switch (name) {
    case 'Buttons':
      return (
        <Buttons>
          {splitMdxSource(childrenRaw).map((sub, i) => (
            <Fragment key={i}>{renderSegment(sub)}</Fragment>
          ))}
        </Buttons>
      )
    case 'Button': {
      const label = childrenRaw.trim()
      return (
        <Button
          send={String(props.send ?? '')}
          style={props.style as 'primary' | 'secondary' | 'danger' | undefined}
        >
          {label}
        </Button>
      )
    }
    case 'DataTable':
      return (
        <DataTable
          columns={(props.columns as string[]) ?? []}
          rows={(props.rows as Array<Array<string | number | boolean | null>>) ?? []}
        />
      )
    case 'KeyValueList':
      return (
        <KeyValueList
          items={(props.items as Record<string, string | number | boolean | null>) ?? {}}
        />
      )
    case 'LineChart':
      return (
        <LineChart
          data={(props.data as Array<Record<string, unknown>>) ?? []}
          xKey={String(props.xKey ?? '')}
          yKey={String(props.yKey ?? '')}
          title={typeof props.title === 'string' ? props.title : undefined}
        />
      )
    case 'HtmlPreview': {
      const html = typeof props.html === 'string' ? props.html : childrenRaw
      return (
        <HtmlPreview
          html={html}
          height={typeof props.height === 'number' ? props.height : undefined}
          maxHeight={typeof props.maxHeight === 'number' ? props.maxHeight : undefined}
        />
      )
    }
    case 'ReactPreview': {
      const code = typeof props.code === 'string' ? props.code : childrenRaw
      return (
        <ReactPreview
          code={code}
          height={typeof props.height === 'number' ? props.height : undefined}
          maxHeight={typeof props.maxHeight === 'number' ? props.maxHeight : undefined}
        />
      )
    }
    default:
      return <Fallback raw={`<${String(name)} />`} />
  }
}

function Fallback({ raw, reason }: { raw: string; reason?: string }) {
  return (
    <pre className='my-2 overflow-x-auto rounded-md bg-muted p-2 font-mono text-[11px] text-muted-foreground'>
      <code>
        Could not render component{reason ? ` (${reason})` : ''}:{'\n'}
        {raw}
      </code>
    </pre>
  )
}
