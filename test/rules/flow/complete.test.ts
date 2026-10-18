import { describe, expect, it } from 'vitest'
import { scriptedPorts } from './helpers'
import { GameAbortedError } from '../../../shared/rules/types'

describe('complete seeded games', () => {
  for (let count = 5; count <= 15; count++) {
    it.each(['alpha', 'beta', 'gamma'])(`${count} seats with seed %s reaches a winner`, async seed => {
      const game = scriptedPorts({ seed }, count)
      const g = await game.run()
      expect(game.events.at(-1)).toMatchObject({ type: 'game.ended' })
      expect(g.seats).toHaveLength(count)
      expect(game.events.filter(e => e.type === 'game.ended')).toHaveLength(1)
      expect(game.events.every((e, i) => e.seq === i + 1)).toBe(true)
    })
  }
  it('propagates runtime abortion without manufacturing a winner', async () => {
    const game = scriptedPorts({ roles: ['chef', 'empath', 'soldier', 'poisoner', 'imp'] })
    game.ports.askContestants = async () => { throw new GameAbortedError('cancelled') }
    await expect(game.run()).rejects.toThrow(GameAbortedError)
    expect(game.events.some(e => e.type === 'game.ended')).toBe(false)
  })
})
