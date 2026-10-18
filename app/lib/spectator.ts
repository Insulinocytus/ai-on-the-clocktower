import type { DiscretionValue, EventOf, GameEvent, Lang, Phase } from '#shared/rules/types'
import { roleName } from '#shared/templates'

export interface ChannelBlock {
  key: string
  kind: 'setup' | 'phase' | 'room' | 'allocation'
  day: number
  phase?: Phase
  round?: number
  members?: number[]
  repeated?: boolean
  events: GameEvent[]
  end: number
}

export function channelBlocks(events: readonly GameEvent[]): ChannelBlock[] {
  const blocks: ChannelBlock[] = []
  const rooms = new Map<string, ChannelBlock>()
  const allocations = new Map<string, ChannelBlock>()
  const seen = new Set<string>()
  const actorBlocks = new Map<number, ChannelBlock>()
  let day = 0
  let current: ChannelBlock | undefined
  let latest: ChannelBlock | undefined
  const open = (block: ChannelBlock): ChannelBlock => { blocks.push(block); return block }
  const allocation = (round: number): ChannelBlock => {
    const key = `${day}:${round}`
    let block = allocations.get(key)
    if (!block) { block = open({ key: `allocation:${key}`, kind: 'allocation', day, round, events: [], end: 0 }); allocations.set(key, block) }
    return block
  }
  for (const event of events) {
    let block: ChannelBlock | undefined
    if (event.type === 'phase.started') {
      day = event.day
      current = event.phase === 'whisper' ? undefined : open({ key: `phase:${event.seq}`, kind: 'phase', day, phase: event.phase, events: [], end: event.seq })
      if (!current) continue
      block = current
    } else if (event.type === 'whisper.room.opened' || event.type === 'whisper.speech' || event.type === 'whisper.room.closed') {
      const key = `${day}:${event.room}`
      block = rooms.get(key)
      if (!block) {
        const membersKey = `${day}:${[...event.members].sort((a, b) => a - b).join(',')}`
        block = open({ key: `room:${key}`, kind: 'room', day, round: event.round, members: event.members, repeated: seen.has(membersKey), events: [], end: event.seq })
        rooms.set(key, block); seen.add(membersKey)
      }
    } else if (event.type === 'contestant.decision') {
      const request = event.request
      if (request.kind === 'propose_whisper' || request.kind === 'rank_whispers') block = allocation(request.round)
      else if (request.kind === 'speak' && request.context.where === 'whisper') block = rooms.get(`${day}:${request.context.room}`)
      block ??= current
      if (block) actorBlocks.set(event.seat, block)
    } else if (event.type === 'whisper.proposed' || event.type === 'whisper.candidates' || event.type === 'whisper.ranked') block = allocation(event.round)
    else if (event.type === 'seat.memo.updated') block = actorBlocks.get(event.seat) ?? current
    else if (event.type === 'game.ended' || event.type === 'game.aborted') block = latest ?? current
    block ??= current
    if (!block) {
      current = blocks.find(item => item.kind === 'setup') ?? open({ key: 'setup', kind: 'setup', day: 0, events: [], end: 0 })
      block = current
    }
    block.events.push(event)
    block.end = event.seq
    latest = block
  }
  return blocks
}

export function adoptedDecisions(events: readonly GameEvent[]): Set<number> {
  const adopted = new Set<number>()
  for (const event of events) {
    if ('decisionSeq' in event && event.decisionSeq !== null) adopted.add(event.decisionSeq)
    if (event.type === 'nomination') {
      const decision = events.findLast(candidate => candidate.seq < event.seq && candidate.type === 'contestant.decision' && candidate.seat === event.nominator && candidate.request.kind === 'nominate' && candidate.outcome.ok && candidate.outcome.call.args.nominee === event.nominee)
      if (decision) adopted.add(decision.seq)
    }
  }
  return adopted
}

export function involvesSeat(event: GameEvent, seat: number): boolean {
  if ('seat' in event && event.seat === seat) return true
  if (event.type === 'whisper.room.opened' || event.type === 'whisper.room.closed' || event.type === 'whisper.speech') return false
  if ('target' in event && event.target === seat) return true
  if ('targets' in event && event.targets?.includes(seat)) return true
  if ('nominator' in event && event.nominator === seat) return true
  if ('nominee' in event && event.nominee === seat) return true
  if ('deaths' in event && event.deaths.includes(seat)) return true
  if (event.type === 'discretion.requested') return event.context.subject === seat
  if (event.type === 'discretion.resolved') return event.value.seats?.includes(seat) ?? false
  if (event.type === 'ability.resolved') return event.targets?.includes(seat) ?? false
  return false
}

export function valueLabel(value: DiscretionValue, lang: Lang): string {
  const parts: string[] = []
  if (value.seats) parts.push(value.seats.length ? value.seats.map(seat => lang === 'zh' ? `${seat} 号` : `Seat ${seat}`).join(', ') : lang === 'zh' ? '无座位' : 'No seats')
  if (value.roles) parts.push(value.roles.length ? value.roles.map(role => roleName(role, lang)).join(', ') : lang === 'zh' ? '无角色' : 'No roles')
  if (value.number !== undefined) parts.push(String(value.number))
  if (value.answer !== undefined) parts.push(lang === 'zh' ? value.answer ? '是' : '否' : value.answer ? 'Yes' : 'No')
  if (value.alignment) parts.push(lang === 'zh' ? value.alignment === 'good' ? '善良' : '邪恶' : value.alignment === 'good' ? 'Good' : 'Evil')
  return parts.join(' / ')
}

export type ContestantDecision = EventOf<'contestant.decision'>
