import { Group, Panel, Separator } from 'react-resizable-panels'
import { ActivityBar } from './ActivityBar'
import { KeyboardNavigation } from './KeyboardNavigation'
import { MainStage } from './MainStage'
import { PreferencesProvider } from './PreferencesProvider'
import { StatusBar } from './StatusBar'
import { WorkspaceRail } from './WorkspaceRail'
import { DirtyBuffersProvider } from './files/dirty-buffers'
import { OpenSpecProvider } from './openspec/data'
import { PanelCoordinateProvider } from './panel-coordinate'
import { SessionsProvider } from './terminal/sessions'
import { folderSelection } from './types'
import { useWorkspaceFolders } from './useWorkspaceFolders'

const SEPARATOR_CLASS = 'w-[3px] cursor-col-resize bg-hairline transition-colors hover:bg-accent'

export function AppShell(): React.JSX.Element {
  const { folders, selection, select, addFolder, removeFolder, reorderFolders } =
    useWorkspaceFolders()
  // Provider 在此 —— 未存的變更必須活過切換 folder（FilesPanel 以 folder.id 為 key 掛載）。
  // SessionsProvider 同理，且要同時涵蓋 rail 與主舞台：rail 呈現所有 folder 的 session，
  // 主舞台掛載它們的終端（design D9）。
  //
  // OpenSpecProvider 必須在 MainStage 之上：MainStage 要知道當前 folder 的 active change
  // 才能決定新 session 的錨定（`openspec-side-panel` 的 design D3）。
  return (
    <PreferencesProvider>
      <DirtyBuffersProvider folders={folders}>
        <SessionsProvider>
          {/*
            側欄座標的 Provider 與 SessionsProvider 同一層 —— 它有兩個消費者（MainStage 與
            StatusBar），兩者都在這一層之下。座標隸屬於 rail 的項目而非 session，但它與 session
            一樣必須活過「切換 folder」，因此掛在同一個高度。
          */}
          <PanelCoordinateProvider>
          <OpenSpecProvider>
            {/*
              必須在 `SessionsProvider` 之內（它要 `useSessions()`），而 `AppShell` 本身正是渲染
              那個 Provider 的元件 —— 掛在這一層才拿得到 context。它不渲染任何東西。
            */}
            <KeyboardNavigation
              folders={folders}
              selection={selection}
              onSelectGlobal={() => select({ kind: 'global' })}
              onSelectFolder={(id) => select(folderSelection(id))}
              onReorderFolder={(id, toIndex) => void reorderFolders(id, toIndex)}
            />

            {/*
              三欄 + 底部狀態列。狀態列**不隸屬於任何一欄** —— 它橫跨整個視窗，且不受 side panel
              收合或任一分界拖動影響（`workspace-layout` 的新 requirement）。因此三欄的 Group 要
              包進一個直向容器，並以 `min-h-0` 讓它把剩下的高度讓給狀態列。
            */}
            <div className="flex h-full w-full flex-col">
            <Group orientation="horizontal" className="min-h-0 w-full flex-1">
              <Panel defaultSize="56px" minSize="48px" maxSize="120px">
                <ActivityBar />
              </Panel>

              <Separator className={SEPARATOR_CLASS} />

              {/*
                `min-w-0` 不是裝飾：flex item 的 `min-width` 預設是 `auto`，於是 Panel 會被它的
                **內容**撐住，縮不到 `minSize` —— 宣告的最小寬度就兌現不了（spec 要求「拖動 SHALL
                被夾制於該下限」）。字級小的時候 rail 的 min-content 恰好小於 180px，這個缺陷因此
                一直看不出來；`--text-base` 一調到 17px，rail 就再也縮不到 180px（實測卡在 240px，
                是探針抓到的）。**最小寬度是版面契約，不該隨字級浮動** —— 所以修 Panel，不是調高 180。
              */}
              <Panel defaultSize="260px" minSize="180px" className="min-w-0">
                <WorkspaceRail
                  folders={folders}
                  selection={selection}
                  onSelect={(id) => select(folderSelection(id))}
                  onSelectGlobal={() => select({ kind: 'global' })}
                  onAdd={() => void addFolder()}
                  onRemove={(id) => void removeFolder(id)}
                  onReorder={(id, toIndex) => void reorderFolders(id, toIndex)}
                />
              </Panel>

              <Separator className={SEPARATOR_CLASS} />

              <Panel minSize="360px">
                <MainStage selection={selection} folders={folders} />
              </Panel>
            </Group>

            <StatusBar folders={folders} selection={selection} />
            </div>
          </OpenSpecProvider>
          </PanelCoordinateProvider>
        </SessionsProvider>
      </DirtyBuffersProvider>
    </PreferencesProvider>
  )
}
