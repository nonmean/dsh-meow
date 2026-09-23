/**
 * dsh-meow browser half.
 *
 * Two responsibilities over one host:
 *
 * 1. Play a synthesized meow for each event the host queues (poll loop over
 *    /meow/events). The first poll adopts the host cursor without playing, so
 *    loading the page never replays an old backlog.
 * 2. Register the preference row into the Settings General section
 *    (settings.general.item). The row reads and writes /meow/state; this loop
 *    reads the settings returned by every poll, so a toggle applies within one
 *    interval.
 *
 * The host half is reached through plain same-origin /meow routes, so this
 * bundle has no value imports beyond the platform module table (react,
 * react/jsx-runtime); everything else is inlined.
 *
 * @module dsh-meow/client
 */
import type { Context } from '@deepseek-ai/cordis'
import type { MeowKind, MeowState } from '../types.ts'
import { getMeowEvents } from './api.ts'
import { installAudioUnlock, playMeow } from './audio.ts'
import { attachLocale, en, LOCALE_NS, zh, type MeowLocaleService } from './locales.ts'
import { MeowRow, type MeowRowInjected } from './MeowRow.tsx'

/** The client slots service face (subset of the runtime SlotRegistry). */
export interface MeowSlotsService {
  register(options: {
    name: string
    id?: string
    order?: number
    locale?: string
    inject?: (...args: unknown[]) => object
  }, component: unknown): () => void
  /** Run a callback for each declaration lifetime of a slot (no-op while undeclared). */
  inject(key: string, callback: () => () => void): () => void
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    slots: MeowSlotsService
    locale: MeowLocaleService
  }
}

/**
 * Services required before mounting: NONE - an inject-less row starts in the
 * first boot wave. The slots/locale surfaces mount from a child fiber that
 * waits for those services.
 */
export const inject: string[] = []

/** Poll cadence for queued meows; low latency without a busy loop. */
const POLL_INTERVAL_MS = 700

/** Whether the current settings enable one event kind. */
function kindEnabled(state: MeowState, kind: MeowKind): boolean {
  switch (kind) {
    case 'approval':
      return state.onApproval
    case 'question':
      return state.onQuestion
    case 'error':
      return state.onError
    case 'done':
      return state.onDone
    default:
      return false
  }
}

/**
 * Client plugin body.
 * @param ctx - the client cordis context (slots/locale via child fiber).
 */
export function apply(ctx: Context): void {
  ctx.inject(['slots', 'locale'], (uiCtx) => {
    // Follow the DSH i18n system: register the plugin's dictionaries into the
    // shared locale registry; the row re-renders on locale switches.
    attachLocale(uiCtx.locale)
    uiCtx.effect(() => {
      const offZh = uiCtx.locale.register(LOCALE_NS, 'zh', zh)
      const offEn = uiCtx.locale.register(LOCALE_NS, 'en', en)
      return () => {
        offZh()
        offEn()
      }
    }, 'dsh-meow: dictionaries')

    // The preference row in Settings > General.
    uiCtx.slots.inject('settings.general.item', () => uiCtx.slots.register({
      name: 'settings.general.item',
      id: 'meow',
      order: 16,
      inject: (): MeowRowInjected => ({}),
    }, MeowRow))

    // Resume audio on the first gesture so the first meow is audible.
    uiCtx.effect(() => installAudioUnlock(), 'dsh-meow: audio unlock')

    // Queued-meow poll loop. The first request carries no cursor: it adopts
    // the host cursor without playing anything.
    let cursor = -1
    let stopped = false
    let timer: number | undefined
    const poll = async (): Promise<void> => {
      try {
        const payload = await getMeowEvents(cursor)
        cursor = payload.cursor
        for (const event of payload.events) {
          if (kindEnabled(payload.state, event.kind)) playMeow(event.kind, payload.state.volume)
        }
      } catch {
        // The host may still be booting or the page may be offline; retry.
      }
      if (!stopped) timer = window.setTimeout(() => { void poll() }, POLL_INTERVAL_MS)
    }
    uiCtx.effect(() => () => {
      stopped = true
      if (timer !== undefined) window.clearTimeout(timer)
    }, 'dsh-meow: event poll')
    void poll()
  })
}
