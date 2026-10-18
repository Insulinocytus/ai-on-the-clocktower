import { describe, expect, it } from 'vitest'
import { audience, canSee, parseObserver, project } from '../../../shared/rules/audience'
import type { DecisionRecord, EventBody, EventType, Observer } from '../../../shared/rules/types'
import { config, logEvents, setupEvent } from './fixtures'

const decision: DecisionRecord = { params: {}, response: null, model: 'm', usage: null, durationMs: 1, attempt: 1, outcome: { ok: true, call: { tool: 'vote', args: { reasoning: '', raise_hand: true } } } }
const cases = {
  'game.created': { type: 'game.created', config },
  'phase.started': { type: 'phase.started', day: 1, phase: 'dawn' },
  'game.ended': { type: 'game.ended', winner: 'good', reason: 'demon_dead' },
  'game.aborted': { type: 'game.aborted', reason: 'human', detail: '' },
  'contestant.decision': { type: 'contestant.decision', seat: 2, request: { kind: 'vote', nominator: 1, nominee: 2, votes: [], threshold: 3, dead: false }, ...decision },
  'storyteller.decision': { type: 'storyteller.decision', discretion: 'D2', requestSeq: 1, ...decision },
  'discretion.requested': { type: 'discretion.requested', discretion: 'D2', candidates: { kind: 'list', values: [] }, context: { fields: ['roles'] }, source: 'manual' },
  'discretion.resolved': { type: 'discretion.resolved', discretion: 'D2', requestSeq: 1, value: {}, source: 'manual', decisionSeq: null },
  'grimoire.set': setupEvent(),
  'status.changed': { type: 'status.changed', seat: 2, status: 'poisoned', on: true, source: 3 },
  'role.changed': { type: 'role.changed', seat: 2, from: 'poisoner', to: 'imp', alignment: 'evil' },
  'ability.resolved': { type: 'ability.resolved', seat: 2, role: 'chef', as: 'chef', effective: true, result: { number: 0 } },
  'night.death': { type: 'night.death', seat: 2, cause: 'demon' },
  told: { type: 'told', seat: 2, kind: 'role', role: 'chef' },
  'seat.memo.updated': { type: 'seat.memo.updated', seat: 2, text: 'memo' },
  'night.choice': { type: 'night.choice', seat: 2, as: 'imp', targets: [1], decisionSeq: null },
  'dawn.announced': { type: 'dawn.announced', deaths: [2] },
  'whisper.proposed': { type: 'whisper.proposed', round: 1, rooms: [{ members: [2, 3], proposers: [2] }] },
  'whisper.candidates': { type: 'whisper.candidates', round: 1, seat: 2, rooms: [{ room: 1, members: [2, 3] }] },
  'whisper.ranked': { type: 'whisper.ranked', round: 1, seat: 2, ranking: [1] },
  'whisper.room.opened': { type: 'whisper.room.opened', round: 1, room: 'a', members: [2, 3] },
  'whisper.speech': { type: 'whisper.speech', round: 1, room: 'a', members: [2, 3], seat: 2, text: 'hi', decisionSeq: 1 },
  'whisper.room.closed': { type: 'whisper.room.closed', round: 1, room: 'a', members: [2, 3] },
  'public.speech': { type: 'public.speech', seat: 2, text: 'hi', kind: 'free', decisionSeq: 1 },
  'slayer.resolved': { type: 'slayer.resolved', seat: 2, target: 3, died: false },
  nomination: { type: 'nomination', nominator: 2, nominee: 3 },
  'virgin.triggered': { type: 'virgin.triggered', nominator: 2 },
  vote: { type: 'vote', seat: 2, raised: true, tokenUsed: false, decisionSeq: 1 },
  'vote.tallied': { type: 'vote.tallied', nominee: 3, votes: 3, threshold: 3, aboutToDie: true },
  execution: { type: 'execution', seat: 2 },
} satisfies Record<EventType, EventBody>

const levels: Record<EventType, 'public' | 'seats' | 'storyteller' | 'spectator'> = {
  'game.created': 'spectator', 'phase.started': 'public', 'game.ended': 'public', 'game.aborted': 'spectator',
  'contestant.decision': 'spectator', 'storyteller.decision': 'storyteller', 'discretion.requested': 'storyteller', 'discretion.resolved': 'storyteller',
  'grimoire.set': 'storyteller', 'status.changed': 'storyteller', 'role.changed': 'storyteller', 'ability.resolved': 'storyteller', 'night.death': 'storyteller',
  told: 'seats', 'seat.memo.updated': 'seats', 'night.choice': 'seats', 'dawn.announced': 'public',
  'whisper.proposed': 'spectator', 'whisper.candidates': 'seats', 'whisper.ranked': 'spectator', 'whisper.room.opened': 'public',
  'whisper.speech': 'seats', 'whisper.room.closed': 'seats', 'public.speech': 'public', 'slayer.resolved': 'public',
  nomination: 'public', 'virgin.triggered': 'public', vote: 'public', 'vote.tallied': 'public', execution: 'public',
}

const observers: Observer[] = [{ kind: 'public' }, { kind: 'seat', seat: 2 }, { kind: 'seat', seat: 1 }, { kind: 'storyteller' }, { kind: 'spectator' }]
describe('audience isolation', () => {
  for (const e of Object.values(cases)) {
    const level = levels[e.type]
    it(`${e.type}: every observer cell`, () => {
      expect(audience(e).level).toBe(level)
      const expected = [level === 'public', level === 'public' || level === 'seats', level === 'public', level !== 'spectator', true]
      expect(observers.map(o => canSee(e, o))).toEqual(expected)
      for (const [i, observer] of observers.entries()) {
        expect(project(logEvents([e]), observer)).toHaveLength(expected[i] ? 1 : 0)
      }
    })
  }
  it('defaults unknown event types to spectator only', () => {
    const unknown = { type: 'future.event', seat: 2 } as unknown as EventBody
    expect(observers.map(o => canSee(unknown, o))).toEqual([false, false, false, false, true])
  })
  it('shares whispers with all members, not only the speaker', () => {
    expect(canSee(cases['whisper.speech'], { kind: 'seat', seat: 3 })).toBe(true)
    expect(canSee(cases['whisper.room.closed'], { kind: 'seat', seat: 3 })).toBe(true)
  })
  it('parses only valid observer strings', () => {
    for (const kind of ['spectator', 'storyteller', 'public'] as const) expect(parseObserver(kind)).toEqual({ kind })
    expect(parseObserver('seat:15')).toEqual({ kind: 'seat', seat: 15 })
    for (const s of ['seat:0', 'seat:-1', 'seat:1.5', 'seat:01', 'seat:16', 'seat:NaN', ' spectator', 'seat:9007199254740992', '']) expect(parseObserver(s)).toBeNull()
  })
})
