/**
 * dsh-meow preference row in the Settings General section.
 *
 * Talks to the same-origin /meow routes. The row owns its own React state; the
 * player reads the state returned by each /meow/events poll, so a toggle takes
 * effect within one poll interval. The master switch is the enable/disable
 * control; the per-event checkboxes, subagent opt-in, volume, and Test control
 * appear only while it is on.
 *
 * @module dsh-meow/client/MeowRow
 */
import { useCallback, useEffect, useState, useSyncExternalStore, type CSSProperties } from 'react'
import type { MeowState } from '../types.ts'
import { getMeowState, MeowApiError, setMeowState } from './api.ts'
import { playMeow } from './audio.ts'
import { activeLocale, subscribeLocale, translate } from './locales.ts'

/** The registration-side injected face (empty - the row owns its own state). */
export interface MeowRowInjected {
  /** Marker field: no business face is shared with the apply world. */
  children?: never
}

/** Full component props of the row. */
export type MeowRowProps = MeowRowInjected

/** Re-render on locale switches (the DSH locale service is uSES-safe). */
function useLocale(): string {
  return useSyncExternalStore(subscribeLocale, activeLocale)
}

const rowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 8,
  padding: '16px 0',
  borderBottom: '1px solid var(--dsw-alias-border-l2)',
}

const leftStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  paddingRight: 48,
}

const titleStyle: CSSProperties = {
  fontSize: 14,
  fontWeight: 400,
  lineHeight: '22px',
  color: 'var(--dsw-alias-label-primary)',
}

const descStyle: CSSProperties = {
  fontSize: 12,
  fontWeight: 400,
  lineHeight: '18px',
  color: 'var(--dsw-alias-label-tertiary)',
}

const optionsStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: '6px 16px',
  marginTop: 2,
}

const labelStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 12,
  lineHeight: '18px',
  color: 'var(--dsw-alias-label-secondary)',
  cursor: 'pointer',
}

const volumeStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  fontSize: 12,
  lineHeight: '18px',
  color: 'var(--dsw-alias-label-secondary)',
}

const testStyle: CSSProperties = {
  border: 'none',
  background: 'transparent',
  padding: 0,
  font: 'inherit',
  fontSize: 12,
  lineHeight: '18px',
  color: 'var(--dsw-alias-state-business-primary)',
  cursor: 'pointer',
}

const errorStyle: CSSProperties = {
  fontSize: 12,
  lineHeight: '18px',
  color: 'var(--dsw-alias-label-danger, #d92d20)',
}

/** Custom switch: a real checkbox driving a styled track/thumb. */
function Switch(props: {
  checked: boolean
  disabled?: boolean
  label: string
  onChange: (next: boolean) => void
}) {
  const { checked, disabled, label, onChange } = props
  return (
    <label style={{ position: 'relative', display: 'inline-flex', flex: 'none', marginTop: 2, cursor: disabled === true ? 'default' : 'pointer', opacity: disabled === true ? 0.6 : 1 }}>
      <input
        type="checkbox"
        style={{ position: 'absolute', width: 1, height: 1, margin: 0, opacity: 0 }}
        checked={checked}
        disabled={disabled === true}
        aria-label={label}
        onChange={event => { onChange(event.currentTarget.checked) }}
      />
      <span
        aria-hidden="true"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          width: 36,
          height: 20,
          padding: 2,
          boxSizing: 'border-box',
          borderRadius: 10,
          border: '1px solid ' + (checked ? 'var(--dsw-alias-button-primary-fill)' : 'var(--dsw-alias-border-l2)'),
          background: checked ? 'var(--dsw-alias-button-primary-fill)' : 'var(--dsw-alias-bg-layer-1)',
          transition: 'background 0.15s ease, border-color 0.15s ease',
        }}
      >
        <span
          style={{
            display: 'block',
            width: 14,
            height: 14,
            borderRadius: '50%',
            background: checked ? 'var(--dsw-alias-bg-layer-3)' : 'var(--dsw-alias-label-secondary)',
            transform: checked ? 'translateX(16px)' : 'none',
            transition: 'transform 0.15s ease, background 0.15s ease',
          }}
        />
      </span>
    </label>
  )
}

/** One labeled checkbox for an event kind. */
function Check(props: {
  checked: boolean
  disabled: boolean
  label: string
  onChange: (next: boolean) => void
}) {
  return (
    <label style={{ ...labelStyle, opacity: props.disabled ? 0.6 : 1 }}>
      <input
        type="checkbox"
        checked={props.checked}
        disabled={props.disabled}
        onChange={event => { props.onChange(event.currentTarget.checked) }}
      />
      <span>{props.label}</span>
    </label>
  )
}

/**
 * Render the meow preference row.
 * @returns the row element tree.
 */
export function MeowRow(_props: MeowRowProps) {
  useLocale()
  const [state, setState] = useState<MeowState | null>(null)
  const [draftVolume, setDraftVolume] = useState(0.5)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (): Promise<void> => {
    try {
      const fresh = await getMeowState()
      setState(fresh)
      setDraftVolume(fresh.volume)
      setError(null)
    } catch (cause) {
      setError(cause instanceof MeowApiError ? cause.message : translate('loadFailed'))
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const save = useCallback(async (patch: Partial<MeowState>): Promise<void> => {
    setBusy(true)
    setError(null)
    setState(current => (current === null ? current : { ...current, ...patch }))
    try {
      const fresh = await setMeowState(patch)
      setState(fresh)
      setDraftVolume(fresh.volume)
    } catch (cause) {
      setError(cause instanceof MeowApiError ? cause.message : translate('saveFailed'))
      await load()
    } finally {
      setBusy(false)
    }
  }, [load])

  const enabled = state?.enabled === true
  const locked = busy || state === null

  return (
    <div style={rowStyle}>
      <div style={leftStyle}>
        <div style={titleStyle}>{translate('title')}</div>
        <div style={descStyle}>{translate('desc')}</div>

        {state === null && !busy && <div style={descStyle}>{translate('loading')}</div>}

        {state !== null && enabled && (
          <div style={optionsStyle}>
            <Check checked={state.onApproval} disabled={locked} label={translate('onApproval')} onChange={value => { void save({ onApproval: value }) }} />
            <Check checked={state.onQuestion} disabled={locked} label={translate('onQuestion')} onChange={value => { void save({ onQuestion: value }) }} />
            <Check checked={state.onError} disabled={locked} label={translate('onError')} onChange={value => { void save({ onError: value }) }} />
            <Check checked={state.onDone} disabled={locked} label={translate('onDone')} onChange={value => { void save({ onDone: value }) }} />
            <Check checked={state.includeSubagents} disabled={locked} label={translate('includeSubagents')} onChange={value => { void save({ includeSubagents: value }) }} />
          </div>
        )}

        {state !== null && enabled && (
          <div style={optionsStyle}>
            <span style={volumeStyle}>
              <span>{translate('volume')}</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={draftVolume}
                disabled={locked}
                aria-label={translate('volume')}
                onChange={event => { setDraftVolume(Number(event.currentTarget.value)) }}
                onPointerUp={() => { void save({ volume: draftVolume }) }}
                onKeyUp={() => { void save({ volume: draftVolume }) }}
              />
            </span>
            <button type="button" style={testStyle} onClick={() => { playMeow('done', draftVolume) }}>
              {translate('test')}
            </button>
          </div>
        )}

        {error !== null && <div role="alert" style={errorStyle}>{error}</div>}
      </div>

      <Switch
        checked={enabled}
        disabled={locked}
        label={translate('title')}
        onChange={value => { void save({ enabled: value }) }}
      />
    </div>
  )
}
