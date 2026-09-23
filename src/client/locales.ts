/**
 * zh/en copy for the dsh-meow Settings row, registered into the DSH locale
 * registry under the plugin namespace. attachLocale binds the client locale
 * service at apply time; translate resolves the active locale through it,
 * falling back to the browser language when the service is absent.
 */

/** Locale dictionary key space (one key per row string). */
export type MeowDict = {
  title: string
  desc: string
  onApproval: string
  onQuestion: string
  onError: string
  onDone: string
  includeSubagents: string
  volume: string
  test: string
  loading: string
  loadFailed: string
  saveFailed: string
}

/** Simplified Chinese copy. */
export const zh: MeowDict = {
  title: '喵叫提示音',
  desc: '在需要确认、需要输入、出现错误或任务完成时播放一声喵叫。',
  onApproval: '需要确认时',
  onQuestion: '需要输入时',
  onError: '出现错误时',
  onDone: '任务完成时',
  includeSubagents: '包含子代理会话',
  volume: '音量',
  test: '试听',
  loading: '加载中…',
  loadFailed: '无法读取提示音设置',
  saveFailed: '保存失败',
}

/** English copy. */
export const en: MeowDict = {
  title: 'Meow notification sound',
  desc: 'Play a meow when DSH needs confirmation, needs input, hits an error, or finishes a turn.',
  onApproval: 'Confirmation needed',
  onQuestion: 'Input needed',
  onError: 'Something went wrong',
  onDone: 'Task done',
  includeSubagents: 'Include subagent sessions',
  volume: 'Volume',
  test: 'Test',
  loading: 'Loading…',
  loadFailed: 'Failed to read the sound settings',
  saveFailed: 'Failed to save',
}

/** The plugin's locale namespace (dictionary registry key). */
export const LOCALE_NS = 'meow'

/** The locale service face this plugin consumes (subset of LocaleRuntime). */
export interface MeowLocaleService {
  getSnapshot(): { active: string }
  subscribe(fn: () => void): () => void
  register(ns: string, locale: string, dict: Record<string, string>): () => void
}

let service: MeowLocaleService | undefined

/** Bind the locale service (apply time); the row re-renders on locale switches. */
export function attachLocale(locale: MeowLocaleService): void {
  service = locale
}

/** Current active locale id ('zh' | 'en'), or a browser-language guess. */
export function activeLocale(): string {
  if (service !== undefined) return service.getSnapshot().active
  if (typeof navigator !== 'undefined') {
    const primary = (navigator.language ?? '').toLowerCase().split('-')[0]
    if (primary === 'zh') return 'zh'
  }
  return 'en'
}

/** Resolve one copy key in the active locale. */
export function translate(key: keyof MeowDict): string {
  const dict = activeLocale() === 'zh' ? zh : en
  return dict[key] ?? String(key)
}

/** React subscription seam for the active locale (useSyncExternalStore). */
export function subscribeLocale(fn: () => void): () => void {
  return service?.subscribe(fn) ?? (() => {})
}
