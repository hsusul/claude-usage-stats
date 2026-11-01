import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'usage-stats',
  component: 'Pane',
  requestId: 'usage-stats',
  props: {
    title: 'Claude stats',
    isFocused: false,
    bodyColumns: 50,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

const STATS = {
  computedAt: '2026-11-01T17:28:11-06:00',
  daily: {
    '2026-10-30': { messages: 3494, sessions: 6, tools: 3493, tokens: 2429762 },
    '2026-10-31': { messages: 1089, sessions: 8, tools: 1030, tokens: 786426 },
    '2026-11-01': { messages: 406, sessions: 4, tools: 311, tokens: 172902 },
  },
  models: { 'claude-opus-5-5': 3000, 'claude-sonnet-5': 1000 },
  hours: Array.from({ length: 24 }, (_, h) => (h === 21 ? 50 : 3)),
  totalSessions: 18,
  totalMessages: 4989,
  totalTokens: 22852324541,
  tokenBreakdown: { input: 261424, output: 59037642, cacheWrite: 641862620, cacheRead: 22151162855 },
  activeDays: 3,
  currentStreak: 3,
  longestStreak: 3,
  longestSession: { messages: 975, date: '2026-10-30' },
  firstSession: '2026-10-30T04:35:51.525Z',
}

test('the panel draws the stats the script reports, on every surface', async ($, on) => {
  on('command.register', () => ({ value: { command: 'usage-stats' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('process.run', () => ({
    value: { exitCode: 0, stdout: JSON.stringify(STATS), stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: 'Opus 5.5' }))?.text).toBe('Opus 5.5')
    expect((await ui.find({ type: 'Text', text: '3 days' }))?.text).toBe('3 days')
    expect((await ui.find({ type: 'Text', text: '9pm' }))?.text).toBe('9pm')
    expect((await ui.find({ type: 'Text', text: '22.9B' }))?.text).toBe('22.9B')
    expect((await ui.find({ type: 'Text', text: '22.2B' }))?.text).toBe('22.2B')
    await ui.unmount()
  }
})
