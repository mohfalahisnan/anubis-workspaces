import { Fragment, useMemo } from 'react'
import { splitMdxSource, type Segment, type ComponentName } from './parser'
import { parseProps } from './props-parser'
import { MdxConversationProvider } from './conversation-context'
import { MdxMarkdown } from './markdown'
import { Buttons } from './components/Buttons'
import { Button } from './components/Button'
import { DataTable } from './components/DataTable'
import { KeyValueList } from './components/KeyValueList'
import { LineChart } from './components/LineChart'

export interface MdxContentProps {
  source: string
  conversationId: string
}

export function MdxContent({ source, conversationId }: MdxContentProps) {
  const segments = useMemo(() => splitMdxSource(source), [source])

  return (
    <MdxConversationProvider value={{ conversationId }}>
      <div className='flex flex-col gap-2'>
        {segments.map((seg, i) => (
          <Fragment key={i}>{renderSegment(seg)}</Fragment>
        ))}
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
