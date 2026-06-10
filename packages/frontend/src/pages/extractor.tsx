import { useCallback, useState } from 'react'
import {
  FileTextIcon,
  FolderSearchIcon,
  ImageIcon,
  Loader2Icon,
  MicIcon,
  ScanTextIcon,
} from 'lucide-react'
import { DEFAULT_WHISPER_MODEL, type WhisperModel } from '@anubis/shared'
import { extractWorkspace, runOcr, runTranscribe } from '@/api'
import { cn } from '@/lib/utils'
import { useProject } from '@/lib/use-project'
import { IMAGE_FILTERS, MEDIA_FILTERS, isElectron, pickFile } from '@/lib/pick-file'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

type Banner = { kind: 'success' | 'error'; message: string }
type Mode = 'auto' | 'ocr' | 'transcribe'

const OCR_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.tiff', '.bmp'])
const TRANSCRIBE_EXTS = new Set(['.mp3', '.wav', '.m4a', '.flac', '.ogg', '.opus', '.mp4', '.mov', '.mkv', '.webm', '.avi'])
const WHISPER_MODELS: WhisperModel[] = ['tiny', 'base', 'small', 'medium', 'large-v3']

interface RecentItem {
  id: string
  path: string
  mode: 'ocr' | 'transcribe'
  text: string
  language?: string
  sidecarPath?: string
  cacheHit?: boolean
  ranAt: number
}

function detectMode(path: string): 'ocr' | 'transcribe' | null {
  const lower = path.toLowerCase()
  const dot = lower.lastIndexOf('.')
  if (dot === -1) return null
  const ext = lower.slice(dot)
  if (OCR_EXTS.has(ext)) return 'ocr'
  if (TRANSCRIBE_EXTS.has(ext)) return 'transcribe'
  return null
}

export function ExtractorPage() {
  const { activeProject } = useProject()
  const [path, setPath] = useState('')
  const [mode, setMode] = useState<Mode>('auto')
  const [language, setLanguage] = useState('')
  const [whisperModel, setWhisperModel] = useState<WhisperModel>(DEFAULT_WHISPER_MODEL)
  const [force, setForce] = useState(false)
  const [busy, setBusy] = useState(false)
  const [banner, setBanner] = useState<Banner | null>(null)
  const [recent, setRecent] = useState<RecentItem[]>([])
  const [workspaceOpen, setWorkspaceOpen] = useState(false)

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    const file = e.dataTransfer.files?.[0]
    if (!file) return
    // Electron preserves the absolute path on dropped File objects.
    const anyFile = file as File & { path?: string }
    if (typeof anyFile.path === 'string' && anyFile.path) {
      setPath(anyFile.path)
    } else {
      setBanner({
        kind: 'error',
        message: 'Drag-drop lost the absolute path. Use the Browse button or paste the path manually.',
      })
    }
  }, [])

  const browseAvailable = isElectron()

  async function handleBrowse() {
    const detected = detectMode(path)
    const filters = mode === 'ocr' || (mode === 'auto' && detected === 'ocr')
      ? IMAGE_FILTERS
      : mode === 'transcribe' || (mode === 'auto' && detected === 'transcribe')
        ? MEDIA_FILTERS
        : [...IMAGE_FILTERS, ...MEDIA_FILTERS]
    const picked = await pickFile({ title: 'Select a file to extract', filters })
    if (picked) setPath(picked)
  }

  async function handleRun() {
    if (!path.trim()) return
    const detected = mode === 'auto' ? detectMode(path) : mode
    if (!detected) {
      setBanner({
        kind: 'error',
        message: 'Could not detect file type. Pick OCR or Transcribe explicitly.',
      })
      return
    }
    setBusy(true); setBanner(null)
    try {
      if (detected === 'ocr') {
        const result = await runOcr({ path: path.trim(), force })
        setRecent((r) => [
          {
            id: cryptoRandomId(),
            path: path.trim(),
            mode: 'ocr' as const,
            text: result.text,
            sidecarPath: result.sidecarPath,
            cacheHit: result.cacheHit,
            ranAt: Date.now(),
          },
          ...r,
        ].slice(0, 20))
        setBanner({ kind: 'success', message: result.cacheHit ? 'Loaded from sidecar cache.' : 'OCR complete.' })
      } else {
        const result = await runTranscribe({
          path: path.trim(),
          language: language.trim() || undefined,
          whisperModel,
          force,
        })
        setRecent((r) => [
          {
            id: cryptoRandomId(),
            path: path.trim(),
            mode: 'transcribe' as const,
            text: result.text,
            language: result.language,
            sidecarPath: result.sidecarPath,
            cacheHit: result.cacheHit,
            ranAt: Date.now(),
          },
          ...r,
        ].slice(0, 20))
        setBanner({ kind: 'success', message: result.cacheHit ? 'Loaded from sidecar cache.' : 'Transcription complete.' })
      }
    } catch (e) {
      setBanner({ kind: 'error', message: e instanceof Error ? e.message : 'Extraction failed.' })
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
              <h1 className='text-[28px] font-semibold leading-[1.1] tracking-[-0.025em]'>Extractor</h1>
              <p className='mt-1.5 max-w-2xl text-[13.5px] leading-relaxed text-muted-foreground'>
                OCR images and transcribe audio/video by driving <code className='font-mono text-foreground/80'>anubis-extractor</code>. Output is cached to <code className='font-mono text-foreground/80'>{'<file>.anubis.txt'}</code> next to the source — the Knowledge Base picks these up on re-index. First transcription with <code className='font-mono'>large-v3</code> may download ~3&nbsp;GB and take a few minutes.
              </p>
            </div>
            <button
              type='button'
              onClick={() => setWorkspaceOpen(true)}
              className='inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-border bg-card px-3.5 text-[12.5px] font-medium text-foreground transition-colors hover:bg-card/70'
            >
              <FolderSearchIcon className='size-[15px]' strokeWidth={1.8} />
              Extract Workspace
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
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
            className='rounded-lg border border-dashed border-border bg-card/60 px-6 py-7'
          >
            <div className='flex flex-col gap-1.5'>
              <label className='text-[12.5px] font-medium text-foreground'>File path</label>
              <div className='flex gap-2'>
                <input
                  type='text'
                  value={path}
                  onChange={(e) => setPath(e.target.value)}
                  placeholder='Absolute path to an image, audio, or video file…'
                  spellCheck={false}
                  className='h-10 w-full rounded-md border border-border bg-background px-3 font-mono text-[12.5px] text-foreground outline-none focus:border-[color-mix(in_oklab,var(--anubis-gold)_50%,var(--border))]'
                />
                <button
                  type='button'
                  onClick={() => void handleBrowse()}
                  disabled={!browseAvailable}
                  title={browseAvailable ? 'Pick a file' : 'Available in the desktop app only'}
                  className='inline-flex h-10 shrink-0 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-[12.5px] text-foreground transition-colors hover:bg-card/70 disabled:cursor-not-allowed disabled:opacity-50'
                >
                  <FolderSearchIcon className='size-[15px]' strokeWidth={1.8} />
                  Browse…
                </button>
              </div>
              <p className='text-[11.5px] text-muted-foreground'>
                Drag a file in, click Browse, or paste an absolute path.
              </p>
            </div>

            <div className='mt-4 flex flex-wrap items-end gap-3'>
              <label className='flex flex-col gap-1.5 text-[12.5px]'>
                <span className='font-medium text-foreground'>Mode</span>
                <select
                  value={mode}
                  onChange={(e) => setMode(e.target.value as Mode)}
                  className='h-10 rounded-md border border-border bg-background px-2 text-[12.5px] text-foreground'
                >
                  <option value='auto'>Auto (by extension)</option>
                  <option value='ocr'>OCR (image)</option>
                  <option value='transcribe'>Transcribe (audio/video)</option>
                </select>
              </label>

              {(mode === 'transcribe' || (mode === 'auto' && detectMode(path) === 'transcribe')) && (
                <>
                  <label className='flex flex-col gap-1.5 text-[12.5px]'>
                    <span className='font-medium text-foreground'>Language</span>
                    <input
                      type='text'
                      value={language}
                      onChange={(e) => setLanguage(e.target.value)}
                      placeholder='auto'
                      spellCheck={false}
                      className='h-10 w-24 rounded-md border border-border bg-background px-2 font-mono text-[12.5px] text-foreground'
                    />
                  </label>

                  <label className='flex flex-col gap-1.5 text-[12.5px]'>
                    <span className='font-medium text-foreground'>Whisper model</span>
                    <select
                      value={whisperModel}
                      onChange={(e) => setWhisperModel(e.target.value as WhisperModel)}
                      className='h-10 rounded-md border border-border bg-background px-2 text-[12.5px] text-foreground'
                    >
                      {WHISPER_MODELS.map((m) => (
                        <option key={m} value={m}>{m}{m === DEFAULT_WHISPER_MODEL ? ' (default)' : ''}</option>
                      ))}
                    </select>
                  </label>
                </>
              )}

              <label className='flex items-center gap-2 text-[12.5px]'>
                <input
                  type='checkbox'
                  checked={force}
                  onChange={(e) => setForce(e.target.checked)}
                />
                <span className='text-foreground'>Bypass cache</span>
              </label>

              <button
                type='button'
                onClick={() => void handleRun()}
                disabled={!path.trim() || busy}
                className='ml-auto inline-flex h-10 items-center gap-2 rounded-md bg-[var(--anubis-gold)] px-5 text-[13.5px] font-semibold text-[#0B0C0F] transition-colors hover:bg-[var(--anubis-gold-deep)] disabled:opacity-50'
              >
                <ScanTextIcon className='size-[15px]' strokeWidth={2} />
                {busy ? 'Running…' : 'Extract'}
              </button>
            </div>
          </div>
        </section>

        {recent.length > 0 && (
          <section className='mt-8 border-t border-border pt-6'>
            <div className='flex items-center justify-between'>
              <h2 className='font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground'>Recent extractions</h2>
              <button
                type='button'
                onClick={() => setRecent([])}
                className='text-[12px] text-muted-foreground hover:text-foreground'
              >
                Clear
              </button>
            </div>
            <ul className='mt-3 flex flex-col gap-3'>
              {recent.map((item) => (
                <li key={item.id} className='rounded-md border border-border bg-card px-3.5 py-3'>
                  <div className='flex items-baseline justify-between gap-3'>
                    <div className='flex items-baseline gap-2 truncate'>
                      {item.mode === 'ocr'
                        ? <FileTextIcon className='size-[14px] shrink-0 text-muted-foreground' strokeWidth={1.8} />
                        : <MicIcon className='size-[14px] shrink-0 text-muted-foreground' strokeWidth={1.8} />}
                      <span className='truncate font-mono text-[12px] text-muted-foreground'>{item.path}</span>
                    </div>
                    <span className='shrink-0 font-mono text-[11px] text-muted-foreground'>
                      {item.cacheHit ? 'cached · ' : ''}{new Date(item.ranAt).toLocaleTimeString()}
                    </span>
                  </div>
                  {item.language && (
                    <div className='mt-1 font-mono text-[11px] text-muted-foreground'>language: {item.language}</div>
                  )}
                  <pre className='mt-2 max-h-[260px] overflow-auto whitespace-pre-wrap break-words rounded border border-border bg-background p-2.5 text-[12px] text-foreground/90'>{item.text || '(empty)'}</pre>
                  {item.sidecarPath && (
                    <p className='mt-1.5 font-mono text-[11px] text-muted-foreground'>
                      sidecar: {item.sidecarPath}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      <ExtractWorkspaceModal
        open={workspaceOpen}
        onClose={() => setWorkspaceOpen(false)}
        projectId={activeProject?.id}
        projectName={activeProject?.name}
      />
    </div>
  )
}

/* ===========================================================
   ExtractWorkspaceModal
   ===========================================================
   Picks extraction kinds + cache behaviour, then fires a
   backend background job. Progress shows in the top-nav
   progress bar (reuses useJobs / TopNavProgress), so the
   modal simply closes once the job is enqueued.
   =========================================================== */

function ExtractWorkspaceModal({
  open,
  onClose,
  projectId,
  projectName,
}: {
  open: boolean
  onClose: () => void
  projectId: string | undefined
  projectName: string | undefined
}) {
  const [images, setImages] = useState(true)
  const [media, setMedia] = useState(true)
  const [force, setForce] = useState(false)
  const [whisperModel, setWhisperModel] = useState<WhisperModel>(DEFAULT_WHISPER_MODEL)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleStart() {
    if (!projectId) {
      setError('No active project. Pick a project before extracting its workspace.')
      return
    }
    if (!images && !media) {
      setError('Select at least one of Images or Audio/Videos.')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      await extractWorkspace({
        projectId,
        images,
        media,
        force,
        whisperModel: media ? whisperModel : undefined,
      })
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to start workspace extraction.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className='max-w-md bg-card'>
        <DialogHeader>
          <DialogTitle>Extract workspace</DialogTitle>
          <DialogDescription>
            Scan{projectName ? ` ${projectName}'s` : ' the active project'} workspace and extract
            text from media. Honors <code className='font-mono'>.anubisignore</code> (skips
            node_modules, build output, etc.). Runs as a background job — progress shows in the top
            bar.
          </DialogDescription>
        </DialogHeader>

        <div className='flex flex-col gap-3 px-1 py-1'>
          <label className='flex items-start gap-2.5 rounded-md border border-border bg-background px-3 py-2.5 text-[13px]'>
            <input
              type='checkbox'
              checked={images}
              onChange={(e) => setImages(e.target.checked)}
              className='mt-0.5'
            />
            <span>
              <span className='flex items-center gap-1.5 font-medium text-foreground'>
                <ImageIcon className='size-[14px]' strokeWidth={1.8} /> Extract Images
              </span>
              <span className='mt-0.5 block text-[11.5px] text-muted-foreground'>
                OCR <code className='font-mono'>.jpg .jpeg .png .webp …</code>
              </span>
            </span>
          </label>

          <label className='flex items-start gap-2.5 rounded-md border border-border bg-background px-3 py-2.5 text-[13px]'>
            <input
              type='checkbox'
              checked={media}
              onChange={(e) => setMedia(e.target.checked)}
              className='mt-0.5'
            />
            <span className='flex-1'>
              <span className='flex items-center gap-1.5 font-medium text-foreground'>
                <MicIcon className='size-[14px]' strokeWidth={1.8} /> Extract Audio/Videos
              </span>
              <span className='mt-0.5 block text-[11.5px] text-muted-foreground'>
                Whisper transcription of <code className='font-mono'>.mp4 .m4a .mp3 .wav …</code>
              </span>
              {media && (
                <span className='mt-2 flex items-center gap-2 text-[12px]'>
                  <span className='text-muted-foreground'>Whisper model</span>
                  <select
                    value={whisperModel}
                    onClick={(e) => e.preventDefault()}
                    onChange={(e) => setWhisperModel(e.target.value as WhisperModel)}
                    className='h-8 rounded-md border border-border bg-background px-2 text-[12px] text-foreground'
                  >
                    {WHISPER_MODELS.map((m) => (
                      <option key={m} value={m}>{m}{m === DEFAULT_WHISPER_MODEL ? ' (default)' : ''}</option>
                    ))}
                  </select>
                </span>
              )}
            </span>
          </label>

          <label className='flex items-center gap-2.5 px-1 text-[13px]'>
            <input
              type='checkbox'
              checked={force}
              onChange={(e) => setForce(e.target.checked)}
            />
            <span className='text-foreground'>Bypass cache</span>
            <span className='text-[11.5px] text-muted-foreground'>(ignore existing sidecars)</span>
          </label>

          {error && (
            <p className='rounded-md border border-[color-mix(in_oklab,var(--destructive)_40%,var(--border))] bg-[color-mix(in_oklab,var(--destructive)_10%,transparent)] px-3 py-2 text-[12px] text-destructive'>
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <button
            type='button'
            onClick={onClose}
            className='inline-flex h-9 items-center rounded-md px-3.5 text-[13.5px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
          >
            Cancel
          </button>
          <button
            type='button'
            disabled={submitting || (!images && !media)}
            onClick={() => void handleStart()}
            className='inline-flex h-9 items-center gap-1.5 rounded-md bg-[var(--anubis-gold)] px-4 text-[13.5px] font-semibold text-[#0B0C0F] transition-colors hover:bg-[var(--anubis-gold-deep)] disabled:opacity-50'
          >
            {submitting ? <Loader2Icon className='size-[15px] animate-spin' /> : <ScanTextIcon className='size-[15px]' strokeWidth={2} />}
            {submitting ? 'Starting…' : 'Start extraction'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function cryptoRandomId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

