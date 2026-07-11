import { Group, Panel, Separator } from 'react-resizable-panels'
import { ActivityBar } from './ActivityBar'
import { MainStage } from './MainStage'
import { WorkspaceRail } from './WorkspaceRail'
import { DirtyBuffersProvider } from './files/dirty-buffers'
import { useWorkspaceFolders } from './useWorkspaceFolders'

const SEPARATOR_CLASS = 'w-[3px] cursor-col-resize bg-hairline transition-colors hover:bg-accent'

export function AppShell(): React.JSX.Element {
  const { folders, selectedId, select, addFolder, removeFolder } = useWorkspaceFolders()
  const selected = folders.find((folder) => folder.id === selectedId) ?? null

  // Provider 在此 —— 未存的變更必須活過切換 folder（FilesPanel 以 folder.id 為 key 掛載）。
  return (
    <DirtyBuffersProvider folders={folders}>
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
    </DirtyBuffersProvider>
  )
}
