/* Mirror of backend wire shapes. We don't import from @anubis/backend
   because the extension is its own build target. Kept in sync by hand
   + the dispatch integration test in backend. */

export type ExtKind = 'capture-profile' | 'discover'

export interface DispatchFrame {
  type: 'dispatch'
  jobId: string
  kind: ExtKind
  input: unknown
  timeoutMs: number
}
export interface CancelFrame { type: 'cancel'; jobId: string }
export interface WelcomeFrame { type: 'welcome'; backendVersion: string }

export type BackendFrame = DispatchFrame | CancelFrame | WelcomeFrame

export interface HelloFrame { type: 'hello'; secret: string; version: string }
export interface ProgressFrame { type: 'progress'; jobId: string; message: string }
export interface ResultFrame { type: 'result'; jobId: string; ok: true; data: unknown }
export interface ErrorFrame { type: 'error'; jobId: string; ok: false; code: string; message: string }

export const PORT_RANGE: readonly number[] = [47891, 47892, 47893, 47894, 47895, 47896, 47897, 47898, 47899, 47900]
