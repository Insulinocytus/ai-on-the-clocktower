import { describe, expect, it } from 'vitest'
import type { GameEvent, RoleId } from '../../../shared/rules/types'
import { choice, nominate, passNomination, say, scriptedPorts, vote } from './helpers'

const dawn2 = (e: GameEvent, events: GameEvent[]) => e.type === 'dawn.announced' && events.some(x => x.type === 'phase.started' && x.day === 2)

describe('information probes and immunity boundaries', () => {
  it.each(['spy', 'recluse'] as const)('Undertaker and Ravenkeeper see the fixed registered role of %s', async detected => {
    for (const ability of ['undertaker', 'ravenkeeper'] as const) {
      const game = scriptedPorts({ roles: [ability, 'chef', 'empath', detected, 'poisoner', 'imp'], stop: dawn2,
        decide: ask => ask.discretion === 'D10' ? { alignment: 'good', roles: ['saint'] } : ask.discretion === 'D11' ? { alignment: 'evil', roles: ['baron'] } : undefined,
        answer: ({ seat, request }) => request.kind === 'nominate' ? ability === 'undertaker' && seat === 2 ? nominate(4) : passNomination : request.kind === 'vote' ? vote(true) : request.kind === 'night_choice' ? choice(request.as === 'ravenkeeper' ? 4 : request.as === 'imp' ? ability === 'ravenkeeper' ? 1 : 3 : 5) : undefined,
      })
      await game.run()
      expect(game.events.find(e => e.type === 'told' && e.kind === 'ability' && e.seat === 1)).toMatchObject({ value: { roles: [detected === 'spy' ? 'saint' : 'baron'] } })
      expect(game.events.find(e => e.type === 'ability.resolved' && e.seat === 1)).toMatchObject({ result: { roles: [detected] }, told: { reason: 'register', deviates: true } })
    }
  })

  it('poisoned Spy still sees true grimoire, but registers as its true role/alignment', async () => {
    const game = scriptedPorts({ roles: ['chef', 'empath', 'fortuneteller', 'soldier', 'monk', 'saint', 'poisoner', 'spy', 'imp'], stop: e => e.type === 'dawn.announced',
      decide: ask => ask.discretion === 'D10' ? { alignment: 'good', roles: ['saint'] } : undefined,
      answer: ({ request }) => request.kind === 'night_choice' ? request.as === 'poisoner' ? choice(8) : choice(8, 9) : undefined,
    })
    await game.run()
    const spy = game.events.find(e => e.type === 'told' && e.kind === 'spy_grimoire')
    expect(spy).toMatchObject({ grimoire: { seats: expect.arrayContaining([expect.objectContaining({ seat: 8, role: 'spy', poisonedBy: 7 })]) } })
    const chef = game.events.find(e => e.type === 'ability.resolved' && e.as === 'chef')
    expect(chef).toMatchObject({ result: { number: 2 }, told: { value: { number: 2 }, deviates: false } })
  })

  it('FT recognizes a dead original demon after Scarlet Woman takes over', async () => {
    const game = scriptedPorts({ roles: ['fortuneteller', 'chef', 'soldier', 'scarletwoman', 'imp'], stop: dawn2,
      decide: ask => ask.discretion === 'D3' ? { seats: [2] } : undefined,
      answer: ({ seat, request }) => request.kind === 'nominate' ? seat === 2 ? nominate(5) : passNomination : request.kind === 'vote' ? vote(true) : request.kind === 'night_choice' ? request.as === 'fortuneteller' ? choice(5, 3) : choice(3) : undefined,
    })
    await game.run()
    expect(game.events.filter(e => e.type === 'ability.resolved' && e.as === 'fortuneteller')).toEqual([expect.objectContaining({ result: { answer: true } }), expect.objectContaining({ result: { answer: true } })])
  })

  it('FT sees Scarlet Woman as non-demon before conversion, and as demon afterwards', async () => {
    const game = scriptedPorts({ roles: ['fortuneteller', 'chef', 'soldier', 'scarletwoman', 'imp'], stop: dawn2,
      decide: ask => ask.discretion === 'D3' ? { seats: [2] } : undefined,
      answer: ({ seat, request }) => request.kind === 'nominate' ? seat === 2 ? nominate(5) : passNomination : request.kind === 'vote' ? vote(true) : request.kind === 'night_choice' ? request.as === 'fortuneteller' ? choice(4, 3) : choice(3) : undefined,
    })
    await game.run()
    expect(game.events.filter(e => e.type === 'ability.resolved' && e.as === 'fortuneteller').map(e => e.type === 'ability.resolved' && e.result)).toEqual([{ answer: false }, { answer: true }])
  })

  it('Slayer cannot kill an unconverted Scarlet Woman, and a second shot cannot use the ability twice', async () => {
    const game = scriptedPorts({ roles: ['slayer', 'chef', 'soldier', 'scarletwoman', 'imp'], maxSpeeches: 2,
      stop: e => e.type === 'phase.started' && e.phase === 'nomination',
      answer: ({ seat, request }, _g, events) => request.kind === 'speak' ? seat === 1 ? say('Shoot', events.some(e => e.type === 'slayer.resolved') ? 5 : 4) : seat === 2 ? say('Continue') : say(null) : undefined,
    })
    const g = await game.run()
    expect(game.events.filter(e => e.type === 'slayer.resolved').map(e => e.type === 'slayer.resolved' && e.died)).toEqual([false, false])
    expect(g.seats[4]!.alive).toBe(true)
  })

  it('a dead Slayer can make a public fake shot but cannot kill', async () => {
    const game = scriptedPorts({ roles: ['slayer', 'chef', 'empath', 'poisoner', 'imp'], stop: e => e.type === 'phase.started' && e.phase === 'nomination' && e.day === 2,
      answer: ({ seat, request }, g) => request.kind === 'nominate' ? passNomination : request.kind === 'night_choice' ? choice(request.as === 'imp' ? 1 : 4) : request.kind === 'speak' ? seat === 1 && g.day === 2 ? say('Shoot', 5) : say(null) : undefined,
    })
    const g = await game.run()
    expect(g.seats[0]!.alive).toBe(false)
    expect(g.seats[4]!.alive).toBe(true)
    expect(game.events.find(e => e.type === 'slayer.resolved')).toMatchObject({ died: false })
  })

  it('execution ignores Soldier immunity and Monk protection', async () => {
    const game = scriptedPorts({ roles: ['soldier', 'monk', 'empath', 'poisoner', 'imp'], stop: e => e.type === 'phase.started' && e.phase === 'night',
      answer: ({ seat, request }) => request.kind === 'nominate' ? seat === 3 ? nominate(1) : passNomination : request.kind === 'vote' ? vote(true) : request.kind === 'night_choice' ? choice(4) : undefined,
    })
    expect((await game.run()).seats[0]!.alive).toBe(false)
  })

  it('Mayoral bounce to a previously dead seat or Monk-protected seat has no death', async () => {
    for (const protectedTarget of [false, true]) {
      const roles: RoleId[] = ['mayor', 'monk', 'empath', 'poisoner', 'imp']
      const game = scriptedPorts({ roles, stop: untilThirdDawn,
        decide: ask => ask.discretion === 'D12' ? { answer: true } : ask.discretion === 'D13' ? { seats: [3] } : undefined,
        answer: ({ request }, g) => request.kind === 'nominate' ? passNomination : request.kind === 'night_choice' ? choice(request.as === 'imp' ? g.day === 2 && !protectedTarget ? 3 : 1 : request.as === 'monk' ? protectedTarget ? 3 : 4 : 4) : undefined,
      })
      await game.run()
      expect(game.events.at(-1)).toMatchObject({ deaths: [] })
    }
  })
})

function untilThirdDawn(event: GameEvent, events: GameEvent[]): boolean {
  return event.type === 'dawn.announced' && events.some(e => e.type === 'phase.started' && e.day === 3)
}
