import type { GameEvent } from '../types/game'

export interface ChannelBlock {
  key: string
  kind:
    | 'setup'
    | 'allocation'
    | 'room'
    | Exclude<Extract<GameEvent, { type: 'phase.started' }>['phase'], 'whisper'>
  day: number
  events: GameEvent[]
  end: number
  round?: number
  members?: number[]
  occurrence?: number
}

export function channelTheme(kind: ChannelBlock['kind'] | undefined): 'night' | 'day' {
  return kind === undefined || kind === 'setup' || kind === 'first-night' || kind === 'night'
    ? 'night'
    : 'day'
}

export function channelBlocks(events: readonly GameEvent[]): ChannelBlock[] {
  const blocks: ChannelBlock[] = []
  const rooms = new Map<string, ChannelBlock>()
  const allocations = new Map<string, ChannelBlock>()
  const memberships = new Map<string, number>()
  let day = 0
  let current: ChannelBlock | undefined

  function create(kind: ChannelBlock['kind'], event: GameEvent): ChannelBlock {
    const block: ChannelBlock = {
      key: `${kind}:${String(event.seq)}`,
      kind,
      day,
      events: [],
      end: event.seq,
    }
    blocks.push(block)
    return block
  }
  function allocation(round: number, event: GameEvent): ChannelBlock {
    const key = `${String(day)}:${String(round)}`
    let block = allocations.get(key)
    if (!block) {
      block = create('allocation', event)
      block.round = round
      allocations.set(key, block)
    }
    return block
  }

  for (const event of events) {
    let block: ChannelBlock | undefined
    if (event.type === 'phase.started') {
      day = event.day
      current = event.phase === 'whisper' ? allocation(1, event) : create(event.phase, event)
      block = current
    } else if ('roomId' in event) {
      const key = `${String(day)}:${event.roomId}`
      block = rooms.get(key)
      if (!block) {
        block = create('room', event)
        block.round = event.round
        block.members = [...event.members].sort((a, b) => a - b)
        const membership = `${String(day)}:${block.members.join(',')}`
        block.occurrence = (memberships.get(membership) ?? 0) + 1
        memberships.set(membership, block.occurrence)
        rooms.set(key, block)
      }
    } else if (event.type === 'contestant.decision') {
      const request = event.request
      if (request.tool === 'speak' && request.room) {
        block = rooms.get(`${String(day)}:${request.room.id}`)
      } else if ('round' in request) {
        block = allocation(request.round, event)
        current = block
      }
    } else if ('round' in event) {
      block = allocation(event.round, event)
      current = block
    }
    block ??= current ?? blocks.at(-1) ?? create('setup', event)
    block.events.push(event)
    block.end = event.seq
    if ('roomId' in event) current = block
    if (block.kind === 'setup') current = block
  }
  return blocks
}
