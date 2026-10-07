/**
 * The maximized side panel and the Graph / Timeline view shown in it
 * (`maximize-panel-and-confirm-close`, design M4 and M5).
 *
 * A pure reducer so that the one rule that is easy to get wrong — **every way out of the maximized
 * state also leaves Graph / Timeline** — lives in one place and is unit-tested. Otherwise the next
 * maximize would show Graph although nobody chose it.
 */

/** The two visualizations shown in the maximized side panel. They are different things. */
export type VizKind = 'graph' | 'timeline'

export interface MaximizeState {
  maximized: boolean
  /** Graph or Timeline on top of the OpenSpec identity's own view; `null` = that view. */
  viz: VizKind | null
  /** The sessions context's `attention` value last seen (see `SessionsApi.attention`). */
  seenAttention: number
}

export type MaximizeAction =
  | { type: 'maximize' }
  /** The header entry, `Ctrl+Shift+M`, or the collapse entry while maximized. */
  | { type: 'restore' }
  | { type: 'toggle' }
  /** Choosing Graph / Timeline maximizes the side panel. */
  | { type: 'chooseViz'; kind: VizKind }
  /** This change or Browse chosen, a change or spec chosen in the graph, or cross navigation. */
  | { type: 'leaveViz' }
  /** The user turned to a session — restores when the value moved. */
  | { type: 'attention'; value: number }

export function initialMaximizeState(attention: number): MaximizeState {
  return { maximized: false, viz: null, seenAttention: attention }
}

function restored(state: MaximizeState): MaximizeState {
  return state.maximized || state.viz !== null ? { ...state, maximized: false, viz: null } : state
}

export function maximizeReducer(state: MaximizeState, action: MaximizeAction): MaximizeState {
  switch (action.type) {
    case 'maximize':
      return state.maximized ? state : { ...state, maximized: true }
    case 'restore':
      return restored(state)
    case 'toggle':
      return state.maximized ? restored(state) : { ...state, maximized: true }
    case 'chooseViz':
      return state.maximized && state.viz === action.kind
        ? state
        : { ...state, maximized: true, viz: action.kind }
    case 'leaveViz':
      return state.viz === null ? state : { ...state, viz: null }
    case 'attention':
      if (action.value === state.seenAttention) return state
      return { ...restored(state), seenAttention: action.value }
  }
}
