import { describe, expect, it } from 'vitest'
import type { RoleId } from '../../../shared/rules/types'
import { choice, passNomination, scriptedPorts } from './helpers'

describe('setup and information', () => {
  it('settles setup in order, fixed registrations, and tells drunk its believed role', async () => {
    const game = scriptedPorts({ roles: ['fortuneteller', 'washerwoman', 'drunk', 'recluse', 'spy', 'poisoner', 'chef', 'imp', 'empath', 'monk', 'undertaker', 'saint'],
      stop: e => e.type === 'phase.started',
      decide: ask => ask.discretion === 'D2' ? { roles: ['ravenkeeper'] } : undefined,
    })
    game.config.sources.seating = 'manual'
    const g = await game.run()
    expect(game.discretions.map(a => a.discretion)).toEqual(['D1', 'seating', 'D2', 'D3', 'D7', 'D10', 'D11'])
    expect(game.events.filter(e => e.type === 'grimoire.set')).toHaveLength(6)
    expect(game.events.some(e => e.type === 'told' && e.seat === 3 && e.kind === 'role' && e.role === 'ravenkeeper')).toBe(true)
    const d3 = game.discretions.find(a => a.discretion === 'D3')!
    expect(d3.candidates).toMatchObject({ values: [1, 2, 3, 4, 7, 9, 10, 11, 12].map(seat => ({ seats: [seat] })) })
    const d7 = game.discretions.find(a => a.discretion === 'D7')!
    if (d7.candidates.kind !== 'list') throw new Error('expected triples')
    for (const value of d7.candidates.values) {
      expect(new Set(value.roles).size).toBe(3)
      expect(value.roles?.some(role => g.seats.some(s => s.role === role) || role === g.drunkBelieves)).toBe(false)
    }
    expect(game.discretions.find(a => a.discretion === 'D10')?.candidates).toMatchObject({ values: expect.arrayContaining([{ alignment: 'good', roles: ['spy'] }, { alignment: 'evil', roles: ['saint'] }]) })
    expect(game.discretions.find(a => a.discretion === 'D11')?.candidates).toMatchObject({ values: expect.arrayContaining([{ alignment: 'good', roles: ['imp'] }, { alignment: 'evil', roles: ['recluse'] }]) })
  })

  it('small games have neither bluffs nor evil team information', async () => {
    for (const roles of [['chef', 'empath', 'soldier', 'poisoner', 'imp'], ['chef', 'empath', 'soldier', 'drunk', 'poisoner', 'imp']] as RoleId[][]) {
      const game = scriptedPorts({ roles, stop: e => e.type === 'dawn.announced' })
      await game.run()
      expect(game.discretions.some(a => a.discretion === 'D7')).toBe(false)
      expect(game.events.some(e => e.type === 'told' && (e.kind === 'minion_info' || e.kind === 'demon_info'))).toBe(false)
    }
  })

  it.each(['washerwoman', 'librarian', 'investigator'] as const)('%s pairs exclude self, both functioning and drunk', async as => {
    for (const drunk of [false, true]) {
      const roles: RoleId[] = [drunk ? 'drunk' : as, 'chef', 'soldier', 'recluse', 'poisoner', 'imp']
      const game = scriptedPorts({ roles, stop: e => e.type === 'dawn.announced',
        decide: ask => ask.discretion === 'D2' ? { roles: [as] } : ask.discretion === 'D11' ? { alignment: 'good', roles: ['recluse'] } : undefined,
        answer: ({ request }) => request.kind === 'night_choice' ? choice(5) : undefined,
      })
      await game.run()
      const discretion = game.discretions.find(a => a.context.subject === 1 && ['D4', 'D5', 'D6', 'D8'].includes(a.discretion))!
      if (discretion.candidates.kind !== 'list') throw new Error('expected list')
      expect(discretion.candidates.values.every(value => !value.seats?.includes(1))).toBe(true)
      if (drunk) expect(discretion.discretion).toBe('D8')
      expect(game.events.find(e => e.type === 'ability.resolved' && e.seat === 1)).toMatchObject({ effective: !drunk })
    }
  })

  it('sole Washerwoman uses a truthful self pair instead of false information', async () => {
    const game = scriptedPorts({ roles: ['washerwoman', 'butler', 'saint', 'baron', 'imp'], stop: e => e.type === 'dawn.announced' })
    await game.run()
    const ask = game.discretions.find(a => a.discretion === 'D4')!
    expect(ask.candidates).toMatchObject({ values: [2, 3, 4, 5].map(seat => ({ seats: [1, seat], roles: ['washerwoman'] })) })
    expect(game.events.find(e => e.type === 'ability.resolved' && e.seat === 1)).toMatchObject({ effective: true, told: { deviates: false } })
  })

  it('librarian with no outsiders is a singleton and writes no discretion events', async () => {
    const game = scriptedPorts({ roles: ['librarian', 'chef', 'soldier', 'poisoner', 'imp'], stop: e => e.type === 'dawn.announced', answer: ({ request }) => request.kind === 'night_choice' ? choice(4) : undefined })
    await game.run()
    expect(game.discretions.some(a => a.discretion === 'D5')).toBe(false)
    expect(game.events.find(e => e.type === 'told' && e.kind === 'ability' && e.seat === 1)).toMatchObject({ value: { seats: [], roles: [] } })
  })

  it('poisoned first-night roles replace D4–D6 with D8, with ability/told after discretion', async () => {
    for (const as of ['washerwoman', 'librarian', 'investigator'] as const) {
      const game = scriptedPorts({ roles: [as, 'chef', 'soldier', 'poisoner', 'imp'], stop: e => e.type === 'dawn.announced', answer: ({ request }) => request.kind === 'night_choice' ? choice(1) : undefined })
      await game.run()
      expect(game.discretions.find(a => a.context.subject === 1)?.discretion).toBe('D8')
      const resolved = game.events.findIndex(e => e.type === 'discretion.resolved' && e.discretion === 'D8')
      expect(game.events.slice(resolved, resolved + 3).map(e => e.type)).toEqual(['discretion.resolved', 'ability.resolved', 'told'])
    }
  })

  it('drunk fortune teller has no red herring and still chooses; D8 may give correct information', async () => {
    const game = scriptedPorts({ roles: ['drunk', 'chef', 'soldier', 'saint', 'poisoner', 'imp'], stop: e => e.type === 'dawn.announced',
      decide: ask => ask.discretion === 'D2' ? { roles: ['fortuneteller'] } : ask.discretion === 'D8' ? ask.context.truth : undefined,
      answer: ({ request }) => request.kind === 'night_choice' ? request.as === 'fortuneteller' ? choice(1, 6) : choice(5) : undefined,
    })
    expect((await game.run()).redHerring).toBeNull()
    expect(game.discretions.some(a => a.discretion === 'D3')).toBe(false)
    expect(game.events.find(e => e.type === 'ability.resolved' && e.seat === 1)).toMatchObject({ effective: false, targets: [1, 6], told: { value: { answer: true }, deviates: false } })
  })

  it('fixed registrations affect information independently and dead recluse still registers', async () => {
    const game = scriptedPorts({ roles: ['chef', 'empath', 'fortuneteller', 'ravenkeeper', 'soldier', 'recluse', 'spy', 'imp'],
      stop: (e, events) => e.type === 'dawn.announced' && events.some(x => x.type === 'phase.started' && x.day === 2),
      decide: ask => ask.discretion === 'D10' ? { alignment: 'good', roles: ['saint'] } : ask.discretion === 'D11' ? { alignment: 'evil', roles: ['imp'] } : undefined,
      answer: ({ request }) => request.kind === 'nominate' ? passNomination : request.kind === 'night_choice' ? request.as === 'imp' ? choice(6) : choice(6, 7) : undefined,
    })
    const g = await game.run()
    expect(g.seats[5]!.alive).toBe(false)
    expect(game.discretions.filter(a => a.discretion === 'D11')).toHaveLength(1)
    expect(game.events.filter(e => e.type === 'ability.resolved' && e.as === 'fortuneteller').every(e => e.type === 'ability.resolved' && e.told?.value.answer)).toBe(true)
    expect(game.events.some(e => e.type === 'ability.resolved' && e.as === 'chef' && e.told?.reason === 'register')).toBe(true)
  })

  it('undertaker never wakes after no execution, nor does a night kill count as execution', async () => {
    const game = scriptedPorts({ roles: ['undertaker', 'chef', 'soldier', 'poisoner', 'imp'], stop: (e, events) => e.type === 'dawn.announced' && events.some(x => x.type === 'phase.started' && x.day === 2),
      answer: ({ request }) => request.kind === 'nominate' ? passNomination : request.kind === 'night_choice' ? choice(request.as === 'imp' ? 2 : 4) : undefined,
    })
    await game.run()
    expect(game.events.some(e => e.type === 'ability.resolved' && e.as === 'undertaker')).toBe(false)
  })
})
