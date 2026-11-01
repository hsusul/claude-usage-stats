export type DayStats = {
  messages: number
  sessions: number
  tools: number
  tokens: number
}

export type Stats = {
  computedAt: string
  daily: Record<string, DayStats>
  models: Record<string, number>
  hours: number[]
  totalSessions: number
  totalMessages: number
  totalTokens: number
  tokenBreakdown: { input: number; output: number; cacheWrite: number; cacheRead: number }
  activeDays: number
  currentStreak: number
  longestStreak: number
  longestSession: { messages: number; date: string | null }
  firstSession: string | null
}

export type LoadStatus = { isLoading: boolean; error?: string }

declare module 'claude-code' {
  interface PluginState {
    'usage-stats': {
      stats: Shaped<Stats | null>
      status: LoadStatus
    }
  }
}
