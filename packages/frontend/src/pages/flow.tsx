import { useState } from 'react'
import { ExternalLinkIcon, ImageIcon, Loader2Icon, SparklesIcon } from 'lucide-react'
import {
  generateFlowImage,
  openFlowChrome,
  type FlowGenerateResponse,
  type FlowRatio,
  type FlowVariations,
} from '@/api'
import { cn } from '@/lib/utils'

type Banner = { kind: 'success' | 'error'; message: string }

const RATIOS: FlowRatio[] = ['1:1', '16:9', '4:3', '3:4', '9:16']
const VARIATIONS: FlowVariations[] = [1, 2, 3, 4]

export function FlowPage() {
  const [prompt, setPrompt] = useState('')
  const [projectUrl, setProjectUrl] = useState('')
  const [ratio, setRatio] = useState<FlowRatio>('1:1')
  const [variations, setVariations] = useState<FlowVariations>(1)
  const [model, setModel] = useState('Nano Banana Pro')
  const [downloadDir, setDownloadDir] = useState('')
  const [busy, setBusy] = useState(false)
  const [opening, setOpening] = useState(false)
  const [banner, setBanner] = useState<Banner | null>(null)
  const [result, setResult] = useState<FlowGenerateResponse | null>(null)

  async function handleOpenChrome() {
    setOpening(true); setBanner(null)
    try {
      await openFlowChrome(projectUrl.trim() || undefined)
      setBanner({
        kind: 'success',
        message: 'Opened the Flow Chrome window. Sign in to Google and open/create a project, then generate.',
      })
    } catch (e) {
      setBanner({ kind: 'error', message: e instanceof Error ? e.message : 'Failed to open Flow Chrome.' })
    } finally {
      setOpening(false)
    }
  }

  async function handleGenerate() {
    if (!prompt.trim()) return
    setBusy(true); setBanner(null); setResult(null)
    try {
      const res = await generateFlowImage({
        prompt: prompt.trim(),
        projectUrl: projectUrl.trim() || undefined,
        ratio,
        variations,
        model: model.trim() || undefined,
        downloadDir: downloadDir.trim() || undefined,
      })
      setResult(res)
      setBanner({
        kind: 'success',
        message: `Generated ${res.resultEditUrls.length} result(s)${res.downloadedImagePaths ? `, downloaded ${res.downloadedImagePaths.length}` : ''}.`,
      })
    } catch (e) {
      setBanner({ kind: 'error', message: e instanceof Error ? e.message : 'Generation failed.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className='flex flex-1 flex-col overflow-y-auto bg-background'>
      <div className='mx-auto w-full max-w-[1080px] px-7 pb-16'>
        <div className='flex flex-col gap-4 pt-7'>
          <div className='flex items-start justify-between gap-4'>
            <div>
              <h1 className='text-[28px] font-semibold leading-[1.1] tracking-[-0.025em]'>Flow Images</h1>
              <p className='mt-1.5 max-w-2xl text-[13.5px] leading-relaxed text-muted-foreground'>
                Generate images in <a href='https://labs.google/fx/tools/flow' target='_blank' rel='noreferrer' className='text-foreground/80 underline underline-offset-2'>Google Flow</a> by driving a headed Chrome on the isolated <code className='font-mono text-foreground/80'>flow</code> profile. Open the window once to sign in to Google and open a project, then generate. See <code className='font-mono text-foreground/80'>docs/flow-crawler-cdp.md</code>.
              </p>
            </div>
            <button
              type='button'
              onClick={() => void handleOpenChrome()}
              disabled={opening}
              className='inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-border bg-card px-3.5 text-[12.5px] font-medium text-foreground transition-colors hover:bg-card/70 disabled:opacity-50'
            >
              {opening ? <Loader2Icon className='size-[15px] animate-spin' /> : <ExternalLinkIcon className='size-[15px]' strokeWidth={1.8} />}
              Open Flow Chrome
            </button>
          </div>
        </div>

        {banner && (
          <div role='status' className={cn(
            'mt-5 rounded-md border px-3.5 py-2.5 text-[13px]',
            banner.kind === 'error'
              ? 'border-[color-mix(in_oklab,var(--destructive)_40%,var(--border))] bg-[color-mix(in_oklab,var(--destructive)_10%,transparent)] text-destructive'
              : 'border-[color-mix(in_oklab,var(--anubis-gold)_40%,var(--border))] bg-[color-mix(in_oklab,var(--anubis-gold)_8%,transparent)] text-foreground',
          )}>
            {banner.message}
          </div>
        )}

        <section className='mt-8'>
          <div className='rounded-lg border border-border bg-card/60 px-6 py-6'>
            <div className='flex flex-col gap-1.5'>
              <label className='text-[12.5px] font-medium text-foreground'>Prompt</label>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder='Describe the image to generate…'
                rows={3}
                className='w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none focus:border-[color-mix(in_oklab,var(--anubis-gold)_50%,var(--border))]'
              />
            </div>

            <div className='mt-4 flex flex-col gap-1.5'>
              <label className='text-[12.5px] font-medium text-foreground'>Project URL <span className='font-normal text-muted-foreground'>(optional)</span></label>
              <input
                type='text'
                value={projectUrl}
                onChange={(e) => setProjectUrl(e.target.value)}
                placeholder='https://labs.google/fx/…/tools/flow/project/<id>'
                spellCheck={false}
                className='h-10 w-full rounded-md border border-border bg-background px-3 font-mono text-[12px] text-foreground outline-none focus:border-[color-mix(in_oklab,var(--anubis-gold)_50%,var(--border))]'
              />
              <p className='text-[11.5px] text-muted-foreground'>
                If set, this project tab is opened before generating. Leave blank to use the project already open in the Flow window.
              </p>
            </div>

            <div className='mt-4 flex flex-wrap items-end gap-3'>
              <label className='flex flex-col gap-1.5 text-[12.5px]'>
                <span className='font-medium text-foreground'>Aspect ratio</span>
                <select
                  value={ratio}
                  onChange={(e) => setRatio(e.target.value as FlowRatio)}
                  className='h-10 rounded-md border border-border bg-background px-2 text-[12.5px] text-foreground'
                >
                  {RATIOS.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </label>

              <label className='flex flex-col gap-1.5 text-[12.5px]'>
                <span className='font-medium text-foreground'>Variations</span>
                <select
                  value={variations}
                  onChange={(e) => setVariations(Number(e.target.value) as FlowVariations)}
                  className='h-10 rounded-md border border-border bg-background px-2 text-[12.5px] text-foreground'
                >
                  {VARIATIONS.map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
              </label>

              <label className='flex flex-col gap-1.5 text-[12.5px]'>
                <span className='font-medium text-foreground'>Model</span>
                <input
                  type='text'
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  spellCheck={false}
                  className='h-10 w-44 rounded-md border border-border bg-background px-2.5 text-[12.5px] text-foreground'
                />
              </label>

              <label className='flex flex-1 flex-col gap-1.5 text-[12.5px]'>
                <span className='font-medium text-foreground'>Download dir <span className='font-normal text-muted-foreground'>(optional)</span></span>
                <input
                  type='text'
                  value={downloadDir}
                  onChange={(e) => setDownloadDir(e.target.value)}
                  placeholder='Absolute folder to save images into…'
                  spellCheck={false}
                  className='h-10 w-full min-w-40 rounded-md border border-border bg-background px-2.5 font-mono text-[12px] text-foreground'
                />
              </label>

              <button
                type='button'
                onClick={() => void handleGenerate()}
                disabled={!prompt.trim() || busy}
                className='ml-auto inline-flex h-10 items-center gap-2 rounded-md bg-[var(--anubis-gold)] px-5 text-[13.5px] font-semibold text-[#0B0C0F] transition-colors hover:bg-[var(--anubis-gold-deep)] disabled:opacity-50'
              >
                {busy ? <Loader2Icon className='size-[15px] animate-spin' /> : <SparklesIcon className='size-[15px]' strokeWidth={2} />}
                {busy ? 'Generating…' : 'Generate'}
              </button>
            </div>
            <p className='mt-3 text-[11.5px] text-muted-foreground'>
              Generation runs in the visible Chrome window and can take up to ~2&nbsp;minutes. The tab is reset to a clean state first.
            </p>
          </div>
        </section>

        {result && (
          <section className='mt-8 border-t border-border pt-6'>
            <h2 className='font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground'>Result</h2>
            <div className='mt-3 rounded-md border border-border bg-card px-3.5 py-3 text-[12.5px]'>
              <div className='text-muted-foreground'>
                <span className='text-foreground'>{result.model}</span> · {result.ratio} · {result.variations} variation(s)
              </div>

              {result.resultEditUrls.length > 0 && (
                <ul className='mt-3 flex flex-col gap-1.5'>
                  {result.resultEditUrls.map((url, i) => (
                    <li key={url} className='flex items-center gap-2'>
                      <ImageIcon className='size-[14px] shrink-0 text-muted-foreground' strokeWidth={1.8} />
                      <a
                        href={url}
                        target='_blank'
                        rel='noreferrer'
                        className='truncate font-mono text-[12px] text-[var(--anubis-gold)] underline underline-offset-2 hover:text-[var(--anubis-gold-deep)]'
                      >
                        Edit result {i + 1}
                      </a>
                    </li>
                  ))}
                </ul>
              )}

              {result.downloadedImagePaths && result.downloadedImagePaths.length > 0 && (
                <div className='mt-3'>
                  <div className='font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground'>Downloaded</div>
                  <ul className='mt-1.5 flex flex-col gap-1'>
                    {result.downloadedImagePaths.map((p) => (
                      <li key={p} className='truncate font-mono text-[11.5px] text-muted-foreground'>{p}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
