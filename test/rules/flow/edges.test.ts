import { describe, expect, it } from 'vitest'
import type { GameEvent } from '../../../shared/rules/types'
import { choice, nominate, passNomination, scriptedPorts, vote } from './helpers'

const untilDawn3 = (e: GameEvent, events: GameEvent[]) => e.type === 'dawn.announced' && events.some(x => x.type === 'phase.started' && x.day === 3)

describe('role interactions and remaining boundaries', () => {
  it('an already-dead demon target does nothing and cannot be reselected', async () => {
    const game = scriptedPorts({ roles: ['chef', 'empath', 'soldier', 'poisoner', 'imp'], stop: untilDawn3,
      answer: ({ request }) => request.kind === 'nominate' ? passNomination : request.kind === 'night_choice' ? choice(request.as === 'imp' ? 1 : 4) : undefined,
    })
    const g = await game.run()
    expect(g.seats.filter(s => !s.alive)).toHaveLength(1)
    expect(game.events.filter(e => e.type === 'night.death')).toHaveLength(1)
    expect(game.events.at(-1)).toMatchObject({ deaths: [] })
  })

  it('D14 with several minions excludes demon-registering Recluse and includes poisoned minions', async () => {
    const game = scriptedPorts({ roles: ['chef', 'soldier', 'monk', 'empath', 'undertaker', 'slayer', 'virgin', 'recluse', 'poisoner', 'spy', 'imp'],
      stop: (e, events) => e.type === 'dawn.announced' && events.some(x => x.type === 'phase.started' && x.day === 2),
      decide: ask => ask.discretion === 'D11' ? { alignment: 'evil', roles: ['poisoner'] } : ask.discretion === 'D14' ? { seats: [9] } : undefined,
      answer: ({ request }) => request.kind === 'nominate' ? passNomination : request.kind === 'night_choice' ? choice(request.as === 'imp' ? 11 : request.as === 'monk' ? 1 : 9) : undefined,
    })
    const g = await game.run()
    expect(game.discretions.find(a => a.discretion === 'D14')?.candidates).toEqual({ kind: 'list', values: [{ seats: [9] }, { seats: [10] }] })
    expect(g.seats[8]!.role).toBe('imp')
    expect(g.seats[8]!.poisonedBy).toBeNull()
    expect(g.seats[7]!.role).toBe('recluse')
  })

  it('poisoned Scarlet Woman cannot force succession but can be the D14 true minion successor', async () => {
    const game = scriptedPorts({ roles: ['chef', 'soldier', 'empath', 'monk', 'undertaker', 'slayer', 'virgin', 'scarletwoman', 'poisoner', 'imp'],
      stop: (e, events) => e.type === 'dawn.announced' && events.some(x => x.type === 'phase.started' && x.day === 2),
      decide: ask => ask.discretion === 'D14' ? { seats: [8] } : undefined,
      answer: ({ request }) => request.kind === 'nominate' ? passNomination : request.kind === 'night_choice' ? choice(request.as === 'imp' ? 10 : request.as === 'monk' ? 1 : 8) : undefined,
    })
    const g = await game.run()
    expect(game.discretions.some(a => a.discretion === 'D14')).toBe(true)
    expect(g.seats[7]).toMatchObject({ role: 'imp', poisonedBy: 9 })
  })

  it('self-kill without living minions wins good, and dead minions cannot inherit', async () => {
    const game = scriptedPorts({ roles: ['chef', 'empath', 'soldier', 'poisoner', 'imp'],
      answer: ({ seat, request }, g) => request.kind === 'nominate' ? g.day === 1 && seat === 1 ? nominate(4) : passNomination : request.kind === 'vote' ? vote(true) : request.kind === 'night_choice' ? choice(request.as === 'imp' ? 5 : 4) : undefined,
    })
    await game.run()
    expect(game.events.at(-1)).toMatchObject({ type: 'game.ended', winner: 'good' })
    expect(game.events.filter(e => e.type === 'role.changed')).toHaveLength(0)
    expect(game.discretions.some(a => a.discretion === 'D14')).toBe(false)
  })

  it('Scarlet Woman cannot rescue a demon executed with only four alive', async () => {
    const game = scriptedPorts({ roles: ['chef', 'empath', 'soldier', 'scarletwoman', 'imp'],
      answer: ({ seat, request }, g) => request.kind === 'nominate' ? seat === 1 ? nominate(g.day === 1 ? 2 : 5) : passNomination : request.kind === 'vote' ? vote(true) : request.kind === 'night_choice' ? choice(2) : undefined,
    })
    const g = await game.run()
    expect(g.seats[3]!.role).toBe('scarletwoman')
    expect(game.events.at(-1)).toMatchObject({ winner: 'good', reason: 'demon_dead' })
  })

  it('a demon execution at five alive converts Scarlet Woman and Undertaker still sees Imp', async () => {
    const game = scriptedPorts({ roles: ['undertaker', 'empath', 'soldier', 'scarletwoman', 'imp'],
      stop: (e, events) => e.type === 'dawn.announced' && events.some(x => x.type === 'phase.started' && x.day === 2),
      answer: ({ seat, request }) => request.kind === 'nominate' ? seat === 2 ? nominate(5) : passNomination : request.kind === 'vote' ? vote(true) : request.kind === 'night_choice' ? choice(3) : undefined,
    })
    const g = await game.run()
    expect(g.seats[3]!.role).toBe('imp')
    expect(game.events.find(e => e.type === 'told' && e.seat === 1 && e.kind === 'ability')).toMatchObject({ value: { roles: ['imp'] } })
    expect(game.events.some(e => e.type === 'night.choice' && e.seat === 4)).toBe(true)
  })

  it.each(['monk', 'soldier', 'ravenkeeper', 'virgin'] as const)('Drunk believing %s acts but never gains its ability', async believed => {
    const game = scriptedPorts({ roles: ['drunk', 'chef', 'empath', 'saint', 'poisoner', 'imp'],
      stop: (e, events) => e.type === 'dawn.announced' && events.some(x => x.type === 'phase.started' && x.day === 2),
      decide: ask => ask.discretion === 'D2' ? { roles: [believed] } : ask.discretion === 'D8' ? { seats: [1], roles: ['drunk'] } : undefined,
      answer: ({ seat, request }) => request.kind === 'nominate' ? believed === 'virgin' && seat === 2 ? nominate(1) : passNomination : request.kind === 'vote' ? vote(false) : request.kind === 'night_choice' ? choice(request.as === 'imp' ? 1 : request.as === 'monk' ? 1 === seat ? 2 : 1 : request.as === 'ravenkeeper' ? 1 : 5) : undefined,
    })
    const g = await game.run()
    expect(g.seats[0]!.alive).toBe(false)
    if (believed === 'monk') {
      expect(game.events.some(e => e.type === 'night.choice' && e.as === 'monk')).toBe(true)
      expect(game.events.some(e => e.type === 'status.changed' && e.status === 'protected')).toBe(false)
    }
    if (believed === 'ravenkeeper') expect(game.events.find(e => e.type === 'told' && e.seat === 1 && e.kind === 'ability')).toMatchObject({ value: { seats: [1], roles: ['drunk'] } })
    if (believed === 'virgin') expect(g.seats[0]!.abilityUsed).toBe(true)
  })

  it('poisoned Ravenkeeper still chooses and obtains D8 rather than true information', async () => {
    const game = scriptedPorts({ roles: ['ravenkeeper', 'chef', 'empath', 'poisoner', 'imp'],
      stop: (e, events) => e.type === 'dawn.announced' && events.some(x => x.type === 'phase.started' && x.day === 2),
      decide: ask => ask.discretion === 'D8' ? { seats: [5], roles: ['mayor'] } : undefined,
      answer: ({ request }) => request.kind === 'nominate' ? passNomination : request.kind === 'night_choice' ? choice(request.as === 'ravenkeeper' ? 5 : 1) : undefined,
    })
    await game.run()
    expect(game.events.find(e => e.type === 'ability.resolved' && e.as === 'ravenkeeper')).toMatchObject({ effective: false, result: { seats: [5], roles: ['imp'] }, told: { value: { seats: [5], roles: ['mayor'] }, reason: 'poisoned', deviates: true } })
  })

  it('execution of a dead seat uses the day slot but does not trigger dead Saint', async () => {
    const game = scriptedPorts({ roles: ['saint', 'chef', 'empath', 'poisoner', 'imp'],
      stop: e => e.type === 'phase.started' && e.phase === 'night' && e.day === 3,
      answer: ({ seat, request }, g) => request.kind === 'nominate' ? g.day === 2 && seat === 2 ? nominate(1) : passNomination : request.kind === 'vote' ? vote(true) : request.kind === 'night_choice' ? choice(request.as === 'imp' ? 1 : 4) : undefined,
    })
    await game.run()
    expect(game.events.some(e => e.type === 'execution' && e.seat === 1)).toBe(true)
    expect(game.events.some(e => e.type === 'game.ended')).toBe(false)
  })
})
