import { useEffect, useState } from 'react'
import type {
  AiReview, ContentLesson, ImprovedBrief, RawIdea, RefinedContent,
} from '@anubis/shared'
import { pipelineAssetUrl } from '@/lib/artifacts'

const card = 'rounded-md border border-border bg-card'
const cardHead = 'border-b border-border px-3 py-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-muted-foreground'
const cardBody = 'p-3 text-[13px] leading-relaxed text-foreground'
const fieldLabel = 'text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground'

export function Section({ title, children, right, id }: { title: string; children: React.ReactNode; right?: React.ReactNode; id?: string }) {
  return (
    <section id={id} className={`${card} scroll-mt-20`}>
      <div className='flex items-center justify-between'>
        <div className={cardHead}>{title}</div>
        {right ? <div className='px-3'>{right}</div> : null}
      </div>
      <div className={cardBody}>{children}</div>
    </section>
  )
}

function Field({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null
  return (
    <div className='mb-2'>
      <p className={fieldLabel}>{label}</p>
      <p className='mt-0.5 whitespace-pre-wrap text-foreground/90'>{value}</p>
    </div>
  )
}

function Chips({ label, items }: { label: string; items?: string[] }) {
  if (!items?.length) return null
  return (
    <div className='mb-2'>
      <p className={fieldLabel}>{label}</p>
      <div className='mt-1 flex flex-wrap gap-1'>
        {items.map((item, i) => (
          <span key={i} className='rounded border border-border bg-background px-1.5 py-0.5 text-[11px] text-muted-foreground'>{item}</span>
        ))}
      </div>
    </div>
  )
}

function AssetThumb({ itemId, fileName }: { itemId: string; fileName: string }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    pipelineAssetUrl(itemId, fileName).then((u) => { if (!cancelled) setUrl(u) }).catch(() => { if (!cancelled) setUrl(null) })
    return () => { cancelled = true }
  }, [itemId, fileName])
  if (!url) return <div className='h-20 w-20 animate-pulse rounded bg-muted' />
  return <img src={url} alt={fileName} className='h-20 w-20 rounded border border-border object-cover' />
}

export function LocalAssetStrip({ raw, itemId }: { raw: RawIdea; itemId?: string }) {
  const assets = raw.localAssets ?? []
  if (!assets.length) return null
  const images = assets.filter((a) => a.kind === 'image')
  const hasVideo = assets.some((a) => a.kind === 'video')
  return (
    <div className='mt-2'>
      <p className={fieldLabel}>Analyzed media</p>
      <div className='mt-1 flex flex-wrap gap-2'>
        {itemId
          ? images.map((a) => <AssetThumb key={a.fileName} itemId={itemId} fileName={a.fileName} />)
          : images.map((a) => (
            <span key={a.fileName} className='rounded border border-border bg-background px-1.5 py-0.5 text-[11px] text-muted-foreground'>{a.fileName}</span>
          ))}
        {hasVideo ? (
          <span className='inline-flex items-center rounded border border-border bg-background px-2 py-1 text-[11px] text-muted-foreground'>🎬 Video (transcript analyzed)</span>
        ) : null}
      </div>
    </div>
  )
}

export function RawIdeaSection({ raw, id = 'section-raw', itemId }: { raw: RawIdea; id?: string; itemId?: string }) {
  return (
    <Section title='Raw Idea' id={id}>
      <Field label='Caption' value={raw.caption} />
      <Field label='Transcript' value={raw.transcript} />
      <Field label='Source URL' value={raw.sourceUrl} />
      <Field label='Platform' value={raw.sourcePlatform} />
      <Field label='Competitor' value={raw.sourceCompetitor} />
      <Chips label='Assets' items={raw.assetRefs} />
      <LocalAssetStrip raw={raw} itemId={itemId} />
    </Section>
  )
}

export function BriefSection({ brief, lessonsUsed, id = 'section-brief' }: { brief: ImprovedBrief; lessonsUsed: string[]; id?: string }) {
  return (
    <Section title='Improved Brief' id={id}>
      <Field label='Core idea' value={brief.coreIdea} />
      <Field label='Target audience' value={brief.targetAudience} />
      <Field label='Market fit' value={brief.marketFit} />
      <Field label='Problem' value={brief.problem} />
      <Field label='Main message' value={brief.mainMessage} />
      <Field label='Content angle' value={brief.contentAngle} />
      <Field label='Hook direction' value={brief.hookDirection} />
      <Field label='Brand alignment notes' value={brief.brandAlignmentNotes} />
      <Field label='Tone direction' value={brief.toneDirection} />
      <Field label='Adaptation strategy' value={brief.adaptationStrategy} />
      <Field label='Risk notes' value={brief.riskNotes} />
      <Chips label='Reference lessons' items={brief.referenceLessons.length ? brief.referenceLessons : lessonsUsed} />
    </Section>
  )
}

export function RefinedSection({ refined, id = 'section-refined' }: { refined: RefinedContent; id?: string }) {
  const v = refined.visualBrief
  const c = refined.copywriting
  return (
    <Section title='Refined Content' id={id}>
      <Field label='Caption' value={refined.caption} />
      <div className='mt-2 rounded border border-border bg-background p-2'>
        <p className={fieldLabel}>Visual brief</p>
        <Field label='Concept' value={v.concept} />
        <Field label='Scene' value={v.sceneDirection} />
        <Field label='Subject' value={v.subject} />
        <Field label='Layout' value={v.layout} />
        <Field label='Mood' value={v.mood} />
        <Field label='Style' value={v.style} />
        <Chips label='Key elements' items={v.keyElements} />
        <Field label='Text overlay' value={v.textOverlay} />
        <Field label='Negative direction' value={v.negativeDirection} />
      </div>
      <div className='mt-2 rounded border border-border bg-background p-2'>
        <p className={fieldLabel}>Copywriting</p>
        <Field label='Hook' value={c.hook} />
        <Field label='Body' value={c.body} />
        <Field label='CTA' value={c.cta} />
        <Field label='Text overlay' value={c.textOverlay} />
        <Chips label='Carousel slides' items={c.carouselSlides} />
        <Field label='Video script' value={c.videoScript} />
      </div>
      <div className='mt-2'>
        <Chips label='Primary hashtags' items={refined.hashtags.primary} />
        <Chips label='Niche hashtags' items={refined.hashtags.niche} />
        <Chips label='Brand-safe hashtags' items={refined.hashtags.brandSafe} />
        <Field label='Platform notes' value={refined.platformNotes} />
      </div>
    </Section>
  )
}

export function AiReviewSection({ review, id = 'section-ai-review' }: { review: AiReview; id?: string }) {
  const tone = review.decision === 'approved'
    ? 'border-[var(--anubis-success)]/45 bg-[var(--anubis-success)]/12 text-[var(--anubis-success)]'
    : 'border-destructive/45 bg-destructive/10 text-destructive'
  return (
    <Section
      title='AI Review'
      id={id}
      right={<span className={`rounded-md border px-2 py-0.5 text-[11px] font-medium ${tone}`}>{review.decision}{review.score != null ? ` · ${review.score}` : ''}</span>}
    >
      <Field label='Rejection reason' value={review.rejectionReason} />
      <Field label='Improvement instruction' value={review.improvementInstruction} />
      {review.checklist.length ? (
        <ul className='mt-1 space-y-1'>
          {review.checklist.map((item, i) => (
            <li key={i} className='flex gap-2 text-[12px]'>
              <span className={item.pass ? 'text-[var(--anubis-success)]' : 'text-destructive'}>{item.pass ? '✓' : '✗'}</span>
              <span className='text-foreground/90'>{item.criterion}{item.note ? ` — ${item.note}` : ''}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </Section>
  )
}

const LESSON_TYPES = [
  'content_quality', 'brand_alignment', 'tone_of_voice', 'niche_alignment',
  'visual_quality', 'copywriting_quality',
] as const

export function HumanReviewSection({
  busy,
  onApprove,
  onReject,
}: {
  busy: boolean
  onApprove: () => void
  onReject: (reason: string, type: string) => void
}) {
  const [reason, setReason] = useState('')
  const [type, setType] = useState<string>('content_quality')
  return (
    <Section title='Human Review' id='section-human-review'>
      <div className='flex flex-wrap items-center gap-2'>
        <button type='button' disabled={busy} onClick={onApprove} className={approveBtn}>Approve</button>
      </div>
      <div className='mt-3 rounded border border-border bg-background p-2'>
        <p className={fieldLabel}>Reject with reason (saved as a lesson)</p>
        <select value={type} onChange={(e) => setType(e.target.value)} className='mt-1 h-8 w-full rounded border border-border bg-background px-2 text-[12px]'>
          {LESSON_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          placeholder='What should be fixed? This becomes a lesson injected into the next brief.'
          className='mt-2 w-full resize-y rounded border border-border bg-background px-2 py-1.5 text-[13px] outline-none'
        />
        <button
          type='button'
          disabled={busy || !reason.trim()}
          onClick={() => onReject(reason.trim(), type)}
          className={rejectBtn}
        >
          Reject &amp; save lesson
        </button>
      </div>
    </Section>
  )
}

export function LessonHistorySection({ lessons }: { lessons: ContentLesson[] }) {
  if (!lessons.length) return <Section title='Lesson History' id='section-lessons'><p className='text-muted-foreground'>No lessons yet.</p></Section>
  return (
    <Section title='Lesson History' id='section-lessons'>
      <ul className='space-y-2'>
        {lessons.map((l) => (
          <li key={l.id} className='rounded border border-border bg-background p-2'>
            <div className='flex items-center gap-2 text-[11px] text-muted-foreground'>
              <span className='rounded border border-border px-1.5 py-0.5'>{l.source}</span>
              <span className='rounded border border-border px-1.5 py-0.5'>{l.type}</span>
            </div>
            <p className='mt-1 text-[12.5px] text-foreground/90'>{l.reason}</p>
            <p className='mt-0.5 text-[12px] text-muted-foreground'>How to improve: {l.howToImprove}</p>
          </li>
        ))}
      </ul>
    </Section>
  )
}

export function PhaseTwoPlaceholder({ title, note }: { title: string; note: string }) {
  return (
    <section className={`${card} opacity-60`}>
      <div className={cardHead}>{title}</div>
      <div className='p-3 text-[12px] text-muted-foreground'>{note} <span className='ml-1 rounded border border-border px-1.5 py-0.5'>Phase 2</span></div>
    </section>
  )
}

const approveBtn =
  'inline-flex h-9 items-center gap-2 rounded-md bg-[var(--anubis-success)] px-3.5 text-[13px] font-semibold text-[#0B0C0F] transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50'
const rejectBtn =
  'mt-2 inline-flex h-9 items-center gap-2 rounded-md border border-destructive/45 bg-destructive/10 px-3.5 text-[13px] font-medium text-destructive transition-colors hover:bg-destructive/15 disabled:cursor-not-allowed disabled:opacity-50'
