import { describe, expect, it } from 'vitest'
import en from '../i18n/locales/en.json'
import zh from '../i18n/locales/zh.json'
import { renderEvent } from '../shared/event-templates'
import { createRng, runGame } from '../shared/game/rules'
import { ROLES } from '../shared/game/roles'
import type { GameConfig, GameEvent, RoleId, SeatState } from '../shared/types/game'

const config: GameConfig = {
  seatCount: 5,
  seats: [],
  storyteller: null,
  discretions: {
    D1: 'random',
    seating: 'random',
    D2: 'random',
    D3: 'random',
    D4: 'random',
    D5: 'random',
    D6: 'random',
    D7: 'random',
    D8: 'random',
    D10: 'random',
    D11: 'random',
    D12: 'random',
    D13: 'random',
    D14: 'random',
  },
  speechLimit: 1,
  whisperLimit: 0,
  language: 'en',
  seed: 18,
  logVersion: 3,
}

describe('localized terminal game events', () => {
  it.each([
    ['mayor', 'mayor', '镇长', 'Mayor'],
    ['saint', 'saint_executed', '圣徒', 'Saint'],
  ] as const)('localizes %s endgame reasons', async (role, reason, chinese, english) => {
    const roles: RoleId[] = [role, 'soldier', 'slayer', 'scarletwoman', 'imp']
    const seats: SeatState[] = roles.map((character, index) => ({
      seat: index + 1,
      role: character,
      alignment: ROLES[character].alignment,
      alive: role === 'saint' || ![3, 4].includes(index + 1),
      poisoned: false,
      protected: false,
      abilityUsed: false,
      voteUsed: false,
      master: null,
    }))
    const events: GameEvent[] = [
      { seq: 1, type: 'game.created', ...config },
      { seq: 2, type: 'grimoire.set', seats },
    ]
    await runGame({
      config,
      log: events,
      rng: createRng(config.seed),
      commit: (input) => {
        const event = { ...input, seq: events.length + 1 }
        events.push(event)
        return event
      },
      discretion: () => {
        throw new Error('This endgame needs no discretion')
      },
      askContestants: (batch) =>
        Promise.resolve(
          batch.map((request) => {
            if (request.day !== 1) throw new Error('The endgame should finish on day one')
            if (request.tool === 'nominate')
              return {
                reasoning_summary: '',
                nominee:
                  role === 'saint' && request.seat === 2 && request.nominees.includes(1) ? 1 : null,
              }
            if (request.tool === 'vote') return { reasoning_summary: '', raise_hand: true }
            if (request.tool === 'speak')
              return {
                reasoning_summary: '',
                speech: request.kind === 'free' ? null : 'Execute Seat 1',
                slayer_target: null,
                decision: 0,
              }
            throw new Error(`Unexpected request: ${request.tool}`)
          }),
        ),
    })
    const end = events.at(-1)
    expect(end).toMatchObject({ type: 'game.ended', reason })
    if (end?.type !== 'game.ended') throw new Error('Expected a completed game')
    expect(renderEvent(end, 'zh', 'public')).toContain(chinese)
    expect(renderEvent(end, 'en', 'public')).toContain(english)
    expect(zh.games.reasons).toHaveProperty(reason, expect.stringContaining(chinese))
    expect(en.games.reasons).toHaveProperty(reason, expect.stringContaining(english))
  })
})
