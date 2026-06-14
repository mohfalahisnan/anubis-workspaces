import { useEffect, useState } from 'react'
import { getBrandContext, saveBrandContext } from '@/api'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

interface Fields {
  brandGuideline: string
  toneOfVoice: string
  targetAudience: string
  nichePositioning: string
  contentRules: string
}

const EMPTY: Fields = {
  brandGuideline: '', toneOfVoice: '', targetAudience: '', nichePositioning: '', contentRules: '',
}

const ROWS: Array<{ key: keyof Fields; label: string }> = [
  { key: 'brandGuideline', label: 'Brand guideline' },
  { key: 'toneOfVoice', label: 'Tone of voice' },
  { key: 'targetAudience', label: 'Target audience' },
  { key: 'nichePositioning', label: 'Niche positioning' },
  { key: 'contentRules', label: 'Content rules' },
]

export function BrandContextDialog({
  open,
  projectId,
  onClose,
}: {
  open: boolean
  projectId: string
  onClose: () => void
}) {
  const [fields, setFields] = useState<Fields>(EMPTY)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    void getBrandContext(projectId).then((bc) => {
      if (cancelled) return
      setFields({
        brandGuideline: bc.brandGuideline,
        toneOfVoice: bc.toneOfVoice,
        targetAudience: bc.targetAudience,
        nichePositioning: bc.nichePositioning,
        contentRules: bc.contentRules,
      })
    })
    return () => { cancelled = true }
  }, [open, projectId])

  async function save() {
    setBusy(true)
    try {
      await saveBrandContext(projectId, fields)
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent aria-describedby={undefined} className='sm:max-w-2xl bg-card'>
        <DialogHeader>
          <DialogTitle>Brand Context</DialogTitle>
        </DialogHeader>
        <div className='max-h-[60vh] space-y-3 overflow-y-auto pr-1'>
          {ROWS.map((row) => (
            <label key={row.key} className='block'>
              <span className='mb-1 block text-[12px] font-medium text-muted-foreground'>{row.label}</span>
              <textarea
                value={fields[row.key]}
                onChange={(e) => setFields((f) => ({ ...f, [row.key]: e.target.value }))}
                rows={3}
                className='w-full resize-y rounded-md border border-border bg-background px-2.5 py-2 text-[13px] outline-none focus:border-[var(--anubis-gold)]/60'
              />
            </label>
          ))}
        </div>
        <DialogFooter>
          <button type='button' onClick={onClose} className='inline-flex h-9 items-center rounded-md border border-border bg-card px-3.5 text-[13px] font-medium hover:bg-muted'>Cancel</button>
          <button type='button' onClick={() => void save()} disabled={busy} className='inline-flex h-9 items-center rounded-md bg-[var(--anubis-gold)] px-3.5 text-[13px] font-semibold text-[#0B0C0F] hover:bg-[var(--anubis-gold-deep)] disabled:opacity-50'>Save</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
