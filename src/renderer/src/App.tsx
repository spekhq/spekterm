import { useEffect, useState } from 'react'
import { CodeEditor, getWorkerDiagnostics, probeTypeScriptWorker } from './editor'

interface TrustProbe {
  /** renderer 不應看得到 Node.js 的模組系統 */
  requireExposed: boolean
  /** contextIsolation 下 renderer 也不應拿到 process */
  processExposed: boolean
  /** preload 白名單暴露的具名 API 是否可用 */
  preloadApi: string
}

const SAMPLE_TS = `interface Handoff {
  from: string
  to: string
  status: 'open' | 'awaiting-ack' | 'done'
}

export function isActionable(handoff: Handoff): boolean {
  // 磁碟狀態才算數：agent 說做完不算
  return handoff.status !== 'done'
}
`

/**
 * 這些探測結果同時寫進 DOM 的 data-* 屬性，讓 spec 的驗收 scenario
 * 能以自動化方式讀取，而不只是肉眼看畫面。
 */
function probeGlobals(): Pick<TrustProbe, 'requireExposed' | 'processExposed'> {
  const globals = globalThis as unknown as Record<string, unknown>
  return {
    requireExposed: typeof globals.require !== 'undefined',
    processExposed: typeof globals.process !== 'undefined',
  }
}

export function App(): React.JSX.Element {
  const [probe, setProbe] = useState<TrustProbe>({
    requireExposed: false,
    processExposed: false,
    preloadApi: 'pending',
  })
  const [workerStatus, setWorkerStatus] = useState('pending')
  const [workersCreated, setWorkersCreated] = useState('')

  useEffect(() => {
    const globals = probeGlobals()
    window.workspace
      .ping()
      .then((reply) => setProbe({ ...globals, preloadApi: reply }))
      .catch(() => setProbe({ ...globals, preloadApi: 'unavailable' }))
  }, [])

  useEffect(() => {
    // 等編輯器建立 model 之後再探 worker
    const timer = setTimeout(() => {
      void probeTypeScriptWorker().then((status) => {
        setWorkerStatus(status)
        // 記錄實際被建立的 worker，worker 若根本沒啟動，這裡會是空的 ——
        // 那和「worker 啟動了但沒回應」是完全不同的失敗，值得區分。
        setWorkersCreated(getWorkerDiagnostics().created.join(',') || 'none')
      })
    }, 300)
    return () => clearTimeout(timer)
  }, [])

  const trustModelHolds = !probe.requireExposed && !probe.processExposed
  const preloadWorks = probe.preloadApi === 'pong'

  return (
    <main
      data-testid="app-root"
      data-require-exposed={String(probe.requireExposed)}
      data-process-exposed={String(probe.processExposed)}
      data-preload-api={probe.preloadApi}
      data-monaco-worker={workerStatus}
      data-monaco-workers-created={workersCreated}
      className="min-h-screen bg-slate-950 p-10 font-sans text-slate-200"
    >
      <h1 className="text-2xl font-semibold text-amber-500">spek workspace</h1>
      <p className="mt-1 text-sm text-slate-400">
        Phase 0 骨架 — workspace-foundation-spike
      </p>

      <dl className="mt-8 grid max-w-xl grid-cols-[auto_1fr] gap-x-6 gap-y-3 text-sm">
        <dt className="text-slate-400">preload 白名單 API</dt>
        <dd data-testid="preload-status" className={preloadWorks ? 'text-emerald-400' : 'text-red-400'}>
          {probe.preloadApi}
        </dd>

        <dt className="text-slate-400">renderer 可見 require</dt>
        <dd className={probe.requireExposed ? 'text-red-400' : 'text-emerald-400'}>
          {String(probe.requireExposed)}
        </dd>

        <dt className="text-slate-400">renderer 可見 process</dt>
        <dd className={probe.processExposed ? 'text-red-400' : 'text-emerald-400'}>
          {String(probe.processExposed)}
        </dd>

        <dt className="text-slate-400">信任模型</dt>
        <dd
          data-testid="trust-model"
          className={trustModelHolds ? 'text-emerald-400' : 'text-red-400'}
        >
          {trustModelHolds ? 'contextIsolation 生效' : '信任邊界破裂'}
        </dd>

        <dt className="text-slate-400">Monaco TS worker</dt>
        <dd
          data-testid="monaco-worker"
          className={workerStatus === 'ok' ? 'text-emerald-400' : 'text-red-400'}
        >
          {workerStatus}
        </dd>
      </dl>

      <section className="mt-8">
        <h2 className="mb-2 text-sm text-slate-400">編輯器（唯讀，語法高亮驗證用）</h2>
        <CodeEditor
          value={SAMPLE_TS}
          language="typescript"
          className="h-64 w-full max-w-3xl border border-slate-800"
        />
      </section>
    </main>
  )
}
