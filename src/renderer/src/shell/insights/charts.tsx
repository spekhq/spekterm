import { type TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'

/**
 * 對話計量的圖表原語 —— **全部以 DOM／CSS 畫，不引入圖表函式庫**。
 *
 * 十一張圖裡十張是長條、熱圖或比例條，DOM + CSS grid 就夠了；而 SVG 圖表最常見的靜默錯誤是
 * 標籤跑出 viewBox 的邊界。這裡沒有 viewBox，也就沒有那個問題。
 *
 * **字級一律用 `--text-*` token 的 utility**（`typography.test.mjs` 擋寫死的字級）。
 */

export interface BarDatum {
  key: string
  label: string
  value: number
  /** 右側顯示的字串。省略即顯示數值。 */
  display?: string
}

export function Bars({ data, tone = 'accent' }: { data: BarDatum[]; tone?: 'accent' | 'blue' | 'green' }): React.JSX.Element {
  const max = Math.max(...data.map((d) => d.value), 1)
  const fill = tone === 'blue' ? 'bg-blue' : tone === 'green' ? 'bg-green' : 'bg-accent'
  return (
    <ul className="flex flex-col gap-[3px]">
      {data.map((d) => (
        <li key={d.key} className="grid grid-cols-[minmax(5rem,9rem)_1fr_minmax(3rem,auto)] items-center gap-2">
          <span className="truncate text-right text-2xs text-ink-dim" title={d.label}>
            {d.label}
          </span>
          <span className="h-3 bg-hover">
            <span className={`block h-full ${fill}`} style={{ width: `${(d.value / max) * 100}%` }} />
          </span>
          <span className="text-right font-mono text-2xs text-ink-faint">{d.display ?? d.value}</span>
        </li>
      ))}
    </ul>
  )
}

export interface HistogramProps {
  buckets: number[]
  labels: string[]
  marks: { label: string; value: string }[]
}

export function Histogram({ buckets, labels, marks }: HistogramProps): React.JSX.Element {
  const max = Math.max(...buckets, 1)
  return (
    <div className="flex flex-col gap-2">
      <div className="flex h-28 items-end gap-[3px]">
        {buckets.map((n, i) => (
          <div key={labels[i]} className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1">
            <span className="font-mono text-2xs text-ink-faint">{n > 0 ? n : ''}</span>
            <span
              className="w-full bg-accent"
              style={{ height: `${Math.max(2, (n / max) * 80)}px` }}
            />
          </div>
        ))}
      </div>
      <div className="flex gap-[3px]">
        {labels.map((l) => (
          <span key={l} className="min-w-0 flex-1 truncate text-center font-mono text-2xs text-ink-faint">
            {l}
          </span>
        ))}
      </div>
      <Marks marks={marks} />
    </div>
  )
}

export function Marks({ marks }: { marks: { label: string; value: string }[] }): React.JSX.Element {
  return (
    <dl className="flex flex-wrap gap-x-4 gap-y-1 text-2xs text-ink-faint">
      {marks.map((m) => (
        <div key={m.label} className="flex gap-1">
          <dt>{m.label}</dt>
          <dd className="font-mono text-ink">{m.value}</dd>
        </div>
      ))}
    </dl>
  )
}


/** 星期的簡稱。索引 0 為星期一 —— 與 `grid` 的列序一致。 */
function weekday(t: TFunction, day: number): string {
  return t(`insights.weekday.${day}` as 'insights.weekday.0')
}

/** 星期 × 小時。列是星期一到日，行是本機時區的 0–23 時。 */
export function Heatmap({ grid }: { grid: number[][] }): React.JSX.Element {
  const { t } = useTranslation()
  const max = Math.max(...grid.flat(), 1)
  const shade = (n: number): string =>
    n === 0 ? 'var(--color-hover)' : `color-mix(in srgb, var(--color-accent) ${Math.round(18 + (n / max) * 82)}%, var(--color-hover))`
  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-x-auto">
        <div className="grid min-w-[30rem] grid-cols-[2rem_repeat(24,1fr)] gap-[2px]">
          <span />
          {Array.from({ length: 24 }, (_, h) => (
            <span key={h} className="text-center font-mono text-2xs text-ink-faint">
              {h % 3 === 0 ? h : ''}
            </span>
          ))}
          {grid.map((row, day) => (
            <Row key={day} day={day} row={row} shade={shade} />
          ))}
        </div>
      </div>
      <div className="flex items-center gap-2 text-2xs text-ink-faint">
        <span>{t('insights.weekHeat.legendLow')}</span>
        <span className="flex gap-[2px]">
          {[0, 0.25, 0.5, 0.75, 1].map((f) => (
            <span key={f} className="h-2 w-4" style={{ background: shade(f * max) }} />
          ))}
        </span>
        <span>{t('insights.weekHeat.legendHigh')}</span>
        <span className="font-mono">{t('insights.weekHeat.busiest', { count: max })}</span>
      </div>
    </div>
  )
}

function Row({ day, row, shade }: { day: number; row: number[]; shade: (n: number) => string }): React.JSX.Element {
  // **`useTranslation` 而非 module-level 的 `t`** —— 它訂閱語言改變，於是切換語言時這一列
  // 會自己重繪。熱力圖有 7 列，每列都掛一次 hook 是可接受的成本。
  const { t } = useTranslation()

  return (
    <>
      <span className="pr-1 text-right text-2xs leading-4 text-ink-dim">{weekday(t, day)}</span>
      {row.map((n, hour) => (
        <span
          key={hour}
          className="h-4"
          style={{ background: shade(n) }}
          title={`${weekday(t, day)} ${hour}:00 — ${n}`}
        />
      ))}
    </>
  )
}

export interface ProportionSlice {
  key: string
  label: string
  value: number
  className: string
}

/** 互斥的比例條。與它重疊的量（例如「兩者皆出現」）由呼叫端另外列，不塞進條裡。 */
export function Proportion({ slices, extra }: { slices: ProportionSlice[]; extra?: { label: string; value: string } }): React.JSX.Element {
  const total = slices.reduce((sum, s) => sum + s.value, 0) || 1
  return (
    <div className="flex flex-col gap-2">
      <div className="flex h-6 overflow-hidden border border-hairline">
        {slices.map((s) => (
          <span key={s.key} className={`block h-full ${s.className}`} style={{ width: `${(s.value / total) * 100}%` }} />
        ))}
      </div>
      <dl className="flex flex-wrap gap-x-4 gap-y-1 text-2xs text-ink-faint">
        {slices.map((s) => (
          <div key={s.key} className="flex items-center gap-1">
            <span className={`h-2 w-2 ${s.className}`} />
            <dt>{s.label}</dt>
            <dd className="font-mono text-ink">{Math.round((s.value / total) * 100)}%</dd>
          </div>
        ))}
        {extra ? (
          <div className="flex items-center gap-1">
            <dt>{extra.label}</dt>
            <dd className="font-mono text-ink">{extra.value}</dd>
          </div>
        ) : null}
      </dl>
    </div>
  )
}
