import type { WorkspaceApi } from './index'

declare global {
  interface Window {
    workspace: WorkspaceApi
  }
}

export {}
