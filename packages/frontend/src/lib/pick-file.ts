/* -----------------------------------------------------------
   Thin wrapper around the Electron native file picker exposed
   via the preload bridge. Returns the absolute path of the
   chosen file, or null if cancelled / running outside Electron.
   ----------------------------------------------------------- */

export interface PickFileOptions {
  title?: string
  filters?: Array<{ name: string; extensions: string[] }>
}

export async function pickFile(opts?: PickFileOptions): Promise<string | null> {
  const picker = typeof window !== 'undefined' ? window.anubis?.files.pickOne : undefined
  if (!picker) return null
  return picker(opts)
}

/** True when the renderer is running inside Electron (preload bridge present). */
export function isElectron(): boolean {
  return typeof window !== 'undefined' && !!window.anubis
}

const isWindows = typeof navigator !== 'undefined' && /Win/i.test(navigator.platform)

/** Suggested filters for picking an executable binary path. */
export const EXECUTABLE_FILTERS: Array<{ name: string; extensions: string[] }> = isWindows
  ? [{ name: 'Executable', extensions: ['exe'] }, { name: 'All files', extensions: ['*'] }]
  : [{ name: 'All files', extensions: ['*'] }]

export const IMAGE_FILTERS: Array<{ name: string; extensions: string[] }> = [
  { name: 'Image', extensions: ['png', 'jpg', 'jpeg', 'webp', 'tiff', 'bmp'] },
  { name: 'All files', extensions: ['*'] },
]

export const MEDIA_FILTERS: Array<{ name: string; extensions: string[] }> = [
  { name: 'Audio / Video', extensions: ['mp3', 'wav', 'm4a', 'flac', 'ogg', 'opus', 'mp4', 'mov', 'mkv', 'webm', 'avi'] },
  { name: 'All files', extensions: ['*'] },
]
