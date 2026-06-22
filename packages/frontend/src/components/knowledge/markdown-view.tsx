import { Streamdown } from 'streamdown'
import { cjk } from '@streamdown/cjk'
import { code } from '@streamdown/code'
import { math } from '@streamdown/math'
import { mermaid } from '@streamdown/mermaid'

const plugins = { cjk, code, math, mermaid }

export function MarkdownView({ content }: { content: string }) {
  return (
    <div className='text-[13.5px] leading-relaxed text-foreground/90'>
      <Streamdown plugins={plugins}>{content}</Streamdown>
    </div>
  )
}
