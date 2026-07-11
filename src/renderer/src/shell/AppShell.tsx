import { Group, Panel, Separator } from 'react-resizable-panels'
import { ActivityBar } from './ActivityBar'
import { MainStage } from './MainStage'
import { WorkspaceRail } from './WorkspaceRail'
import { DirtyBuffersProvider } from './files/dirty-buffers'
import { OpenSpecProvider } from './openspec/data'
import { SessionsProvider } from './terminal/sessions'
import { useWorkspaceFolders } from './useWorkspaceFolders'

const SEPARATOR_CLASS = 'w-[3px] cursor-col-resize bg-hairline transition-colors hover:bg-accent'

export function AppShell(): React.JSX.Element {
  const { folders, selectedId, select, addFolder, removeFolder } = useWorkspaceFolders()
  const selected = folders.find((folder) => folder.id === selectedId) ?? null

  // Provider 在此 —— 未存的變更必須活過切換 folder（FilesPanel 以 folder.id 為 key 掛載）。
  // SessionsProvider 同理，且要同時涵蓋 rail 與主舞台：rail 呈現所有 folder 的 session，
  // 主舞台掛載它們的終端（design D9）。
  //
  // OpenSpecProvider 必須在 MainStage 之上：MainStage 要知道當前 folder 的 active change
  // 才能決定新 session 的錨定（`openspec-side-panel` 的 design D3）。
  return (
    <DirtyBuffersProvider folders={folders}>
      <SessionsProvider>
        <OpenSpecProvider>
          <Group orientation="horizontal" className="h-full w-full">
            <Panel defaultSize="56px" minSize="48px" maxSize="120px">
              <ActivityBar />
            </Panel>

            <Separator className={SEPARATOR_CLASS} />

            <Panel defaultSize="260px" minSize="180px">
              <WorkspaceRail
                folders={folders}
                selectedId={selectedId}
                onSelect={select}
                onAdd={() => void addFolder()}
                onRemove={(id) => void removeFolder(id)}
              />
            </Panel>

            <Separator className={SEPARATOR_CLASS} />

            <Panel minSize="360px">
              <MainStage folder={selected} />
            </Panel>
          </Group>
        </OpenSpecProvider>
      </SessionsProvider>
    </DirtyBuffersProvider>
  )
}
