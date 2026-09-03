import { useCallback, useState } from 'react'
import type { ReactNode } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { MemorySettings } from '../host/settings.ts'
import type { MemoryLocaleKey } from './locales.ts'
import css from './memory-settings.module.css'

export interface MemorySettingsInjected {
  t: (key: MemoryLocaleKey) => string
  read: () => MemorySettings
  update: (patch: Partial<MemorySettings>) => Promise<void>
}

type Props = PropsRuntime<'settings.section'> & PropsLocale<'hermes-memory'> & MemorySettingsInjected

interface SettingsGroupProps {
  title: string
  description: string
  children: ReactNode
}

interface ToggleRowProps {
  label: string
  checked: boolean
  disabled: boolean
  onChange: (checked: boolean) => void
}

interface NumberRowProps {
  label: string
  value: number
  min: number
  max: number
  disabled: boolean
  onChange: (value: number) => void
}

function SettingsGroup({ title, description, children }: SettingsGroupProps): JSX.Element {
  return (
    <div className={css.group}>
      <header className={css.groupHeader}>
        <h2 className={css.groupTitle}>{title}</h2>
        <p className={css.groupDescription}>{description}</p>
      </header>
      <div className={css.rows}>{children}</div>
    </div>
  )
}

function ToggleRow({ label, checked, disabled, onChange }: ToggleRowProps): JSX.Element {
  return (
    <label className={css.row}>
      <span className={css.rowCopy}>{label}</span>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={event => onChange(event.target.checked)} />
    </label>
  )
}

function NumberRow({ label, value, min, max, disabled, onChange }: NumberRowProps): JSX.Element {
  return (
    <label className={css.field}>
      <span>{label}</span>
      <input type="number" min={min} max={max} value={value} disabled={disabled} onChange={event => onChange(Number(event.target.value))} />
    </label>
  )
}

export function MemorySettingsSection({ t, read, update }: Props): JSX.Element {
  const [value, setValue] = useState(read)
  const [saving, setSaving] = useState(false)

  const patch = useCallback(async (next: Partial<MemorySettings>) => {
    const merged = { ...value, ...next }
    setValue(merged)
    setSaving(true)
    try { await update(next) } finally { setSaving(false) }
  }, [update, value])

  return (
    <section className={css.section}>
      <p className={css.description}>{t('description')}</p>

      <SettingsGroup title={t('baseTitle')} description={t('baseDescription')}>
        <ToggleRow label={t('enabled')} checked={value.enabled} disabled={saving} onChange={enabled => void patch({ enabled })} />
        <ToggleRow label={t('projectMemoryEnabled')} checked={value.projectMemoryEnabled} disabled={saving} onChange={projectMemoryEnabled => void patch({ projectMemoryEnabled })} />
        <NumberRow label={t('defaultLimit')} value={value.defaultLimit} min={1} max={20} disabled={saving} onChange={defaultLimit => void patch({ defaultLimit })} />
      </SettingsGroup>

      <SettingsGroup title={t('captureTitle')} description={t('captureDescription')}>
        <ToggleRow label={t('automaticCapture')} checked={value.automaticCapture} disabled={saving} onChange={automaticCapture => void patch({ automaticCapture })} />
        {value.automaticCapture && (
          <div className={css.nested}>
            <ToggleRow label={t('capturePreferences')} checked={value.capturePreferences} disabled={saving} onChange={capturePreferences => void patch({ capturePreferences })} />
            <ToggleRow label={t('captureConventions')} checked={value.captureConventions} disabled={saving} onChange={captureConventions => void patch({ captureConventions })} />
            <ToggleRow label={t('captureCorrections')} checked={value.captureCorrections} disabled={saving} onChange={captureCorrections => void patch({ captureCorrections })} />
            <ToggleRow label={t('captureToolContext')} checked={value.captureToolContext} disabled={saving} onChange={captureToolContext => void patch({ captureToolContext })} />
            <NumberRow label={t('captureMaxPerSession')} value={value.captureMaxPerSession} min={1} max={20} disabled={saving} onChange={captureMaxPerSession => void patch({ captureMaxPerSession })} />
            <p className={css.note}>{t('captureNote')}</p>
          </div>
        )}
      </SettingsGroup>

      <SettingsGroup title={t('injectionTitle')} description={t('injectionDescription')}>
        <ToggleRow label={t('automaticInjection')} checked={value.automaticInjection} disabled={saving} onChange={automaticInjection => void patch({ automaticInjection })} />
        {value.automaticInjection && (
          <div className={css.nested}>
            <ToggleRow label={t('includeUserMemory')} checked={value.includeUserMemory} disabled={saving} onChange={includeUserMemory => void patch({ includeUserMemory })} />
            <ToggleRow label={t('includeProjectMemory')} checked={value.includeProjectMemory} disabled={saving} onChange={includeProjectMemory => void patch({ includeProjectMemory })} />
            <NumberRow label={t('injectionLimit')} value={value.injectionLimit} min={1} max={10} disabled={saving} onChange={injectionLimit => void patch({ injectionLimit })} />
            <NumberRow label={t('injectionMaxChars')} value={value.injectionMaxChars} min={500} max={8000} disabled={saving} onChange={injectionMaxChars => void patch({ injectionMaxChars })} />
            <p className={css.note}>{t('injectionNote')}</p>
          </div>
        )}
      </SettingsGroup>

      <SettingsGroup title={t('lifecycleTitle')} description={t('lifecycleDescription')}>
        <ToggleRow label={t('retentionEnabled')} checked={value.retentionEnabled} disabled={saving} onChange={retentionEnabled => void patch({ retentionEnabled })} />
        {value.retentionEnabled && (
          <div className={css.nested}>
            <NumberRow label={t('retentionDays')} value={value.retentionDays} min={0} max={3650} disabled={saving} onChange={retentionDays => void patch({ retentionDays })} />
            <NumberRow label={t('failureRetentionDays')} value={value.failureRetentionDays} min={1} max={3650} disabled={saving} onChange={failureRetentionDays => void patch({ failureRetentionDays })} />
          </div>
        )}
        <ToggleRow label={t('automaticReview')} checked={value.automaticReview} disabled={saving} onChange={automaticReview => void patch({ automaticReview })} />
        {value.automaticReview && (
          <div className={css.nested}>
            <NumberRow label={t('reviewMaxPerSession')} value={value.reviewMaxPerSession} min={1} max={20} disabled={saving} onChange={reviewMaxPerSession => void patch({ reviewMaxPerSession })} />
            <NumberRow label={t('reviewMaxInputChars')} value={value.reviewMaxInputChars} min={2000} max={30000} disabled={saving} onChange={reviewMaxInputChars => void patch({ reviewMaxInputChars })} />
            <p className={css.note}>{t('reviewNote')}</p>
          </div>
        )}
      </SettingsGroup>

      {!value.enabled && <p className={css.note}>{t('disabledNote')}</p>}
    </section>
  )
}
