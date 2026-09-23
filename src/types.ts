/**
 * Wire vocabulary shared by the dsh-meow host half (emits) and browser half
 * (consumes). Everything here is plain JSON.
 */

/** The four moments a meow can announce, plus their Settings toggles. */
export type MeowKind = 'approval' | 'question' | 'error' | 'done'

/** Plugin-owned settings, persisted by the host half. */
export interface MeowState {
  /** Master switch: false silences every meow. */
  enabled: boolean
  /** Meow when an approval (confirmation) is waiting for the user. */
  onApproval: boolean
  /** Meow when the model asks the user a question and needs input. */
  onQuestion: boolean
  /** Meow when a turn ends in failure. */
  onError: boolean
  /** Meow when a turn finishes successfully. */
  onDone: boolean
  /** Also announce turns belonging to subagent sessions. */
  includeSubagents: boolean
  /** Playback volume, 0..1. */
  volume: number
}

/** One queued meow trigger, addressed by a monotonically increasing seq. */
export interface MeowEvent {
  seq: number
  kind: MeowKind
  /** Unix epoch milliseconds when the host observed the event. */
  at: number
}

/** Body of GET /meow/events: events after the caller's cursor plus the new cursor. */
export interface MeowEventsPayload {
  events: MeowEvent[]
  cursor: number
  state: MeowState
}

/** Success envelope of the /meow JSON routes. */
export interface MeowSuccess<T> {
  ok: true
  value: T
}

/** Failure envelope of the /meow JSON routes. */
export interface MeowFailure {
  ok: false
  error: {
    code: string
    message: string
  }
}

/** Envelope of every /meow JSON route. */
export type MeowEnvelope<T> = MeowSuccess<T> | MeowFailure
