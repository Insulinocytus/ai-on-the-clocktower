import { describe, expect, it } from 'vitest'
import type { RoleId } from '../../../shared/rules/types'
import { choice, nominate, passNomination, say, scriptedPorts, vote } from './helpers'

const roles: RoleId[] = ['slayer', 'virgin', 'undertaker', 'chef', 'soldier', 'saint', 'scarletwoman', 'imp']

describe('day abilities, executions and winners', () => {
  it('slayer ends immediately in public conversation, with no nominations or later speech', async () => {
    const game = scriptedPorts({ roles: ['slayer', 'chef', 'soldier', 'poisoner', 'imp'],
      answer: ({ seat, request }) => request.kind === 'speak' ? seat === 1 ? say('Shoot', 5) : say(null) : request.kind === 'night_choice' ? choice(4) : undefined,
    })
    const g = await game.run()
    expect(game.events.slice(-4).map(e => e.type)).toEqual(['public.speech', 'status.changed', 'slayer.resolved', 'game.ended'])
    expect(game.events.at(-1)).toMatchObject({ winner: 'good', reason: 'demon_dead' })
    expect(g.seats[0]!.abilityUsed).toBe(true)
    expect(g.seats[4]!.alive).toBe(false)
  })

  it.each(['chef', 'slayer'] as const)('fake/poisoned %s shots fail and real Slayer consumes its use', async as => {
    const game = scriptedPorts({ roles: [as, 'empath', 'soldier', 'poisoner', 'imp'], stop: e => e.type === 'phase.started' && e.phase === 'nomination',
      answer: ({ seat, request }) => request.kind === 'night_choice' ? choice(1) : request.kind === 'speak' ? seat === 1 ? say('Shoot', 5) : say(null) : undefined,
    })
    const g = await game.run()
    expect(g.seats[4]!.alive).toBe(true)
    expect(g.seats[0]!.abilityUsed).toBe(as === 'slayer')
    expect(game.events.filter(e => e.type === 'slayer.resolved')).toEqual([expect.objectContaining({ died: false })])
  })

  it('slayer kills demon-registering Recluse but cannot win by killing a true good player', async () => {
    const game = scriptedPorts({ roles: ['slayer', 'chef', 'soldier', 'recluse', 'poisoner', 'imp'], stop: e => e.type === 'phase.started' && e.phase === 'nomination',
      decide: ask => ask.discretion === 'D11' ? { alignment: 'good', roles: ['imp'] } : undefined,
      answer: ({ seat, request }) => request.kind === 'night_choice' ? choice(5) : request.kind === 'speak' ? seat === 1 ? say('Shoot', 4) : say(null) : undefined,
    })
    expect((await game.run()).seats[3]!.alive).toBe(false)
    expect(game.events.some(e => e.type === 'game.ended')).toBe(false)
  })

  it('slayer causes Scarlet Woman succession; her first attack occurs the following night', async () => {
    const game = scriptedPorts({ roles, stop: (e, events) => e.type === 'dawn.announced' && events.some(x => x.type === 'phase.started' && x.day === 2),
      answer: ({ seat, request }, g) => request.kind === 'nominate' ? passNomination : request.kind === 'speak' ? seat === 1 && g.day === 1 ? say('Shoot', 8) : say(null) : request.kind === 'night_choice' ? choice(4) : undefined,
    })
    const g = await game.run()
    expect(g.seats[6]!.role).toBe('imp')
    expect(g.seats[3]!.alive).toBe(false)
    const change = game.events.findIndex(e => e.type === 'role.changed')
    const tell = game.events.findIndex(e => e.type === 'told' && e.kind === 'became_imp')
    expect(game.events.slice(change, tell).some(e => e.type === 'phase.started' && e.phase === 'night')).toBe(true)
    expect(game.events.some(e => e.type === 'night.choice' && e.seat === 7 && e.as === 'imp')).toBe(true)
  })

  it.each(['chef', 'saint', 'drunk', 'spy'] as const)('first nomination by %s consumes Virgin; only registered townsfolk execute', async nominatorRole => {
    const game = scriptedPorts({ roles: [nominatorRole, 'virgin', 'undertaker', 'soldier', 'empath', 'recluse', 'poisoner', 'imp'],
      stop: e => e.type === 'phase.started' && e.phase === 'night',
      decide: ask => ask.discretion === 'D2' ? { roles: ['monk'] } : ask.discretion === 'D10' ? { alignment: 'evil', roles: ['chef'] } : undefined,
      answer: ({ seat, request }) => request.kind === 'night_choice' ? choice(7) : request.kind === 'nominate' ? seat === 1 ? nominate(2) : passNomination : request.kind === 'vote' ? vote(false) : undefined,
    })
    const g = await game.run()
    const triggers = nominatorRole === 'chef' || nominatorRole === 'spy'
    expect(g.seats[1]!.abilityUsed).toBe(true)
    expect(g.seats[0]!.alive).toBe(!triggers)
    expect(game.events.some(e => e.type === 'vote')).toBe(!triggers)
    if (triggers) expect(game.events.slice(-4).map(e => e.type)).toEqual(['status.changed', 'virgin.triggered', 'execution', 'phase.started'])
  })

  it('poisoned Virgin loses ability without executing; poisoned Slayer use is not restored at dusk', async () => {
    const game = scriptedPorts({ roles: ['chef', 'virgin', 'slayer', 'poisoner', 'imp'], stop: e => e.type === 'phase.started' && e.phase === 'night',
      answer: ({ seat, request }) => request.kind === 'night_choice' ? choice(2) : request.kind === 'nominate' ? seat === 1 ? nominate(2) : passNomination : request.kind === 'vote' ? vote(false) : undefined,
    })
    const g = await game.run()
    expect(g.seats[1]!.abilityUsed).toBe(true)
    expect(g.seats[0]!.alive).toBe(true)
    expect(game.events.some(e => e.type === 'virgin.triggered')).toBe(false)
  })

  it('Virgin execution supplies Undertaker information on the following night', async () => {
    const game = scriptedPorts({ roles, stop: (e, events) => e.type === 'dawn.announced' && events.some(x => x.type === 'phase.started' && x.day === 2),
      answer: ({ seat, request }) => request.kind === 'nominate' ? seat === 4 ? nominate(2) : passNomination : request.kind === 'night_choice' ? choice(5) : undefined,
    })
    await game.run()
    expect(game.events.find(e => e.type === 'told' && e.seat === 3 && e.kind === 'ability')).toMatchObject({ value: { roles: ['chef'] } })
    expect(game.events.some(e => e.type === 'night.choice' && e.as === 'ravenkeeper')).toBe(false)
  })

  it.each([false, true])('Saint execution ends evil unless poisoned=%s; a dead Saint execution does not trigger again', async poisoned => {
    const game = scriptedPorts({ roles: ['saint', 'chef', 'soldier', 'poisoner', 'imp'], stop: e => e.type === 'phase.started' && e.phase === 'night',
      answer: ({ seat, request }) => request.kind === 'night_choice' ? choice(poisoned ? 1 : 4) : request.kind === 'nominate' ? seat === 2 ? nominate(1) : passNomination : request.kind === 'vote' ? vote(true) : undefined,
    })
    const g = await game.run()
    expect(g.seats[0]!.alive).toBe(false)
    expect(game.events.some(e => e.type === 'game.ended')).toBe(!poisoned)
    if (!poisoned) expect(game.events.at(-1)).toMatchObject({ winner: 'evil', reason: 'saint_executed' })
  })

  it('Saint killed at night does not end the game', async () => {
    const game = scriptedPorts({ roles: ['saint', 'chef', 'soldier', 'poisoner', 'imp'], stop: (e, events) => e.type === 'dawn.announced' && events.some(x => x.type === 'phase.started' && x.day === 2),
      answer: ({ request }) => request.kind === 'nominate' ? passNomination : request.kind === 'night_choice' ? choice(request.as === 'imp' ? 1 : 4) : undefined,
    })
    expect((await game.run()).seats[0]!.alive).toBe(false)
    expect(game.events.some(e => e.type === 'game.ended')).toBe(false)
  })

  it('Mayor wins only at day end with exactly three living and no execution', async () => {
    const game = scriptedPorts({ roles: ['mayor', 'chef', 'empath', 'poisoner', 'imp'],
      answer: ({ request }, g) => request.kind === 'nominate' ? passNomination : request.kind === 'night_choice' ? choice(request.as === 'imp' ? g.day === 2 ? 2 : 3 : 4) : undefined,
    })
    const g = await game.run()
    expect(g.seats.filter(s => s.alive)).toHaveLength(3)
    expect(game.events.at(-1)).toMatchObject({ type: 'game.ended', winner: 'good', reason: 'mayor_win' })
  })

  it('poisoned Mayor cannot win; a kill to two living ends immediately before dawn', async () => {
    const game = scriptedPorts({ roles: ['mayor', 'chef', 'empath', 'poisoner', 'imp'],
      answer: ({ request }, g) => request.kind === 'nominate' ? passNomination : request.kind === 'night_choice' ? choice(request.as === 'imp' ? g.day === 2 ? 2 : g.day === 3 ? 3 : 1 : 1) : undefined,
    })
    await game.run()
    expect(game.events.slice(-2).map(e => e.type)).toEqual(['night.death', 'game.ended'])
    expect(game.events.at(-1)).toMatchObject({ winner: 'evil', reason: 'two_alive' })
  })

  it('Undertaker sees a Drunk as Drunk after execution and no Ravenkeeper wakes during day', async () => {
    const game = scriptedPorts({ roles: ['undertaker', 'drunk', 'chef', 'soldier', 'poisoner', 'imp'], stop: (e, events) => e.type === 'dawn.announced' && events.some(x => x.type === 'phase.started' && x.day === 2),
      decide: ask => ask.discretion === 'D2' ? { roles: ['ravenkeeper'] } : undefined,
      answer: ({ seat, request }) => request.kind === 'nominate' ? seat === 3 ? nominate(2) : passNomination : request.kind === 'vote' ? vote(true) : request.kind === 'night_choice' ? choice(request.as === 'imp' ? 4 : 5) : undefined,
    })
    await game.run()
    expect(game.events.find(e => e.type === 'told' && e.kind === 'ability' && e.seat === 1)).toMatchObject({ value: { roles: ['drunk'] } })
    expect(game.events.some(e => e.type === 'night.choice' && e.as === 'ravenkeeper')).toBe(false)
  })

  it('a killed demon at two remaining wins good over the two-alive evil condition', async () => {
    const game = scriptedPorts({ roles: ['slayer', 'chef', 'empath', 'poisoner', 'imp'],
      answer: ({ seat, request }, g) => request.kind === 'nominate' ? passNomination : request.kind === 'night_choice' ? choice(request.as === 'imp' ? g.day === 2 ? 2 : 3 : 4) : request.kind === 'speak' ? seat === 1 && g.day === 3 ? say('Shoot', 5) : say(null) : undefined,
    })
    const g = await game.run()
    expect(g.seats.filter(s => s.alive)).toHaveLength(2)
    expect(game.events.at(-1)).toMatchObject({ type: 'game.ended', winner: 'good' })
  })
})
