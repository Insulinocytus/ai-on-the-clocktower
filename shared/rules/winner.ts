import { isFunctioning } from './register'
import type { Alignment, EndReason, Grimoire, Seat } from './types'

export function winner(g: Grimoire, opts: { dayEndedWithoutExecution?: boolean; executed?: Seat } = {}): { winner: Alignment; reason: EndReason } | null {
  if (g.seats.length === 0) return null
  const alive = g.seats.filter(s => s.alive)
  if (!alive.some(s => s.role === 'imp')) return { winner: 'good', reason: 'demon_dead' }
  if (opts.dayEndedWithoutExecution && alive.length === 3 && alive.some(s => s.role === 'mayor' && isFunctioning(g, s.seat))) {
    return { winner: 'good', reason: 'mayor_win' }
  }
  if (opts.executed !== undefined && g.seats[opts.executed - 1]?.role === 'saint' && isFunctioning(g, opts.executed)) {
    return { winner: 'evil', reason: 'saint_executed' }
  }
  if (alive.length <= 2) return { winner: 'evil', reason: 'two_alive' }
  return null
}
