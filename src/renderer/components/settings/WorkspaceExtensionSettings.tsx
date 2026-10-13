import React, { useEffect, useState } from 'react'
import { useSettingsStore } from '../../stores/settings.store'
import { UseGlobalButton } from './UseGlobalButton'
import {
  ExtensionSettingRow,
  readExtensionSettings,
  type ExtensionSchema,
  type SettingPropDef,
} from './extension-setting-rows'

type ScopedSetting = [key: string, def: SettingPropDef]

/** The value settings an extension declared `workspaceScoped`, by extension. */
function workspaceScopedSettings(schemas: ExtensionSchema[]) {
  return schemas
    .map((schema) => ({
      schema,
      settings: Object.entries(schema.properties).filter(
        ([, def]) => def.workspaceScoped === true && def.type !== 'action'
      ) as ScopedSetting[],
    }))
    .filter(({ settings }) => settings.length > 0)
}

/** Every extension's schema and global values, read again when main says the list changed. */
function useExtensionSettings() {
  const [schemas, setSchemas] = useState<ExtensionSchema[]>([])
  const [values, setValues] = useState<Record<string, unknown>>({})
  useEffect(() => {
    const readSettings = (): void => readExtensionSettings({ setSchemas, setValues })
    readSettings()
    return window.electronAPI.extension.onListChanged(readSettings)
  }, [])
  return { groups: workspaceScopedSettings(schemas), values }
}

/** The extension settings a workspace may set for itself: each shows the value that applies
 * here, and "Use global default" once the workspace sets its own. */
export function WorkspaceExtensionSettings({ workspaceId }: { workspaceId: string }) {
  const { groups, values } = useExtensionSettings()
  const own = useSettingsStore((s) => s.workspaceSettings.get(workspaceId)?.extensions)
  if (groups.length === 0) return null
  return (
    <div className="settings-section">
      <h3 className="settings-section__title">Extensions</h3>
      <p className="settings-section__desc">Override extension settings for this workspace.</p>
      {groups.map(({ schema, settings }) => (
        <div key={schema.extensionId} className="extension-settings-panel">
          <label className="settings-section__label">{schema.label}</label>
          {settings.map(([key, def]) => (
            <WorkspaceSettingRow
              key={key}
              workspaceId={workspaceId}
              setting={{ key, def }}
              values={{ own: own?.[schema.extensionId]?.[key], global: values[key] }}
            />
          ))}
        </div>
      ))}
    </div>
  )
}

interface RowProps {
  workspaceId: string
  setting: { key: string; def: SettingPropDef }
  values: { own: unknown; global: unknown }
}

function WorkspaceSettingRow({ workspaceId, setting, values }: RowProps): JSX.Element {
  const update = useSettingsStore((s) => s.updateWorkspaceExtensionSetting)
  // The row keeps what was typed; a new generation redraws it with the global value.
  const [generation, setGeneration] = useState(0)
  const handBackToGlobal = async (): Promise<void> => {
    await update(workspaceId, setting.key, undefined)
    setGeneration((g) => g + 1)
  }
  return (
    <>
      <ExtensionSettingRow
        key={generation}
        propKey={setting.key}
        def={setting.def}
        value={values.own ?? values.global ?? setting.def.default}
        onChange={(key, value) => update(workspaceId, key, value)}
      />
      {values.own !== undefined && <UseGlobalButton onClick={() => void handBackToGlobal()} />}
    </>
  )
}
