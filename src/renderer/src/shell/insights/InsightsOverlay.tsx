import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'

import type { Insights, ToneCategoryView, ToneClause } from '../../../../main/insights-aggregate'
import type { InsightsSnapshot } from '../../../../main/insights'
import { Bars, Heatmap, Histogram, Marks, Proportion, type BarDatum } from './charts'

/**
 * 對話計量的全視窗 overlay。
 *
 * **`role="dialog"` 不只是無障礙標記** —— `keyboard-navigation` 與 `quick-open` 都以
 * `[role="dialog"]` 於**整份文件**中的存在判定「有東西正在等待裁決」，遵守這個慣例即自動被尊重，
 * 兩份 spec 一個字都不必改。**拿掉它不會有任何型別或測試變紅**，只會讓快捷鍵在 overlay 底下
 * 悄悄照常生效。
 *
 * 以 portal 掛到 `document.body`：`position: fixed` 若有祖先帶 `transform` / `filter` 就會改以
 * 那個祖先為定位基準，而它上面是 `react-resizable-panels`（比照 `VizOverlay`）。
 *
 * **關閉時焦點要歸還給開啟它的入口。** 落回 `<body>` 是一種靜默失效：下一次按鍵什麼都不會發生，
 * 使用者看到的是「這個功能時好時壞」。
 */

const RANGE_OPTIONS = [0, 7, 30, 90] as const

export interface InsightsOverlayProps {
  onClose: () => void
  /** 開啟它的那個元素 —— 關閉時把焦點還回去。 */
  opener: HTMLElement | null
}

export function InsightsOverlay({ onClose, opener }: InsightsOverlayProps): React.JSX.Element {
  const { t } = useTranslation()
  const [snapshot, setSnapshot] = useState<InsightsSnapshot | null>(null)
  const [days, setDays] = useState<number>(0)
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    let cancelled = false
    void window.workspace.insights.get().then((first) => {
      if (cancelled) return
      setSnapshot(first)
      // 開啟時再觸發一次，讓剛剛的對話也算進去。
      void window.workspace.insights.refresh().then((fresh) => {
        if (!cancelled) setSnapshot(fresh)
      })
    })
    return () => {
      cancelled = true
    }
  }, [])

  const close = useCallback(() => {
    onClose()
    // 焦點歸還。`opener` 可能已經被卸載 —— 那時什麼都不做好過把焦點丟給 body。
    if (opener?.isConnected) opener.focus()
  }, [onClose, opener])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKeyDown)
    closeRef.current?.focus()
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [close])

  const insights = snapshot?.insights ?? null
  // **`from` 在點擊時就算好，不在 render 期間算。** `Date.now()` 是不純的：放在 render 裡
  // 會讓同一份資料在兩次重繪之間得到不同的範圍，而 lint 也擋著（`no-impure-function-in-render`）。
  const [from, setFrom] = useState<number | undefined>(undefined)
  const pickRange = useCallback((option: number) => {
    setDays(option)
    setFrom(option === 0 ? undefined : Date.now() - option * 86_400_000)
  }, [])

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('insights.label')}
      className="fixed inset-0 z-50 flex flex-col overflow-y-auto bg-stage"
    >
      <header className="sticky top-0 z-10 flex shrink-0 items-center gap-3 border-b border-hairline bg-stage px-4 py-2">
        <h2 className="text-sm font-bold text-ink">{t('insights.label')}</h2>
        <RangePicker days={days} onChange={pickRange} />
        <span className="flex-1" />
        {snapshot?.phase === 'running' ? (
          <span className="text-2xs text-ink-faint">{t('insights.scanning')}</span>
        ) : null}
        <button
          type="button"
          ref={closeRef}
          onClick={close}
          aria-label={t('insights.close')}
          title={t('insights.closeTooltip')}
          className="rounded border border-hairline px-2 py-1 text-xs text-ink-dim hover:border-accent hover:text-accent"
        >
          ✕ Esc
        </button>
      </header>

      <div className="flex-1 px-4 pb-16 pt-3">
        {snapshot === null ? (
          <Note text={t('insights.scanning')} />
        ) : insights === null ? (
          <EmptyState snapshot={snapshot} />
        ) : (
          <Views insights={insights} from={from} />
        )}
      </div>
    </div>,
    document.body,
  )
}

function RangePicker({ days, onChange }: { days: number; onChange: (days: number) => void }): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <div role="group" aria-label={t('insights.rangeLabel')} className="flex gap-1">
      {RANGE_OPTIONS.map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={days === option}
          onClick={() => onChange(option)}
          className={`rounded px-2 py-[2px] text-2xs transition-colors ${
            days === option ? 'bg-accent-soft font-bold text-accent' : 'text-ink-dim hover:bg-hover hover:text-ink'
          }`}
        >
          {option === 0 ? t('insights.rangeAll') : t('insights.rangeDays', { count: option })}
        </button>
      ))}
    </div>
  )
}

function EmptyState({ snapshot }: { snapshot: InsightsSnapshot }): React.JSX.Element {
  const { t } = useTranslation()
  if (snapshot.phase === 'running') return <Note text={t('insights.scanning')} />
  if (snapshot.error) return <Note text={t('insights.error')} />
  // **還沒掃過時「來源可不可用」是未知，不是「沒有資料」。**
  // 少了這一支，開啟的瞬間就會斷言「來源可用但沒有資料」—— 而那句話在來源根本不存在時是錯的，
  // 且它與掃完之後的正確狀態長得一模一樣，只差幾百毫秒。probe 就是這樣抓到它的。
  if (snapshot.sourceAvailable === null) return <Note text={t('insights.scanning')} />
  if (snapshot.sourceAvailable === false) return <Note text={t('insights.sourceUnavailable')} />
  return <Note text={t('insights.noData')} />
}

function Note({ text }: { text: string }): React.JSX.Element {
  return <p className="max-w-prose border border-hairline px-4 py-6 text-sm text-ink-faint">{text}</p>
}

function Section({ title, note, children }: { title: string; note: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <section aria-label={title} className="mb-2">
      <div className="mb-3 mt-8 flex items-baseline gap-3 border-b border-hairline pb-1">
        <h3 className="text-sm font-bold text-ink">{title}</h3>
        <p className="text-2xs text-ink-faint">{note}</p>
      </div>
      {children}
    </section>
  )
}

function View({ title, blurb, source, children }: { title: string; blurb: string; source: string; children: React.ReactNode }): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <article aria-label={title} className="mb-3 border border-hairline bg-panel px-4 py-3">
      <h4 className="text-xs font-bold text-ink">{title}</h4>
      <p className="mb-3 mt-1 max-w-prose text-2xs text-ink-dim">{blurb}</p>
      {children}
      <p className="mt-3 border-t border-hairline pt-2 font-mono text-2xs text-ink-faint">
        <span className="mr-2 uppercase">{t('insights.sourceLabel')}</span>
        {source}
      </p>
    </article>
  )
}

const LENGTH_LABELS = ['<10', '10–20', '20–40', '40–80', '80–160', '160–400', '0.4–1K', '1K+']
const ROUND_LABELS = ['1', '2–4', '5–9', '10–19', '20–49', '50–99', '100+']
const SIT_LABELS = ['<5m', '5–15', '15–30', '30–60', '1–2h', '2–4h', '4h+']
const PER_SIT_LABELS = ['0', '1', '2', '3–5', '6–10', '11–20', '21+']

function Views({ insights, from }: { insights: Insights; from?: number }): React.JSX.Element {
  const { t } = useTranslation()
  const view = insights
  void from

  const stat = (d: { median: number; p75: number; p90: number; max: number }, unit?: (n: number) => string) => {
    const fmt = unit ?? ((n: number) => String(n))
    return [
      { label: t('insights.stat.median'), value: fmt(d.median) },
      { label: t('insights.stat.p75'), value: fmt(d.p75) },
      { label: t('insights.stat.p90'), value: fmt(d.p90) },
      { label: t('insights.stat.max'), value: fmt(d.max) },
    ]
  }
  const minutes = (n: number) => t('insights.sitDown.minutes', { count: Math.round(n) })

  return (
    <>
      <Totals insights={view} />

      <Section title={t('insights.section.rhythm')} note={t('insights.section.rhythmNote')}>
        <View title={t('insights.weekHeat.title')} blurb={t('insights.weekHeat.blurb')} source={t('insights.weekHeat.source')}>
          <Heatmap grid={view.weekHeat} />
        </View>
        <View
          title={t('insights.sitDown.title')}
          blurb={`${t('insights.sitDown.blurb', { minutes: view.sitDown.thresholdMinutes })} ${t('insights.sitDown.activity')}`}
          source={t('insights.sitDown.source', { minutes: view.sitDown.thresholdMinutes })}
        >
          <Histogram buckets={view.sitDown.buckets} labels={SIT_LABELS} marks={stat(view.sitDown, minutes)} />
          <div className="mt-3">
            <p className="mb-1 text-2xs text-ink-faint">{t('insights.sitDown.perSitDown')}</p>
            <Histogram
              buckets={view.sitDown.messagesPerSitDown.buckets}
              labels={PER_SIT_LABELS}
              marks={stat(view.sitDown.messagesPerSitDown)}
            />
          </div>
        </View>
      </Section>

      <Section title={t('insights.section.habits')} note={t('insights.section.habitsNote')}>
        <View title={t('insights.length.title')} blurb={`${t('insights.length.blurb')} ${t('insights.stat.noMean')}`} source={t('insights.length.source')}>
          <Histogram buckets={view.messageLength.buckets} labels={LENGTH_LABELS} marks={stat(view.messageLength)} />
        </View>
        <View title={t('insights.rounds.title')} blurb={t('insights.rounds.blurb')} source={t('insights.rounds.source')}>
          <Histogram buckets={view.roundsPerSession.buckets} labels={ROUND_LABELS} marks={stat(view.roundsPerSession)} />
        </View>
        <View title={t('insights.interrupts.title')} blurb={t('insights.interrupts.blurb')} source={t('insights.interrupts.source')}>
          <Bars
            tone="blue"
            data={view.interruptsDaily.map((d) => ({ key: d.date, label: d.date, value: d.n }))}
          />
        </View>
      </Section>

      <Section title={t('insights.section.speech')} note={t('insights.section.speechNote')}>
        <View title={t('insights.tone.title')} blurb={t('insights.tone.blurb')} source={t('insights.tone.source')}>
          <ToneList tone={view.tone} total={view.totals.messages} />
        </View>
        <View title={t('insights.language.title')} blurb={t('insights.language.blurb')} source={t('insights.language.source')}>
          <Proportion
            slices={[
              { key: 'zh', label: t('insights.language.zh'), value: view.language.zh, className: 'bg-accent' },
              { key: 'en', label: t('insights.language.en'), value: view.language.en, className: 'bg-blue' },
            ]}
            extra={{
              label: t('insights.language.mixed'),
              value: `${Math.round((view.language.mixed / Math.max(view.totals.messages, 1)) * 100)}%`,
            }}
          />
        </View>
        <View
          title={t('insights.phrases.title')}
          blurb={t('insights.phrases.blurb', { maxChars: view.phraseLimits.maxChars, minCount: view.phraseLimits.minCount })}
          source={t('insights.phrases.source')}
        >
          <ul className="flex flex-wrap gap-2">
            {view.phrases.slice(0, 24).map((p) => (
              <li key={p.name} className="flex items-baseline gap-2 border border-hairline bg-shell px-2 py-1">
                <span className="text-2xs text-ink">{p.name}</span>
                <span className="font-mono text-2xs text-accent">×{p.n}</span>
              </li>
            ))}
          </ul>
        </View>
      </Section>

      <Section title={t('insights.section.doing')} note={t('insights.section.doingNote')}>
        <View title={t('insights.projects.title')} blurb={t('insights.projects.blurb')} source={t('insights.projects.source')}>
          <Bars
            data={view.projects.map<BarDatum>((p) => ({
              key: p.id,
              label: p.label ?? t('insights.projects.unnamed'),
              value: p.messages,
            }))}
          />
        </View>
        <View title={t('insights.bash.title')} blurb={t('insights.bash.blurb')} source={t('insights.bash.source')}>
          <Bars tone="green" data={view.bash.slice(0, 14).map((b) => ({ key: b.name, label: b.name, value: b.n }))} />
        </View>
        <View title={t('insights.skills.title')} blurb={t('insights.skills.blurb')} source={t('insights.skills.source')}>
          <Bars data={view.skills.slice(0, 12).map((s) => ({ key: s.name, label: s.name, value: s.n }))} />
          {view.agents.length > 0 ? (
            <div className="mt-3">
              <p className="mb-1 text-2xs text-ink-faint">{t('insights.skills.agents')}</p>
              <Bars tone="blue" data={view.agents.map((a) => ({ key: a.name, label: a.name, value: a.n }))} />
            </div>
          ) : null}
        </View>
      </Section>
    </>
  )
}

function Totals({ insights }: { insights: Insights }): React.JSX.Element {
  const { t } = useTranslation()
  const items: [string, number][] = [
    [t('insights.totals.messages'), insights.totals.messages],
    [t('insights.totals.sessions'), insights.totals.sessions],
    [t('insights.totals.sitDowns'), insights.totals.sitDowns],
    [t('insights.totals.tools'), insights.totals.tools],
    [t('insights.totals.interrupts'), insights.totals.interrupts],
    [t('insights.totals.days'), insights.totals.days],
  ]
  return (
    <>
      <dl className="grid grid-cols-[repeat(auto-fit,minmax(8rem,1fr))] gap-px bg-hairline">
        {items.map(([label, value]) => (
          <div key={label} className="bg-panel px-3 py-2">
            <dt className="text-2xs uppercase text-ink-faint">{label}</dt>
            <dd className="font-mono text-lg text-ink">{value.toLocaleString('en-US')}</dd>
          </div>
        ))}
      </dl>
      {insights.nonUserInputRatio > 0 ? (
        <p className="mt-2 text-2xs text-ink-faint">
          {t('insights.meta.ratio', { percent: Math.round(insights.nonUserInputRatio * 100) })}
        </p>
      ) : null}
    </>
  )
}

function ToneList({ tone, total }: { tone: ToneCategoryView[]; total: number }): React.JSX.Element {
  const { t } = useTranslation()
  const max = Math.max(...tone.map((c) => c.n), 1)
  return (
    <ul className="flex flex-col">
      {[...tone].sort((a, b) => b.n - a.n).map((category) => (
        <li key={category.key} className="border-b border-hairline py-3 last:border-b-0 last:pb-0">
          <div className="grid grid-cols-[minmax(6rem,9rem)_1fr_minmax(4rem,auto)] items-center gap-2">
            <span className="text-right text-xs font-bold text-ink">
              {t(`insights.tone.category.${category.key}` as 'insights.tone.category.question')}
            </span>
            <span className="h-3 bg-hover">
              <span className="block h-full bg-accent" style={{ width: `${(category.n / max) * 100}%` }} />
            </span>
            <span className="text-right font-mono text-2xs text-ink-faint">
              {category.n} · {Math.round((category.n / Math.max(total, 1)) * 100)}%
            </span>
          </div>
          <ToneRule clauses={category.clauses} exclude={category.exclude} />
          {category.examples.length > 0 ? (
            <ul className="mt-2 flex flex-wrap gap-1">
              {category.examples.map((example) => (
                <li key={example} className="max-w-full truncate border border-hairline bg-shell px-2 py-[2px] text-2xs text-ink-dim" title={example}>
                  {example}
                </li>
              ))}
            </ul>
          ) : null}
        </li>
      ))}
    </ul>
  )
}

/**
 * 判定依據。**列的是比對用的那一份詞表本身**，不是另外寫一句說明 ——
 * 兩份東西會在某一次調整規則時失去同步，而使用者看到的說明變成謊話，沒有任何東西會紅。
 */
function ToneRule({ clauses, exclude }: { clauses: ToneClause[]; exclude: string[] }): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <p className="mt-2 text-2xs text-ink-faint">
      <span className="mr-1 text-ink-dim">{t('insights.tone.rule')}</span>
      {clauses.map((clause, i) => (
        <span key={clause.kind}>
          {i > 0 ? ' / ' : ''}
          {t(`insights.tone.kind.${clause.kind}` as 'insights.tone.kind.contains')}{' '}
          <span className="font-mono text-ink-dim">{clause.terms.join('、')}</span>
        </span>
      ))}
      {exclude.length > 0 ? (
        <span>
          {' — '}
          {t('insights.tone.exclude')} <span className="font-mono text-ink-dim">{exclude.join('、')}</span>
        </span>
      ) : null}
    </p>
  )
}

export { Marks }
