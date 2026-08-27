import { useCallback, useState } from 'react'
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
      <label className={css.row}>
        <input type="checkbox" checked={value.enabled} disabled={saving} onChange={event => void patch({ enabled: event.target.checked })} />
        <span>{t('enabled')}</span>
      </label>
      <label className={css.row}>
        <input type="checkbox" checked={value.projectMemoryEnabled} disabled={saving} onChange={event => void patch({ projectMemoryEnabled: event.target.checked })} />
        <span>{t('projectMemoryEnabled')}</span>
      </label>
      <label className={css.field}>
        <span>{t('defaultLimit')}</span>
        <input type="number" min={1} max={20} value={value.defaultLimit} disabled={saving} onChange={event => void patch({ defaultLimit: Number(event.target.value) })} />
      </label>
      <label className={css.field}>
        <span>{t('retentionDays')}</span>
        <input type="number" min={0} max={3650} value={value.retentionDays} disabled={saving} onChange={event => void patch({ retentionDays: Number(event.target.value) })} />
      </label>
      <label className={css.row}>
        <input type="checkbox" checked={value.automaticCapture} disabled={saving} onChange={event => void patch({ automaticCapture: event.target.checked })} />
        <span>{t('automaticCapture')}</span>
      </label>
      {value.automaticCapture && (
        <>
          <label className={css.row}>
            <input type="checkbox" checked={value.capturePreferences} disabled={saving} onChange={event => void patch({ capturePreferences: event.target.checked })} />
            <span>{t('capturePreferences')}</span>
          </label>
          <label className={css.row}>
            <input type="checkbox" checked={value.captureConventions} disabled={saving} onChange={event => void patch({ captureConventions: event.target.checked })} />
            <span>{t('captureConventions')}</span>
          </label>
          <label className={css.row}>
            <input type="checkbox" checked={value.captureCorrections} disabled={saving} onChange={event => void patch({ captureCorrections: event.target.checked })} />
            <span>{t('captureCorrections')}</span>
          </label>
          <label className={css.field}>
            <span>{t('captureMaxPerSession')}</span>
            <input type="number" min={1} max={20} value={value.captureMaxPerSession} disabled={saving} onChange={event => void patch({ captureMaxPerSession: Number(event.target.value) })} />
          </label>
          <p className={css.note}>{t('captureNote')}</p>
        </>
      )}
      <label className={css.row}>
        <input type="checkbox" checked={value.automaticInjection} disabled={saving} onChange={event => void patch({ automaticInjection: event.target.checked })} />
        <span>{t('automaticInjection')}</span>
      </label>
      <label className={css.row}>
        <input type="checkbox" checked={value.includeUserMemory} disabled={saving} onChange={event => void patch({ includeUserMemory: event.target.checked })} />
        <span>{t('includeUserMemory')}</span>
      </label>
      <label className={css.row}>
        <input type="checkbox" checked={value.includeProjectMemory} disabled={saving} onChange={event => void patch({ includeProjectMemory: event.target.checked })} />
        <span>{t('includeProjectMemory')}</span>
      </label>
      <label className={css.field}>
        <span>{t('injectionLimit')}</span>
        <input type="number" min={1} max={10} value={value.injectionLimit} disabled={saving} onChange={event => void patch({ injectionLimit: Number(event.target.value) })} />
      </label>
      <label className={css.field}>
        <span>{t('injectionMaxChars')}</span>
        <input type="number" min={500} max={8000} value={value.injectionMaxChars} disabled={saving} onChange={event => void patch({ injectionMaxChars: Number(event.target.value) })} />
      </label>
      <p className={css.note}>{t('injectionNote')}</p>
      {!value.enabled && <p className={css.note}>{t('disabledNote')}</p>}
    </section>
  )
}
