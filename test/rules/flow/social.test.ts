import { describe, expect, it } from 'vitest'
import type { EventOf, RoleId } from '../../../shared/rules/types'
import { choice, nominate, passNomination, say, scriptedPorts, vote } from './helpers'

const roles: RoleId[] = ['chef', 'empath', 'soldier', 'poisoner', 'imp']

describe('conversations, whispers, nominations and voting', () => {
  it('selects most remaining, does not allow consecutive speakers, and caps each conversation', async () => {
    const game = scriptedPorts({ roles, maxSpeeches: 2, stop: e => e.type === 'phase.started' && e.phase === 'nomination',
      answer: ({ seat, request }) => request.kind === 'speak' ? say(`Seat ${seat}`) : request.kind === 'night_choice' ? choice(4) : undefined,
    })
    await game.run()
    const speeches = game.events.filter((e): e is EventOf<'public.speech'> => e.type === 'public.speech')
    expect(speeches).toHaveLength(10)
    expect(new Set(speeches.slice(0, 5).map(e => e.seat)).size).toBe(5)
    expect(speeches.every((e, i) => !i || speeches[i - 1]!.seat !== e.seat)).toBe(true)
    for (let seat = 1; seat <= 5; seat++) expect(speeches.filter(e => e.seat === seat)).toHaveLength(2)
  })

  it('all eligible passes finish conversation even if the last speaker has speeches left', async () => {
    const game = scriptedPorts({ roles, stop: e => e.type === 'phase.started' && e.phase === 'nomination',
      answer: ({ seat, request }) => request.kind === 'speak' ? say(seat === 1 ? 'Only me' : null) : request.kind === 'night_choice' ? choice(4) : undefined,
    })
    await game.run()
    expect(game.events.filter(e => e.type === 'public.speech')).toHaveLength(1)
  })

  it('merges identical whisper rooms, numbers candidates stably, drops unranked rooms, and deducts opened rooms only', async () => {
    const game = scriptedPorts({ roles, whisperRooms: 2, stop: e => e.type === 'phase.started' && e.phase === 'public',
      answer: ({ seat, request }) => {
        if (request.kind === 'night_choice') return choice(4)
        if (request.kind === 'propose_whisper') return { tool: 'propose_whisper', args: { reasoning: '', members: request.round === 1 ? seat === 1 ? [2] : seat === 2 ? [1] : seat === 3 ? [4] : null : null } }
        if (request.kind === 'rank_whispers') return { tool: 'rank_whispers', args: { reasoning: '', ranking: seat === 4 ? [] : request.rooms.map(r => r.room) } }
      },
    })
    await game.run()
    const proposed = game.events.find(e => e.type === 'whisper.proposed')
    expect(proposed).toMatchObject({ rooms: [{ members: [1, 2], proposers: [1, 2] }, { members: [3, 4], proposers: [3] }] })
    expect(game.events.filter(e => e.type === 'whisper.room.opened')).toEqual([expect.objectContaining({ members: [1, 2] })])
    expect(game.asks.filter(a => a.request.kind === 'propose_whisper' && a.request.round === 2).map(a => [a.seat, a.request.kind === 'propose_whisper' && a.request.remaining])).toEqual([[1, 1], [2, 1], [3, 2], [4, 2], [5, 2]])
    const candidates = game.events.find(e => e.type === 'whisper.candidates' && e.seat === 2)
    expect(candidates).toEqual(expect.objectContaining({ rooms: [{ room: 1, members: [1, 2] }] }))
  })

  it('allocates mutually compatible rooms by member rank sum; rooms talk in parallel and are isolated', async () => {
    const game = scriptedPorts({ roles, whisperRooms: 1, maxSpeeches: 1, stop: e => e.type === 'phase.started' && e.phase === 'public',
      answer: ({ seat, request }) => {
        if (request.kind === 'night_choice') return choice(4)
        if (request.kind === 'speak') return say('Private')
        if (request.kind === 'propose_whisper') return { tool: 'propose_whisper', args: { reasoning: '', members: seat === 1 ? [2] : seat === 2 ? [3] : seat === 4 ? [5] : null } }
        if (request.kind === 'rank_whispers') return { tool: 'rank_whispers', args: { reasoning: '', ranking: seat === 2 ? [2, 1] : request.rooms.map(r => r.room) } }
      },
    })
    await game.run()
    const opens = game.events.filter((e): e is EventOf<'whisper.room.opened'> => e.type === 'whisper.room.opened')
    expect(opens.map(e => e.members).sort()).toEqual([[2, 3], [4, 5]])
    const firstSpeech = game.events.findIndex(e => e.type === 'whisper.speech')
    expect(game.events.slice(0, firstSpeech).filter(e => e.type === 'whisper.room.opened')).toHaveLength(2)
    for (const ask of game.asks) if (ask.request.kind === 'speak' && ask.request.context.where === 'whisper') expect(ask.request.context.members).toContain(ask.seat)
  })

  it('sequential votes start after nominee; equal high water clears execution and cannot be regained by a lower tally', async () => {
    const game = scriptedPorts({ roles, stop: e => e.type === 'phase.started' && e.phase === 'night',
      answer: ({ seat, request }, _g, events) => {
        if (request.kind === 'night_choice') return choice(4)
        if (request.kind === 'nominate') {
          const round = events.filter(e => e.type === 'nomination').length
          return seat === round + 1 && round < 3 ? nominate(round + 1) : passNomination
        }
        if (request.kind === 'vote') {
          const round = events.filter(e => e.type === 'nomination').length
          return vote(round <= 2 ? seat <= 4 : seat <= 3)
        }
      },
    })
    await game.run()
    expect(game.events.filter(e => e.type === 'vote').slice(0, 5).map(e => e.type === 'vote' && e.seat)).toEqual([2, 3, 4, 5, 1])
    expect(game.events.filter(e => e.type === 'vote.tallied').map(e => e.type === 'vote.tallied' && [e.votes, e.threshold, e.aboutToDie])).toEqual([[4, 3, true], [4, 3, false], [3, 3, false]])
    expect(game.events.some(e => e.type === 'execution')).toBe(false)
    expect(game.asks.filter(a => a.request.kind === 'vote').slice(5).every(a => a.request.kind === 'vote' && a.request.threshold === 5)).toBe(true)
  })

  it('dead seats speak, cannot nominate, and spend only one vote token; spent tokens skip the model', async () => {
    const game = scriptedPorts({ roles, maxSpeeches: 1, stop: e => e.type === 'phase.started' && e.phase === 'night' && e.day === 3,
      answer: ({ seat, request }, g, events) => {
        if (request.kind === 'night_choice') return choice(request.as === 'imp' ? 2 : 4)
        if (request.kind === 'speak' && request.context.where === 'public') return say('Still here')
        if (request.kind === 'nominate') {
          const todays = events.filter(e => e.type === 'nomination' && e.seq > (events.findLast(e => e.type === 'phase.started' && e.phase === 'nomination')?.seq ?? 0)).length
          return g.day === 2 && todays < 2 && seat === (todays ? 3 : 1) ? nominate(todays ? 4 : 3) : passNomination
        }
        if (request.kind === 'vote') return vote(seat === 2)
      },
    })
    const g = await game.run()
    expect(g.seats[1]!.voteTokenUsed).toBe(true)
    const day2 = game.events.find(e => e.type === 'phase.started' && e.phase === 'dawn' && e.day === 2)!.seq
    expect(game.events.some(e => e.seq > day2 && e.type === 'public.speech' && e.seat === 2)).toBe(true)
    const deadVotes = game.events.filter((e): e is EventOf<'vote'> => e.type === 'vote' && e.seat === 2)
    expect(deadVotes).toEqual([expect.objectContaining({ raised: true, tokenUsed: true }), expect.objectContaining({ raised: false, tokenUsed: false, decisionSeq: null })])
    const requests = game.asks.filter(a => a.seat === 2 && a.request.kind === 'vote')
    expect(requests).toHaveLength(1)
    expect(game.asks.filter(a => a.seat === 2 && a.request.kind === 'nominate')).toHaveLength(1) // Day one only.
  })

  it('counts Butler votes regardless of master vote', async () => {
    const game = scriptedPorts({ roles: ['butler', 'chef', 'soldier', 'saint', 'poisoner', 'imp'], stop: e => e.type === 'phase.started' && e.phase === 'night',
      answer: ({ seat, request }) => request.kind === 'night_choice' ? choice(request.as === 'butler' ? 2 : 5) : request.kind === 'nominate' ? seat === 2 ? nominate(3) : passNomination : request.kind === 'vote' ? vote(seat !== 2) : undefined,
    })
    const g = await game.run()
    expect(game.events.find(e => e.type === 'vote.tallied')).toMatchObject({ votes: 5, aboutToDie: true })
    expect(g.seats[2]!.alive).toBe(false)
    expect(g.seats[1]!.masterOf).toBe(1)
  })
})
