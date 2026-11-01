import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { DayStats, LoadStatus, Stats } from '../types'

const PANE = 'usage-stats'
const TITLE = 'Claude stats'
const REFRESH_MS = 10 * 60 * 1000
const WEEKS = 26
const DAY_MS = 86_400_000

// Change the tag when Stats' fields change: it declines what an earlier
// version stored, which outlives a reload.
const stats = atom({ plugin: 'usage-stats', key: 'stats' } as const, null, {
  shape: 'stats-2',
})
const status = atom({ plugin: 'usage-stats', key: 'status' } as const, {
  isLoading: false,
} as LoadStatus)

async function refresh($: EngineInterface) {
  const now = await read($, status)
  if (now.isLoading) return
  await update($, status, () => ({ isLoading: true }))
  const script = `${$.plugin.root}/scripts/compute.py`
  let error: string | undefined
  for (const python of ['/usr/bin/python3', 'python3']) {
    try {
      const run = await $.process.run([python, '-I', script], {
        cwd: $.plugin.root,
        timeoutMs: 10 * 60 * 1000,
      })
      if (run.exitCode !== 0) {
        error = run.stderr.trim().split('\n').pop() || `exit ${run.exitCode}`
        continue
      }
      const fresh = JSON.parse(run.stdout) as Stats
      await update($, stats, () => fresh)
      await $.store.set('stats', fresh)
      error = undefined
      break
    } catch (err) {
      error = String(err)
    }
  }
  await update($, status, () => ({ isLoading: false, error }))
}

function modelName(id: string) {
  const m = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/.exec(id)
  if (!m?.[1]) return id
  const family = m[1].charAt(0).toUpperCase() + m[1].slice(1)
  return m[3] ? `${family} ${m[2]}.${m[3]}` : `${family} ${m[2]}`
}

function compact(n: number) {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`
  return String(n)
}

function hourLabel(h: number) {
  const suffix = h < 12 ? 'am' : 'pm'
  return `${h % 12 === 0 ? 12 : h % 12}${suffix}`
}

// The script writes local time with its offset, so the digits are already local.
function clockTime(iso: string) {
  const h = Number(iso.slice(11, 13))
  return `${h % 12 === 0 ? 12 : h % 12}:${iso.slice(14, 16)}${h < 12 ? 'am' : 'pm'}`
}

function prettyDate(iso: string) {
  const d = new Date(`${iso}T00:00:00Z`)
  const month = d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })
  return `${month} ${d.getUTCDate()}`
}

const EMPTY = { messages: 0, sessions: 0, tools: 0, tokens: 0 }
const PALETTE = ['#f0c8b0', '#e39a72', '#d97757', '#a84a2c']

// Days are keyed by the user's local date; "today" comes from the script's
// local timestamp, and the grid steps in UTC so the sandbox's zone never shifts it.
function heatmapSvg(s: Stats) {
  const today = new Date(`${s.computedAt.slice(0, 10)}T00:00:00Z`)
  const start = new Date(today.getTime() - ((WEEKS - 1) * 7 + today.getUTCDay()) * DAY_MS)
  const counts = Object.values(s.daily).map(d => d.messages).filter(n => n > 0).sort((a, b) => a - b)
  const q = (p: number) => counts[Math.min(counts.length - 1, Math.floor(p * counts.length))] ?? 0
  const cuts = [q(0.25), q(0.5), q(0.75)] as const
  const cell = 12
  const step = 15
  const left = 26
  const top = 16
  const width = left + WEEKS * step
  const height = top + 7 * step
  const parts: string[] = []
  let lastMonth = -1
  for (let w = 0; w < WEEKS; w++) {
    for (let d = 0; d < 7; d++) {
      const day = new Date(start.getTime() + (w * 7 + d) * DAY_MS)
      if (day > today) continue
      const key = day.toISOString().slice(0, 10)
      const v: DayStats = s.daily[key] ?? EMPTY
      if (d === 0 && day.getUTCMonth() !== lastMonth) {
        lastMonth = day.getUTCMonth()
        const label = day.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })
        parts.push(`<text x="${left + w * step}" y="11" font-size="10" fill="#888">${label}</text>`)
      }
      const level = v.messages === 0 ? -1 : v.messages <= cuts[0] ? 0 : v.messages <= cuts[1] ? 1 : v.messages <= cuts[2] ? 2 : 3
      const fill = level < 0 ? 'fill="#888" fill-opacity="0.18"' : `fill="${PALETTE[level]}"`
      const tip = `${prettyDate(key)}: ${v.messages} messages, ${v.sessions} sessions, ${v.tools} tool calls`
      parts.push(
        `<rect x="${left + w * step}" y="${top + d * step}" width="${cell}" height="${cell}" rx="2" ${fill}><title>${tip}</title></rect>`,
      )
    }
  }
  for (const [d, name] of [[1, 'Mon'], [3, 'Wed'], [5, 'Fri']] as const) {
    parts.push(`<text x="0" y="${top + d * step + 10}" font-size="10" fill="#888">${name}</text>`)
  }
  return {
    width,
    height,
    source: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" font-family="-apple-system, system-ui, sans-serif">${parts.join('')}</svg>`,
  }
}

function hoursSvg(s: Stats) {
  const max = Math.max(1, ...s.hours)
  const width = 26 + WEEKS * 15
  const barArea = 48
  const slot = (width - 26) / 24
  const bars = s.hours.map((n, h) => {
    const bh = Math.max(n ? 2 : 0, Math.round((n / max) * barArea))
    return `<rect x="${26 + h * slot + 1}" y="${barArea - bh}" width="${slot - 2}" height="${bh}" rx="1.5" fill="${PALETTE[2]}"><title>${hourLabel(h)}: ${n} prompts</title></rect>`
  })
  const labels = [0, 6, 12, 18].map(
    h => `<text x="${26 + h * slot}" y="${barArea + 13}" font-size="10" fill="#888">${hourLabel(h)}</text>`,
  )
  const height = barArea + 16
  return {
    width,
    height,
    source: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" font-family="-apple-system, system-ui, sans-serif">${bars.join('')}${labels.join('')}</svg>`,
  }
}

function sparkline(s: Stats) {
  const today = new Date(`${s.computedAt.slice(0, 10)}T00:00:00Z`)
  const values: number[] = []
  for (let i = 29; i >= 0; i--) {
    const key = new Date(today.getTime() - i * DAY_MS).toISOString().slice(0, 10)
    values.push(s.daily[key]?.messages ?? 0)
  }
  const max = Math.max(1, ...values)
  return values.map(v => (v === 0 ? '·' : '▁▂▃▄▅▆▇█'[Math.min(7, Math.floor((v / max) * 8))])).join('')
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'usage-stats',
      description: 'Show your Claude Code activity stats in a side panel',
    })
    if ((await read($, stats)) === null) {
      const saved = (await $.store.get('stats')) as Stats | undefined
      if (saved?.tokenBreakdown) await update($, stats, () => saved)
    }
    void $.ui.open({ id: PANE, title: TITLE })
    void refresh($)
    $.clock.every(REFRESH_MS, () => void refresh($))

    return next(e)
  })

  on('command.run', { command: 'usage-stats' }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE })
    void refresh($)

    return { text: 'Claude stats panel opened.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text, Button } = els
    const Svg = 'Svg' in els ? els.Svg : undefined
    const s = await read($, stats)
    const st = await read($, status)

    const header = (
      <Box flexDirection="row" justifyContent="space-between" alignItems="center">
        <Text dimColor>
          {st.isLoading
            ? 'Updating…'
            : s
              ? `Updated ${clockTime(s.computedAt)}`
              : ''}
        </Text>
        <Button key="refresh" label="Refresh" onPress={() => void refresh($)} />
      </Box>
    )

    if (!s) {
      return (
        <Box flexDirection="column" gap={1}>
          {header}
          <Text dimColor>{st.error ? `Could not read stats: ${st.error}` : 'Reading your session history… the first scan takes about 20 seconds.'}</Text>
        </Box>
      )
    }

    const models = Object.entries(s.models)
    const modelTotal = models.reduce((sum, [, n]) => sum + n, 0) || 1
    const favorite = models[0] ? modelName(models[0][0]) : '—'
    const peakHour = s.hours.indexOf(Math.max(...s.hours))
    const rows: [string, string][] = [
      ['Sessions', s.totalSessions.toLocaleString('en-US')],
      ['Messages', s.totalMessages.toLocaleString('en-US')],
      ['Active days', String(s.activeDays)],
      ['Current streak', `${s.currentStreak} day${s.currentStreak === 1 ? '' : 's'}`],
      ['Longest streak', `${s.longestStreak} days`],
      ['Favorite model', favorite],
      ['Most active hour', hourLabel(peakHour)],
      ['Biggest session', s.longestSession.date ? `${s.longestSession.messages} messages · ${prettyDate(s.longestSession.date)}` : '—'],
      ['Total tokens', compact(s.totalTokens)],
      ['Since', s.firstSession ? prettyDate(s.firstSession.slice(0, 10)) : '—'],
    ]
    const map = heatmapSvg(s)
    const hours = hoursSvg(s)

    return (
      <Box flexDirection="column" gap={1}>
        {header}
        {Svg ? (
          <Box flexDirection="column">
            <Text weight="semibold">Activity · last {WEEKS} weeks</Text>
            <Svg source={map.source} alt={`Activity heatmap: ${s.activeDays} active days, ${s.currentStreak}-day current streak`} width={map.width} height={map.height} isInteractive />
          </Box>
        ) : (
          <Box flexDirection="column">
            <Text bold>Last 30 days</Text>
            <Text>{sparkline(s)}</Text>
          </Box>
        )}
        <Box flexDirection="column">
          {rows.map(([label, value]) => (
            <Box key={label} flexDirection="row" justifyContent="space-between">
              <Text dimColor>{label}</Text>
              <Text tabular>{value}</Text>
            </Box>
          ))}
        </Box>
        <Box flexDirection="column">
          <Text weight="semibold">Tokens</Text>
          {([
            ['Cache read', s.tokenBreakdown.cacheRead],
            ['Cache write', s.tokenBreakdown.cacheWrite],
            ['Output', s.tokenBreakdown.output],
            ['Input', s.tokenBreakdown.input],
          ] as const).map(([label, n]) => (
            <Box key={label} flexDirection="row" justifyContent="space-between">
              <Text dimColor>{label}</Text>
              <Text tabular>{compact(n)}</Text>
            </Box>
          ))}
        </Box>
        <Box flexDirection="column">
          <Text weight="semibold">Models</Text>
          {models.slice(0, 6).map(([id, n]) => (
            <Box key={id} flexDirection="row" justifyContent="space-between">
              <Text>{modelName(id)}</Text>
              <Text dimColor tabular>{`${Math.round((n / modelTotal) * 100)}%`}</Text>
            </Box>
          ))}
        </Box>
        {Svg && (
          <Box flexDirection="column">
            <Text weight="semibold">Prompts by hour</Text>
            <Svg source={hours.source} alt={`Prompts by hour of day; busiest at ${hourLabel(peakHour)}`} width={hours.width} height={hours.height} isInteractive />
          </Box>
        )}
        {st.error && <Text dimColor>Last refresh failed: {st.error}</Text>}
      </Box>
    )
  })
}
