import { describe, expect, it } from 'vitest'
import { createRng, runGame } from '../shared/game/rules'
import { buildContestantPrompt } from '../shared/prompts/contestant'
import type {
  ContestantChoice,
  ContestantRequest,
  GameConfig,
  GameEvent,
  Ports,
  RoleId,
} from '../shared/types/game'

const CONFIG: GameConfig = {
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
  logVersion: 2,
  promptVersion: 2,
}

function pass(request: ContestantRequest): ContestantChoice {
  switch (request.tool) {
    case 'night_choice':
      return {
        reasoning: 'Choose',
        targets: request.targets.slice(0, request.role === 'fortuneteller' ? 2 : 1),
      }
    case 'speak':
      return { reasoning: 'Pass', speech: null, slayer_target: null }
    case 'nominate':
      return { reasoning: 'Pass', nominee: null }
    case 'vote':
      return { reasoning: 'Pass', raise_hand: false }
    case 'propose_whisper':
      return { reasoning: 'Pass', members: null }
    case 'rank_whispers':
      return { reasoning: 'Accept', ranking: request.rooms.map((room) => room.id) }
  }
}

async function script(
  roles: RoleId[],
  options: {
    config?: Partial<GameConfig>
    ask: (request: ContestantRequest, ports: Ports) => ContestantChoice
    discretion?: Ports['discretion']
  },
) {
  const config = { ...CONFIG, ...options.config, seatCount: roles.length }
  const events: GameEvent[] = [{ seq: 1, type: 'game.created', ...config }]
  const ports: Ports = {
    config,
    log: events,
    rng: createRng(config.seed),
    commit(input) {
      const event = { ...input, seq: events.length + 1 }
      events.push(event)
      return event
    },
    async discretion(id, candidates, context, requestSeq) {
      if (options.discretion) return options.discretion(id, candidates, context, requestSeq)
      if (id === 'D1') return { choice: roles }
      if (!Array.isArray(candidates) || candidates[0] === undefined)
        throw new Error(`Missing scripted ${id} choice`)
      return { choice: candidates[0] }
    },
    askContestants: (batch) => Promise.resolve(batch.map((request) => options.ask(request, ports))),
  }
  return { state: await runGame(ports), events }
}

describe('prompts at the scripted game seam', () => {
  it.each(['zh', 'en'] as const)(
    'offers all 15 Slayer targets in the %s speak request',
    async (language) => {
      const roles: RoleId[] = [
        'chef',
        'empath',
        'fortuneteller',
        'undertaker',
        'monk',
        'virgin',
        'slayer',
        'soldier',
        'mayor',
        'butler',
        'saint',
        'poisoner',
        'spy',
        'scarletwoman',
        'imp',
      ]
      let user = ''
      const { state } = await script(roles, {
        config: { language },
        ask(request, ports) {
          if (request.tool === 'speak' && request.kind === 'free' && !user) {
            user = buildContestantPrompt({ events: ports.log, seat: request.seat, language, request })
              .messages[1].content
            void ports.commit({ type: 'game.aborted', reason: 'human' })
          }
          return pass(request)
        },
      })
      expect(state.aborted).toBe(true)
      expect(user).toContain(language === 'zh' ? '目标座位号（1–15）' : 'seat number (1–15)')
      expect(user).not.toContain('1–5')
    },
  )
})
