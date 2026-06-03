import { z } from 'zod'

/* -----------------------------------------------------------
   Wire protocol for the Anubis ↔ extension WebSocket.
   Both directions are JSON text frames. Each frame is one of
   the schemas below; unknown `type`s are dropped server-side
   so we can add fields without breaking older extensions.
   ----------------------------------------------------------- */

export const HelloFrame = z.object({
  type: z.literal('hello'),
  secret: z.string().min(16),
  version: z.string().min(1),
}).strict()

export const ProgressFrame = z.object({
  type: z.literal('progress'),
  jobId: z.string().min(1),
  message: z.string(),
}).strict()

export const ResultFrame = z.object({
  type: z.literal('result'),
  jobId: z.string().min(1),
  ok: z.literal(true),
  data: z.unknown(),
}).strict()

export const ErrorFrame = z.object({
  type: z.literal('error'),
  jobId: z.string().min(1),
  ok: z.literal(false),
  code: z.string().min(1),
  message: z.string(),
}).strict()

export const ExtensionToBackend = z.discriminatedUnion('type', [
  HelloFrame,
  ProgressFrame,
  ResultFrame,
  ErrorFrame,
])

export const DispatchFrame = z.object({
  type: z.literal('dispatch'),
  jobId: z.string().min(1),
  kind: z.enum(['capture-profile', 'discover']),
  input: z.unknown(),
  timeoutMs: z.number().int().positive(),
}).strict()

export const CancelFrame = z.object({
  type: z.literal('cancel'),
  jobId: z.string().min(1),
}).strict()

export const WelcomeFrame = z.object({
  type: z.literal('welcome'),
  backendVersion: z.string(),
}).strict()

export const BackendToExtension = z.discriminatedUnion('type', [
  WelcomeFrame,
  DispatchFrame,
  CancelFrame,
])

export type HelloFrame = z.infer<typeof HelloFrame>
export type ProgressFrame = z.infer<typeof ProgressFrame>
export type ResultFrame = z.infer<typeof ResultFrame>
export type ErrorFrame = z.infer<typeof ErrorFrame>
export type DispatchFrame = z.infer<typeof DispatchFrame>
export type CancelFrame = z.infer<typeof CancelFrame>
export type WelcomeFrame = z.infer<typeof WelcomeFrame>

/**
 * Input shapes the backend passes through to the extension. These
 * mirror the existing crawler input fields the extension needs; the
 * extension does NOT see chromePath / profileDir etc.
 */
export interface CaptureProfileExtInput {
  username: string
  maxResponses: number
}
export interface DiscoverExtInput {
  source: 'explore' | 'hashtag' | 'keyword'
  hashtag?: string
  keyword?: string
  targetCompetitors: number
}
