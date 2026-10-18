import { ROLE_BY_ID } from './roles'
import { validateSetup } from './setup'
import { MEMO_MAX_LENGTH, TOOL_FOR_REQUEST } from './types'
import type { ContestantRequest, DiscretionAsk, DiscretionCandidates, DiscretionValue, RoleId, Seat, ToolCall, ValidationError } from './types'

type Failure = { ok: false; error: ValidationError }
type ToolResult = { ok: true; call: ToolCall } | Failure
type DecideResult = { ok: true; value: DiscretionValue; reasoning: string } | Failure

function fail(code: ValidationError['code'], field?: string): Failure {
  return { ok: false, error: { code, ...(field === undefined ? {} : { field }) } }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function numbers(value: unknown): value is number[] {
  return Array.isArray(value) && value.every(v => typeof v === 'number' && Number.isInteger(v))
}

function roleIds(value: unknown): value is RoleId[] {
  return Array.isArray(value) && value.every(v => typeof v === 'string' && Object.hasOwn(ROLE_BY_ID, v))
}

function seatError(seats: number[], seatCount: number, field: string): Failure | null {
  return seats.some(s => s < 1 || s > seatCount) ? fail('seat_out_of_range', field) : null
}

export function validateToolCall(req: ContestantRequest, self: Seat, seatCount: number, tool: string, rawArgs: string, ctx: { voteTokenUsed: boolean }): ToolResult {
  if (!tool) return fail('no_tool_call')
  if (tool !== TOOL_FOR_REQUEST[req.kind]) return fail('wrong_tool')
  let args: unknown
  try { args = JSON.parse(rawArgs) } catch { return fail('bad_json') }
  if (!record(args)) return fail('bad_type')
  if (!Object.hasOwn(args, 'reasoning')) return fail('missing_field', 'reasoning')
  if (typeof args.reasoning !== 'string') return fail('bad_type', 'reasoning')
  if (Object.hasOwn(args, 'memo') && typeof args.memo !== 'string') return fail('bad_type', 'memo')
  if (typeof args.memo === 'string' && args.memo.length > MEMO_MAX_LENGTH) return fail('memo_too_long', 'memo')
  const base = { reasoning: args.reasoning, ...(typeof args.memo === 'string' ? { memo: args.memo } : {}) }
  const field = req.kind === 'speak' ? 'speech' : req.kind === 'propose_whisper' ? 'members'
    : req.kind === 'rank_whispers' ? 'ranking' : req.kind === 'nominate' ? 'nominee'
      : req.kind === 'vote' ? 'raise_hand' : 'targets'
  if (!Object.hasOwn(args, field)) return fail('missing_field', field)

  switch (req.kind) {
    case 'speak': {
      if (!Object.hasOwn(args, 'slayer_target')) return fail('missing_field', 'slayer_target')
      if (args.speech !== null && typeof args.speech !== 'string') return fail('bad_type', 'speech')
      if (args.slayer_target !== null && (typeof args.slayer_target !== 'number' || !Number.isInteger(args.slayer_target))) return fail('bad_type', 'slayer_target')
      if (typeof args.slayer_target === 'number') {
        const error = seatError([args.slayer_target], seatCount, 'slayer_target')
        if (error) return error
      }
      const hasSpeech = typeof args.speech === 'string' && args.speech.trim().length > 0
      if ((req.context.where === 'nomination_reason' || req.context.where === 'defense') && !hasSpeech) return fail('speech_required', 'speech')
      if (args.slayer_target !== null && (req.context.where !== 'public' || !hasSpeech)) return fail('slayer_not_allowed', 'slayer_target')
      return { ok: true, call: { tool: 'speak', args: { ...base, speech: args.speech, slayer_target: args.slayer_target } } }
    }
    case 'propose_whisper': {
      if (args.members !== null && !numbers(args.members)) return fail('bad_type', 'members')
      if (args.members !== null) {
        const error = seatError(args.members, seatCount, 'members')
        if (error) return error
        if (args.members.length === 0) return fail('members_empty', 'members')
        if (args.members.includes(self)) return fail('members_include_self', 'members')
        if (new Set(args.members).size !== args.members.length) return fail('members_duplicate', 'members')
        if (args.members.some(s => !req.eligible.includes(s))) return fail('member_unavailable', 'members')
      }
      return { ok: true, call: { tool: 'propose_whisper', args: { ...base, members: args.members } } }
    }
    case 'rank_whispers': {
      if (!numbers(args.ranking)) return fail('bad_type', 'ranking')
      if (new Set(args.ranking).size !== args.ranking.length) return fail('rank_duplicate', 'ranking')
      if (args.ranking.some(id => !req.rooms.some(room => room.room === id))) return fail('rank_unknown_room', 'ranking')
      return { ok: true, call: { tool: 'rank_whispers', args: { ...base, ranking: args.ranking } } }
    }
    case 'nominate': {
      if (args.nominee !== null && (typeof args.nominee !== 'number' || !Number.isInteger(args.nominee))) return fail('bad_type', 'nominee')
      if (args.nominee !== null) {
        const error = seatError([args.nominee], seatCount, 'nominee')
        if (error) return error
        if (!req.eligible.includes(args.nominee)) return fail('nominee_not_eligible', 'nominee')
      }
      return { ok: true, call: { tool: 'nominate', args: { ...base, nominee: args.nominee } } }
    }
    case 'vote': {
      if (typeof args.raise_hand !== 'boolean') return fail('bad_type', 'raise_hand')
      if (args.raise_hand && req.dead && ctx.voteTokenUsed) return fail('vote_token_used', 'raise_hand')
      return { ok: true, call: { tool: 'vote', args: { ...base, raise_hand: args.raise_hand } } }
    }
    case 'night_choice': {
      if (!numbers(args.targets)) return fail('bad_type', 'targets')
      const error = seatError(args.targets, seatCount, 'targets')
      if (error) return error
      if (args.targets.length !== req.count) return fail('target_count', 'targets')
      if (!req.allowSelf && args.targets.includes(self)) return fail('target_self', 'targets')
      return { ok: true, call: { tool: 'night_choice', args: { ...base, targets: args.targets } } }
    }
  }
}

function canonical(value: DiscretionValue): string {
  return JSON.stringify({
    seats: value.seats === undefined ? undefined : [...value.seats].sort((a, b) => a - b),
    roles: value.roles === undefined ? undefined : [...value.roles].sort(),
    number: value.number, answer: value.answer, alignment: value.alignment,
  })
}

export function isCandidate(c: DiscretionCandidates, v: DiscretionValue, seatCount: number): boolean {
  if (!record(v)) return false
  if (v.seats !== undefined && (!numbers(v.seats) || seatError(v.seats, seatCount, 'seats'))) return false
  if (v.roles !== undefined && !roleIds(v.roles)) return false
  if (v.number !== undefined && (typeof v.number !== 'number' || !Number.isFinite(v.number))) return false
  if (v.answer !== undefined && typeof v.answer !== 'boolean') return false
  if (v.alignment !== undefined && v.alignment !== 'good' && v.alignment !== 'evil') return false
  if (Object.keys(v).some(key => !['seats', 'roles', 'number', 'answer', 'alignment'].includes(key))) return false
  if (c.kind === 'list') {
    const candidate = canonical(v)
    return c.values.some(value => canonical(value) === candidate)
  }
  if (Object.keys(v).length !== 1 || !v.roles) return false
  if (c.kind === 'setup') return c.seatCount === seatCount && validateSetup(v.roles, seatCount) === null
  return v.roles.length === seatCount && canonical({ roles: c.roles }) === canonical(v)
}

export function validateDecide(ask: DiscretionAsk, seatCount: number, rawArgs: string): DecideResult {
  let args: unknown
  try { args = JSON.parse(rawArgs) } catch { return fail('bad_json') }
  if (!record(args)) return fail('bad_type')
  if (!Object.hasOwn(args, 'reasoning')) return fail('missing_field', 'reasoning')
  if (typeof args.reasoning !== 'string') return fail('bad_type', 'reasoning')
  const value: DiscretionValue = {}
  if (Object.hasOwn(args, 'seats')) {
    if (!numbers(args.seats)) return fail('bad_type', 'seats')
    const error = seatError(args.seats, seatCount, 'seats')
    if (error) return error
    value.seats = args.seats
  }
  if (Object.hasOwn(args, 'roles')) {
    if (!roleIds(args.roles)) return fail('bad_type', 'roles')
    value.roles = args.roles
  }
  if (Object.hasOwn(args, 'number')) {
    if (typeof args.number !== 'number' || !Number.isFinite(args.number)) return fail('bad_type', 'number')
    value.number = args.number
  }
  if (Object.hasOwn(args, 'answer')) {
    if (typeof args.answer !== 'boolean') return fail('bad_type', 'answer')
    value.answer = args.answer
  }
  if (Object.hasOwn(args, 'alignment')) {
    if (args.alignment !== 'good' && args.alignment !== 'evil') return fail('bad_type', 'alignment')
    value.alignment = args.alignment
  }
  if (!isCandidate(ask.candidates, value, seatCount)) return fail(ask.candidates.kind === 'setup' ? 'invalid_setup' : 'not_a_candidate')
  return { ok: true, value, reasoning: args.reasoning }
}
