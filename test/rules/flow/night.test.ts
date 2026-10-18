import { describe, expect, it } from 'vitest'
import { foldGrimoire } from '../../../shared/rules/fold'
import type { EventOf, GameEvent, RoleId } from '../../../shared/rules/types'
import { choice, passNomination, scriptedPorts } from './helpers'

const base: RoleId[] = ['soldier', 'monk', 'empath', 'poisoner', 'imp']
const stopDay2 = (event: GameEvent, events: GameEvent[]) => event.type === 'dawn.announced' && events.some(e => e.type === 'phase.started' && e.phase === 'dawn' && e.day === 2)
const tells = (events: GameEvent[], seat: number) => events.filter((e): e is EventOf<'told'> => e.type === 'told' && e.seat === seat)

function attack(roles: RoleId[], target: number, options: { poison?: number; protect?: number; bounce?: number; rkTarget?: number } = {}) {
  return scriptedPorts({ roles, stop: stopDay2,
    decide: ask => ask.discretion === 'D12' ? { answer: options.bounce !== undefined } : ask.discretion === 'D13' ? { seats: [options.bounce!] } : undefined,
    answer: ({ request }, g) => {
      if (request.kind === 'nominate') return passNomination
      if (request.kind !== 'night_choice') return
      if (request.as === 'imp') return choice(target)
      if (request.as === 'poisoner') return choice(options.poison ?? roles.indexOf('poisoner') + 1)
      if (request.as === 'monk') return choice(options.protect ?? roles.indexOf('imp') + 1)
      if (request.as === 'ravenkeeper') return choice(options.rkTarget ?? 1)
      return choice(...g.seats.slice(0, request.count).map(s => s.seat))
    },
  })
}

describe('night abilities and death path', () => {
  it('does not ask information-only roles, uses first-night order and emits ability before told', async () => {
    const game = scriptedPorts({ roles: ['washerwoman', 'librarian', 'investigator', 'chef', 'empath', 'butler', 'poisoner', 'imp'], stop: e => e.type === 'dawn.announced', answer: ({ request }) => request.kind === 'night_choice' ? choice(request.as === 'poisoner' ? 7 : 1) : undefined })
    await game.run()
    expect(game.asks.map(a => a.request.kind)).toEqual(['night_choice', 'night_choice'])
    expect(game.events.filter((e): e is EventOf<'ability.resolved'> => e.type === 'ability.resolved').map(e => e.as)).toEqual(['poisoner', 'washerwoman', 'librarian', 'investigator', 'chef', 'empath', 'butler'])
    for (const e of game.events) if (e.type === 'told' && e.kind === 'ability') expect(game.events[e.seq - 2]?.type).toBe('ability.resolved')
  })

  it.each([
    ['soldier', 1, undefined, true], ['monk protected', 3, 3, true], ['ordinary', 3, undefined, false],
  ] as const)('resolves demon attack on %s', async (_name, target, protect, survives) => {
    const game = attack(base, target, { protect })
    const g = await game.run()
    expect(g.seats[target - 1]!.alive).toBe(survives)
    expect(game.events.filter(e => e.type === 'night.death').length).toBe(survives ? 0 : 1)
    expect(game.events.at(-1)).toMatchObject({ type: 'dawn.announced', deaths: survives ? [] : [target] })
  })

  it('poisoned soldier dies; poisoned monk still chooses but gives no protection', async () => {
    for (const poison of [1, 2]) {
      const target = poison === 1 ? 1 : 3
      const game = attack(base, target, { poison, protect: target })
      const g = await game.run()
      if (poison === 1) expect(g.seats[0]!.alive).toBe(true)
      else expect(g.seats[2]!.alive).toBe(false)
      expect(game.events.some(e => e.type === 'night.choice' && e.as === 'monk')).toBe(true)
    }
    const poisoned = attack(base, 1, { poison: 1, protect: 5 })
    expect((await poisoned.run()).seats[0]!.alive).toBe(false)
  })

  it('self-poison survives until dusk, then poison is renewed; imp poison suppresses attacks', async () => {
    const self = attack(base, 3)
    await self.run()
    const poisonEvents = self.events.filter(e => e.type === 'status.changed' && e.status === 'poisoned')
    expect(poisonEvents.map(e => e.type === 'status.changed' && e.on)).toEqual([true, false, true])
    const poisonedImp = attack(base, 3, { poison: 5 })
    expect((await poisonedImp.run()).seats[2]!.alive).toBe(true)
    expect(poisonedImp.events.some(e => e.type === 'ability.resolved' && e.as === 'imp' && !e.effective)).toBe(true)
  })

  it('poisoner death clears poison before the later information ability', async () => {
    const game = attack(base, 4, { poison: 3 })
    const g = await game.run()
    expect(g.seats[2]!.poisonedBy).toBeNull()
    const death = game.events.findIndex(e => e.type === 'night.death')
    expect(game.events[death + 1]).toMatchObject({ type: 'status.changed', seat: 3, status: 'poisoned', on: false })
    expect(game.events.slice(death).some(e => e.type === 'ability.resolved' && e.as === 'empath' && e.effective)).toBe(true)
  })

  it('a role killed before its night step does not wake; empath skips dead neighbours', async () => {
    const game = attack(['chef', 'fortuneteller', 'empath', 'poisoner', 'imp'], 2)
    await game.run()
    const night = game.events.findIndex(e => e.type === 'phase.started' && e.phase === 'night')
    expect(game.events.slice(night).some(e => e.type === 'night.choice' && e.seat === 2)).toBe(false)
    const empath = game.events.slice(night).find(e => e.type === 'ability.resolved' && e.as === 'empath')
    expect(empath).toMatchObject({ result: { number: 1 } })
  })

  it.each([undefined, 2, 1, 5] as const)('mayor bounce to %s uses the single death path', async bounce => {
    const game = attack(['mayor', 'soldier', 'ravenkeeper', 'poisoner', 'imp'], 1, { bounce })
    const g = await game.run()
    const target = bounce ?? 1
    expect(g.seats[target - 1]!.alive).toBe(target === 2)
    expect(game.discretions.some(a => a.discretion === 'D12')).toBe(true)
    if (bounce !== undefined) expect(game.discretions.find(a => a.discretion === 'D13')?.candidates).toMatchObject({ values: [1, 2, 3, 4, 5].map(seat => ({ seats: [seat] })) })
    if (bounce === 5) expect(game.events.at(-1)).toMatchObject({ type: 'game.ended', winner: 'good' })
  })

  it('mayor substitution kills and immediately wakes ravenkeeper, which can select itself', async () => {
    const game = attack(['mayor', 'soldier', 'ravenkeeper', 'poisoner', 'imp'], 1, { bounce: 3, rkTarget: 3 })
    await game.run()
    const death = game.events.findIndex(e => e.type === 'night.death')
    expect(game.events.slice(death, death + 5).map(e => e.type)).toEqual(['night.death', 'contestant.decision', 'night.choice', 'ability.resolved', 'told'])
    expect(tells(game.events, 3).at(-1)).toMatchObject({ kind: 'ability', value: { seats: [3], roles: ['ravenkeeper'] } })
  })

  it('protected or poisoned mayor does not get discretion; poisoned mayor dies', async () => {
    const roles: RoleId[] = ['mayor', 'monk', 'empath', 'poisoner', 'imp']
    for (const protectedMayor of [true, false]) {
      const game = attack(roles, 1, { poison: protectedMayor ? 4 : 1, protect: protectedMayor ? 1 : 5 })
      expect((await game.run()).seats[0]!.alive).toBe(protectedMayor)
      expect(game.discretions.some(a => a.discretion === 'D12')).toBe(false)
    }
  })

  it('monk protection clears at dawn and protects an imp from suicide', async () => {
    const game = attack(base, 5, { protect: 5 })
    const g = await game.run()
    expect(g.seats[4]!.alive).toBe(true)
    expect(g.seats.every(s => s.protectedBy === null)).toBe(true)
    expect(game.events.some(e => e.type === 'role.changed')).toBe(false)
  })

  it.each([5, 8] as const)('scarlet woman succeeds at %i players with no D14 and no same-night attack', async count => {
    const roles: RoleId[] = count === 5 ? ['chef', 'soldier', 'monk', 'scarletwoman', 'imp'] : ['chef', 'soldier', 'monk', 'empath', 'undertaker', 'saint', 'scarletwoman', 'imp']
    const game = attack(roles, count, { protect: 1 })
    const g = await game.run()
    expect(g.seats[count - 2]!.role).toBe('imp')
    expect(game.discretions.some(a => a.discretion === 'D14')).toBe(false)
    expect(game.events.filter(e => e.type === 'night.choice' && e.as === 'imp')).toHaveLength(1)
    const death = game.events.findIndex(e => e.type === 'night.death')
    expect(game.events.slice(death, death + 3).map(e => e.type)).toEqual(['night.death', 'role.changed', 'told'])
  })

  it('starpass chooses only true living minions; poisoner conversion clears poison; singleton skips discretion', async () => {
    const game = attack(base, 5, { protect: 1, poison: 3 })
    const g = await game.run()
    expect(g.seats[3]!.role).toBe('imp')
    expect(g.seats[2]!.poisonedBy).toBeNull()
    expect(game.discretions.some(a => a.discretion === 'D14')).toBe(false)
    expect(game.events.filter(e => e.type === 'night.choice' && e.as === 'imp')).toHaveLength(1)
  })

  it('spy always receives the true current grimoire even when poisoned', async () => {
    const game = scriptedPorts({ roles: ['chef', 'soldier', 'monk', 'empath', 'undertaker', 'saint', 'spy', 'imp'], stop: e => e.type === 'dawn.announced' })
    await game.run()
    const spy = game.events.find(e => e.type === 'told' && e.kind === 'spy_grimoire')
    if (spy?.type !== 'told' || spy.kind !== 'spy_grimoire') throw new Error('missing spy grimoire')
    expect(spy.grimoire).toEqual(foldGrimoire(game.events, spy.seq - 1))
  })
})
