/**
 * Typed browser caller for the same-origin /meow JSON routes.
 * @module dsh-meow/client/api
 */
import type { MeowEventsPayload, MeowState } from '../types.ts'

/** One wire failure (network errors carry code 'network'). */
export class MeowApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

/** Envelope wrapper shared by both routes. */
interface Envelope {
  ok?: boolean
  value?: unknown
  error?: { code?: string; message?: string }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, init)
  } catch (error) {
    throw new MeowApiError('network', error instanceof Error ? error.message : String(error))
  }
  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new MeowApiError('bad-response', 'dsh-meow: response is not JSON')
  }
  const envelope = body as Envelope
  if (envelope.ok !== true) {
    throw new MeowApiError(
      envelope.error?.code ?? 'unknown',
      envelope.error?.message ?? 'dsh-meow: request failed',
    )
  }
  return envelope.value as T
}

/** Read the persisted settings. */
export function getMeowState(signal?: AbortSignal): Promise<MeowState> {
  return request<MeowState>('/meow/state', { signal, headers: { accept: 'application/json' } })
}

/** Persist a partial settings patch and return the new settings. */
export function setMeowState(patch: Partial<MeowState>): Promise<MeowState> {
  return request<MeowState>('/meow/state', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(patch),
  })
}

/** Read events after a cursor. A negative cursor asks for no backlog. */
export function getMeowEvents(since: number, signal?: AbortSignal): Promise<MeowEventsPayload> {
  const query = since < 0 ? '' : '?since=' + String(since)
  return request<MeowEventsPayload>('/meow/events' + query, {
    signal,
    headers: { accept: 'application/json' },
  })
}
