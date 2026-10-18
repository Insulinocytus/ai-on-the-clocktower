import type { EventBody, GameEvent, Observer, Seat } from './types'

export type Audience =
  | { level: 'public' }
  | { level: 'seats'; seats: Seat[] }
  | { level: 'storyteller' }
  | { level: 'spectator' }

export function audience(e: EventBody): Audience {
  switch (e.type) {
    case 'phase.started': case 'game.ended': case 'dawn.announced': case 'whisper.room.opened':
    case 'public.speech': case 'slayer.resolved': case 'nomination': case 'virgin.triggered':
    case 'vote': case 'vote.tallied': case 'execution':
      return { level: 'public' }
    case 'told': case 'seat.memo.updated': case 'night.choice': case 'whisper.candidates':
      return { level: 'seats', seats: [e.seat] }
    case 'whisper.speech': case 'whisper.room.closed':
      return { level: 'seats', seats: e.members }
    case 'storyteller.decision': case 'discretion.requested': case 'discretion.resolved':
    case 'grimoire.set': case 'status.changed': case 'role.changed': case 'ability.resolved': case 'night.death':
      return { level: 'storyteller' }
    default:
      return { level: 'spectator' }
  }
}

export function canSee(e: EventBody, o: Observer): boolean {
  if (o.kind === 'spectator') return true
  const a = audience(e)
  if (a.level === 'spectator') return false
  if (o.kind === 'storyteller' || a.level === 'public') return true
  return a.level === 'seats' && o.kind === 'seat' && a.seats.includes(o.seat)
}

export function project(events: readonly GameEvent[], o: Observer): GameEvent[] {
  return events.filter(e => canSee(e, o))
}

export function parseObserver(s: string): Observer | null {
  if (s === 'spectator' || s === 'storyteller' || s === 'public') return { kind: s }
  if (!/^seat:[1-9]\d*$/.test(s)) return null
  const seat = Number(s.slice(5))
  return Number.isSafeInteger(seat) && seat <= 15 ? { kind: 'seat', seat } : null
}
