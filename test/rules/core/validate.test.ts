import { describe, expect, it } from 'vitest'
import { isCandidate, validateDecide, validateToolCall } from '../../../shared/rules/validate'
import type { ContestantRequest, DiscretionAsk, ValidationCode } from '../../../shared/rules/types'
import { legalRoles } from './fixtures'

const speak: ContestantRequest = { kind: 'speak', context: { where: 'public' }, remaining: 10 }
const whisper: ContestantRequest = { kind: 'propose_whisper', round: 1, remaining: 2, eligible: [2, 3] }
const ranking: ContestantRequest = { kind: 'rank_whispers', round: 1, rooms: [{ room: 1, members: [1, 2] }, { room: 2, members: [1, 3] }] }
const nominate: ContestantRequest = { kind: 'nominate', eligible: [2, 3] }
const vote: ContestantRequest = { kind: 'vote', nominator: 2, nominee: 3, votes: [], threshold: 3, dead: true }
const night: ContestantRequest = { kind: 'night_choice', as: 'monk', count: 1, allowSelf: false }
const base = { reasoning: 'Private reasoning' }
const invalid: [ContestantRequest, Record<string, unknown>, ValidationCode][] = [
  [speak, { speech: null, slayer_target: null }, 'missing_field'],
  [speak, { ...base, speech: null }, 'missing_field'],
  [speak, { ...base, speech: 42, slayer_target: null }, 'bad_type'],
  [speak, { ...base, speech: null, slayer_target: 1.5 }, 'bad_type'],
  [speak, { ...base, speech: null, slayer_target: 6 }, 'seat_out_of_range'],
  [speak, { ...base, speech: null, slayer_target: 2 }, 'slayer_not_allowed'],
  [{ ...speak, context: { where: 'whisper', round: 1, room: 'a', members: [1, 2] } }, { ...base, speech: 'bang', slayer_target: 2 }, 'slayer_not_allowed'],
  [{ ...speak, context: { where: 'nomination_reason', nominee: 2 } }, { ...base, speech: null, slayer_target: null }, 'speech_required'],
  [{ ...speak, context: { where: 'defense', nominator: 2 } }, { ...base, speech: '  ', slayer_target: null }, 'speech_required'],
  [whisper, { ...base, members: [] }, 'members_empty'],
  [whisper, { ...base, members: [1] }, 'members_include_self'],
  [whisper, { ...base, members: [2, 2] }, 'members_duplicate'],
  [whisper, { ...base, members: [4] }, 'member_unavailable'],
  [whisper, { ...base, members: [0] }, 'seat_out_of_range'],
  [whisper, { ...base, members: ['2'] }, 'bad_type'],
  [ranking, { ...base, ranking: [1, 1] }, 'rank_duplicate'],
  [ranking, { ...base, ranking: [3] }, 'rank_unknown_room'],
  [ranking, { ...base, ranking: [1.5] }, 'bad_type'],
  [nominate, { ...base, nominee: 4 }, 'nominee_not_eligible'],
  [nominate, { ...base, nominee: 0 }, 'seat_out_of_range'],
  [nominate, { ...base, nominee: '2' }, 'bad_type'],
  [vote, { ...base, raise_hand: true }, 'vote_token_used'],
  [vote, { ...base, raise_hand: 1 }, 'bad_type'],
  [night, { ...base, targets: [] }, 'target_count'],
  [night, { ...base, targets: [1] }, 'target_self'],
  [night, { ...base, targets: [6] }, 'seat_out_of_range'],
  [night, { ...base, targets: [2.2] }, 'bad_type'],
  [vote, { ...base, raise_hand: false, memo: 'a'.repeat(2001) }, 'memo_too_long'],
  [vote, { ...base, raise_hand: false, memo: null }, 'bad_type'],
  [vote, { reasoning: 3, raise_hand: false }, 'bad_type'],
]

describe('contestant tool boundary', () => {
  for (const [i, [req, args, code]] of invalid.entries()) {
    it(`rejects invalid ${req.kind} case ${i} with ${code}`, () => {
      expect(validateToolCall(req, 1, 5, req.kind, JSON.stringify(args), { voteTokenUsed: true })).toMatchObject({ ok: false, error: { code } })
    })
  }
  it('rejects malformed JSON, non-object args, absent tool calls and wrong tools', () => {
    expect(validateToolCall(vote, 1, 5, 'vote', '{', { voteTokenUsed: false })).toMatchObject({ ok: false, error: { code: 'bad_json' } })
    for (const args of ['null', '[]', 'false', '42']) expect(validateToolCall(vote, 1, 5, 'vote', args, { voteTokenUsed: false })).toMatchObject({ ok: false, error: { code: 'bad_type' } })
    expect(validateToolCall(vote, 1, 5, '', '{}', { voteTokenUsed: false })).toMatchObject({ ok: false, error: { code: 'no_tool_call' } })
    expect(validateToolCall(vote, 1, 5, 'speak', '{}', { voteTokenUsed: false })).toMatchObject({ ok: false, error: { code: 'wrong_tool' } })
  })
  it('requires the tool-specific fields for each request', () => {
    for (const req of [speak, whisper, ranking, nominate, vote, night]) {
      expect(validateToolCall(req, 1, 5, req.kind, JSON.stringify(base), { voteTokenUsed: false })).toMatchObject({ ok: false, error: { code: 'missing_field' } })
    }
  })
  it('accepts pass, partial rankings, legal choices, memo boundaries and ignored unknown fields', () => {
    const valid: [ContestantRequest, Record<string, unknown>][] = [
      [speak, { speech: null, slayer_target: null }],
      [speak, { speech: 'bang', slayer_target: 1 }],
      [whisper, { members: null }], [whisper, { members: [2, 3] }],
      [ranking, { ranking: [] }], [ranking, { ranking: [2] }], [ranking, { ranking: [2, 1] }],
      [nominate, { nominee: null }], [nominate, { nominee: 2 }], [vote, { raise_hand: false }],
      [night, { targets: [5] }],
      [{ kind: 'night_choice', as: 'fortuneteller', count: 2, allowSelf: true }, { targets: [1, 2] }],
    ]
    for (const [req, fields] of valid) {
      const args = { ...base, ...fields, memo: 'm'.repeat(2000) }
      expect(validateToolCall(req, 1, 5, req.kind, JSON.stringify({ ...args, extra: 'ignored' }), { voteTokenUsed: false })).toEqual({ ok: true, call: { tool: req.kind, args } })
    }
  })
  it('only forbids a raised vote when both dead and token already used; does not enforce Butler', () => {
    expect(validateToolCall({ ...vote, dead: false }, 1, 5, 'vote', JSON.stringify({ ...base, raise_hand: true }), { voteTokenUsed: true }).ok).toBe(true)
    expect(validateToolCall(vote, 1, 5, 'vote', JSON.stringify({ ...base, raise_hand: true }), { voteTokenUsed: false }).ok).toBe(true)
  })
})

const ask: DiscretionAsk = { discretion: 'D4', candidates: { kind: 'list', values: [{ seats: [2, 3], roles: ['chef'] }] }, context: { fields: ['seats', 'roles'] } }
describe('storyteller candidate boundary', () => {
  it('canonically compares unordered lists without mutating their values', () => {
    const value = { roles: ['chef' as const], seats: [3, 2] }
    expect(isCandidate(ask.candidates, value, 5)).toBe(true)
    expect(value.seats).toEqual([3, 2])
    expect(isCandidate({ kind: 'list', values: [{ roles: ['monk', 'chef', 'mayor'] }] }, { roles: ['mayor', 'monk', 'chef'] }, 5)).toBe(true)
    expect(isCandidate(ask.candidates, { ...value, answer: true }, 5)).toBe(false)
    expect(isCandidate(ask.candidates, { seats: [2, 2], roles: ['chef'] }, 5)).toBe(false)
    expect(isCandidate(ask.candidates, { seats: [0, 2], roles: ['chef'] }, 5)).toBe(false)
    expect(isCandidate({ kind: 'list', values: [{ number: 0 }] }, { answer: false }, 5)).toBe(false)
  })
  it('validates D1 as a setup and seating as an exact permutation while preserving submitted order', () => {
    const setupAsk: DiscretionAsk = { discretion: 'D1', candidates: { kind: 'setup', seatCount: 5 }, context: { fields: ['roles'] } }
    const roles = [...legalRoles].reverse()
    expect(validateDecide(setupAsk, 5, JSON.stringify({ ...base, roles }))).toEqual({ ok: true, value: { roles }, reasoning: base.reasoning })
    expect(validateDecide(setupAsk, 5, JSON.stringify({ ...base, roles: ['imp'] }))).toMatchObject({ ok: false, error: { code: 'invalid_setup' } })
    const seating: DiscretionAsk = { discretion: 'seating', candidates: { kind: 'seating', roles: legalRoles }, context: { fields: ['roles'] } }
    expect(validateDecide(seating, 5, JSON.stringify({ ...base, roles })).ok).toBe(true)
    expect(validateDecide(seating, 5, JSON.stringify({ ...base, roles: ['chef', 'chef', 'mayor', 'poisoner', 'imp'] }))).toMatchObject({ ok: false, error: { code: 'not_a_candidate' } })
  })
  it('parses decide shape and rejects non-candidates with structured errors', () => {
    const invalidArgs: [string, ValidationCode][] = [
      ['{', 'bad_json'], ['null', 'bad_type'], ['{}', 'missing_field'],
      [JSON.stringify({ reasoning: null }), 'bad_type'],
      [JSON.stringify({ ...base, seats: [6] }), 'seat_out_of_range'],
      [JSON.stringify({ ...base, seats: ['2'] }), 'bad_type'],
      [JSON.stringify({ ...base, roles: ['unknown'] }), 'bad_type'],
      [JSON.stringify({ ...base, number: '1' }), 'bad_type'],
      [JSON.stringify({ ...base, answer: null }), 'bad_type'],
      [JSON.stringify({ ...base, alignment: 'neutral' }), 'bad_type'],
      [JSON.stringify({ ...base, seats: [1, 2], roles: ['chef'] }), 'not_a_candidate'],
    ]
    for (const [raw, code] of invalidArgs) expect(validateDecide(ask, 5, raw)).toMatchObject({ ok: false, error: { code } })
    expect(validateDecide(ask, 5, JSON.stringify({ ...base, seats: [3, 2], roles: ['chef'], unused: 123 }))).toEqual({ ok: true, reasoning: base.reasoning, value: { seats: [3, 2], roles: ['chef'] } })
    const booleanAsk: DiscretionAsk = { discretion: 'D12', candidates: { kind: 'list', values: [{ answer: true }, { answer: false }] }, context: { fields: ['answer'] } }
    expect(validateDecide(booleanAsk, 5, JSON.stringify({ ...base, answer: false })).ok).toBe(true)
  })
})
