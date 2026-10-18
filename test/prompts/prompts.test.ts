import { describe, expect, it } from 'vitest'
import { buildContestantMessages, buildStorytellerMessages, buildTestCallMessages, contestantTools, storytellerTools, validationMessage, PROMPT_VERSION, SPEECH_DAYS_KEPT } from '../../server/prompts'
import { DISCRETION_IDS, LOG_VERSION } from '../../shared/rules/types'
import type { ContestantRequest, DiscretionAsk, DiscretionValue, EventBody, GameConfig, GameEvent, Lang, ValidationCode } from '../../shared/rules/types'
import { ROLES } from '../../shared/rules/roles'
import { renderEvent } from '../../shared/templates'

function config(language: Lang = 'en', seatCount = 8): GameConfig {
  const preset = { presetId: 'secret-preset-id', name: 'secret-preset-name', model: 'secret-model-name', providerId: 'secret-provider-id', forceToolChoice: true, extraBody: {} }
  return { seatCount, seats: Array.from({ length: seatCount }, () => ({ ...preset })), storyteller: { ...preset }, sources: Object.fromEntries(DISCRETION_IDS.map(d => [d, 'storyteller'])) as GameConfig['sources'], language, maxSpeeches: 10, whisperRooms: 3, seed: 'secret-seed', logVersion: LOG_VERSION, promptVersion: PROMPT_VERSION }
}

function log(...events: EventBody[]): GameEvent[] {
  return events.map((event, i) => ({ ...event, seq: i + 1 }))
}

const speak: ContestantRequest = { kind: 'speak', context: { where: 'public' }, remaining: 9 }
const ask: DiscretionAsk = { discretion: 'D12', candidates: { kind: 'list', values: [{ answer: false }, { answer: true }] }, context: { subject: 5, fields: ['answer'], truth: { answer: false } } }

function user(events: readonly GameEvent[], language: Lang = 'en', request: ContestantRequest = speak): string {
  return buildContestantMessages({ config: config(language), seat: 1, events, request })[1]!.content
}

for (const lang of ['zh', 'en'] as const) describe(`prompts (${lang})`, () => {
  it('uses a single system and user message, with identical systems across seats and all official abilities', () => {
    const events = log({ type: 'told', seat: 1, kind: 'role', role: 'washerwoman' }, { type: 'told', seat: 2, kind: 'role', role: 'imp' })
    const a = buildContestantMessages({ config: config(lang), seat: 1, events, request: speak })
    const b = buildContestantMessages({ config: config(lang), seat: 2, events, request: speak })
    expect(a.map(m => m.role)).toEqual(['system', 'user'])
    expect(a[0]).toEqual(b[0])
    for (const role of ROLES) expect(a[0]!.content).toContain(role.ability[lang])
    expect(a[1]!.content).not.toEqual(b[1]!.content)
  })

  it('keeps the prefix identical as requests and memos change, and never rewrites old lines within a day', () => {
    const events = log(
      { type: 'told', seat: 1, kind: 'role', role: 'empath' },
      { type: 'phase.started', day: 1, phase: 'public' },
      { type: 'public.speech', seat: 2, kind: 'free', text: 'FIRST-DAY-LINE', decisionSeq: 0 },
      { type: 'phase.started', day: 2, phase: 'public' },
      { type: 'public.speech', seat: 3, kind: 'free', text: 'SECOND-DAY-LINE', decisionSeq: 0 },
    )
    const heading = lang === 'zh' ? '# 你的备忘录' : '# Your memo'
    const first = user(events, lang).split(heading)[0]!
    const second = user([...events, { type: 'seat.memo.updated', seat: 1, text: 'UPDATED-MEMO', seq: 6 }], lang, { kind: 'nominate', eligible: [3, 4] }).split(heading)[0]!
    expect(first).toBe(second)
    const third = user([...events, { type: 'public.speech', seat: 4, kind: 'free', text: 'APPENDED-LINE', decisionSeq: 0, seq: 6 }], lang).split(heading)[0]!
    expect(third.startsWith(first.trimEnd())).toBe(true)
    const next = user([...events, { type: 'phase.started', day: 3, phase: 'night', seq: 6 }], lang).split(heading)[0]!
    expect(next.startsWith(first.trimEnd())).toBe(false)
    expect(next).not.toContain('FIRST-DAY-LINE')
    expect(next).toContain('SECOND-DAY-LINE')
  })

  it('drops only public and whisper speeches older than the preceding day', () => {
    const events = log(
      { type: 'phase.started', day: 1, phase: 'whisper' },
      { type: 'whisper.room.opened', room: 'OLD-ROOM', round: 1, members: [1, 2] },
      { type: 'whisper.speech', room: 'OLD-ROOM', round: 1, members: [1, 2], seat: 2, text: 'OLD-WHISPER', decisionSeq: 0 },
      { type: 'public.speech', seat: 2, kind: 'free', text: 'OLD-PUBLIC', decisionSeq: 0 },
      { type: 'told', seat: 1, kind: 'ability', ability: 'empath', value: { number: 2 } },
      { type: 'nomination', nominator: 2, nominee: 3 },
      { type: 'vote', seat: 4, raised: true, tokenUsed: false, decisionSeq: null },
      { type: 'phase.started', day: 2, phase: 'public' },
      { type: 'public.speech', seat: 3, kind: 'free', text: 'PREVIOUS-PUBLIC', decisionSeq: 0 },
      { type: 'phase.started', day: 3, phase: 'whisper' },
      { type: 'whisper.speech', room: 'CURRENT-ROOM', round: 1, members: [1, 3], seat: 3, text: 'CURRENT-WHISPER', decisionSeq: 0 },
    )
    const result = user(events, lang)
    expect(SPEECH_DAYS_KEPT).toBe(2)
    expect(result).not.toContain('OLD-WHISPER')
    expect(result).not.toContain('OLD-PUBLIC')
    expect(result).toContain('PREVIOUS-PUBLIC')
    expect(result).toContain('CURRENT-WHISPER')
    for (const index of [0, 1, 4, 5, 6]) expect(result).toContain(renderEvent(events[index]!, { lang, person: 'seat', self: 1 }))
  })

  it('does not send model identities, rejected contestant decisions or private proposals to either model', () => {
    const cfg = config(lang)
    const events = log(
      { type: 'game.created', config: cfg },
      { type: 'phase.started', day: 1, phase: 'public' },
      { type: 'whisper.proposed', round: 1, rooms: [{ members: [1, 2], proposers: [1] }] },
      { type: 'whisper.ranked', seat: 1, round: 1, ranking: [999] },
      { type: 'contestant.decision', seat: 1, request: speak, params: { hidden: 'SECRET-LOSING-TEXT' }, response: 'SECRET-CONTESTANT-REASON', model: cfg.seats[0]!.model, usage: null, durationMs: 1, attempt: 1, outcome: { ok: true, call: { tool: 'speak', args: { reasoning: 'SECRET-CONTESTANT-REASON', speech: 'SECRET-LOSING-TEXT' } } } },
      { type: 'storyteller.decision', discretion: 'D12', requestSeq: 0, params: { model: 'secret-model-name' }, response: { model: 'secret-model-name' }, model: 'secret-model-name', usage: null, durationMs: 1, attempt: 1, outcome: { ok: true, call: { tool: 'decide', args: { reasoning: 'MY-PREVIOUS-REASON', answer: true, model: 'secret-model-name' } } } },
    )
    const contestant = buildContestantMessages({ config: cfg, seat: 1, events, request: speak })
    const storyteller = buildStorytellerMessages({ config: cfg, events, ask })
    const text = JSON.stringify([...contestant, ...storyteller])
    for (const hidden of ['secret-model-name', 'secret-preset-name', 'secret-provider-id', 'secret-preset-id', 'secret-seed', 'SECRET-CONTESTANT-REASON', 'SECRET-LOSING-TEXT']) expect(text).not.toContain(hidden)
    expect(JSON.stringify(storyteller)).toContain('MY-PREVIOUS-REASON')
    expect(JSON.stringify(contestant)).not.toContain('MY-PREVIOUS-REASON')
  })

  it('uses the latest told identity and latest memo without putting memos in the timeline', () => {
    const events = log(
      { type: 'told', seat: 1, kind: 'role', role: 'poisoner' },
      { type: 'seat.memo.updated', seat: 1, text: 'OLD-MEMO' },
      { type: 'told', seat: 1, kind: 'became_imp' },
      { type: 'seat.memo.updated', seat: 1, text: 'NEW-MEMO' },
      { type: 'seat.memo.updated', seat: 2, text: 'OTHER-MEMO' },
    )
    const text = user(events, lang)
    const memoHeading = lang === 'zh' ? '# 你的备忘录' : '# Your memo'
    expect(text.split(lang === 'zh' ? '# 时间线' : '# Timeline')[0]).toContain(ROLES.find(r => r.id === 'imp')!.name[lang])
    expect(text).not.toContain('OLD-MEMO')
    expect(text).not.toContain('OTHER-MEMO')
    expect(text.split(memoHeading)[0]).not.toContain('NEW-MEMO')
    expect(text.split('NEW-MEMO')).toHaveLength(2)
    const st = JSON.stringify(buildStorytellerMessages({ config: config(lang), events, ask }))
    expect(st).toContain('NEW-MEMO')
    expect(st).toContain('OTHER-MEMO')
    expect(st).not.toContain('OLD-MEMO')
  })

  it('appends retry feedback after the original request, preserving raw argument bytes', () => {
    const input = { config: config(lang), seat: 1, events: log({ type: 'phase.started', day: 1, phase: 'public' }), request: speak }
    const retry = { attempt: 1, call: { tool: 'speak', args: '{  "speech":null,\n"unexpected":true }' }, error: { code: 'unknown_field' as const, field: 'unexpected' } }
    for (const [original, retried] of [
      [buildContestantMessages(input), buildContestantMessages({ ...input, retry })],
      [buildStorytellerMessages({ config: input.config, events: input.events, ask }), buildStorytellerMessages({ config: input.config, events: input.events, ask, retry })],
    ] as const) {
      expect(retried[0]).toEqual(original[0])
      expect(retried[1]!.content.startsWith(original[1]!.content + '\n\n')).toBe(true)
      expect(retried[1]!.content.slice(original[1]!.content.length)).toContain(retry.call.args)
      expect(retried).toHaveLength(2)
    }
  })

  it('covers all request kinds, exact legal ranges, remaining counts, current vote and threshold', () => {
    const events = log({ type: 'phase.started', day: 1, phase: 'public' }, { type: 'dawn.announced', deaths: [2] })
    const requests: ContestantRequest[] = [
      speak, { kind: 'speak', context: { where: 'whisper', room: 'room-A', round: 2, members: [1, 3] }, remaining: 4 },
      { kind: 'speak', context: { where: 'nomination_reason', nominee: 5 }, remaining: 1 },
      { kind: 'speak', context: { where: 'defense', nominator: 3 }, remaining: 1 },
      { kind: 'propose_whisper', eligible: [3, 5], remaining: 2, round: 1 },
      { kind: 'rank_whispers', round: 1, rooms: [{ room: 17, members: [1, 4, 6] }] },
      { kind: 'nominate', eligible: [3, 5] },
      { kind: 'vote', nominator: 3, nominee: 4, votes: [{ seat: 5, raised: true }], threshold: 4, dead: false },
      { kind: 'night_choice', as: 'monk', count: 1, allowSelf: false },
    ]
    for (const request of requests) expect(user(events, lang, request).endsWith(`${lang === 'zh' ? '请调用' : 'Call'} ${request.kind}`)).toBe(true)
    expect(user(events, lang)).toContain(lang === 'zh' ? '存活（7 人）' : 'Alive (7)')
    expect(user(events, lang, requests[5]!)).toContain('17')
    expect(user(events, lang, requests[7]!)).toContain('4')
  })

  it('keeps test calls minimal and asks for speak', () => {
    const messages = buildTestCallMessages(lang)
    expect(messages.map(m => m.role)).toEqual(['system', 'user'])
    expect(messages[1]!.content).toContain('speak')
    expect(messages[1]!.content).toContain('slayer_target')
  })
})

it('fixes six tools for the game with reasoning first, optional memo last and seat enums 1..N', () => {
  for (const lang of ['zh', 'en'] as const) for (const count of [5, 8, 15]) {
    const tools = contestantTools(count, lang)
    expect(tools.map(t => t.function.name)).toEqual(['speak', 'propose_whisper', 'rank_whispers', 'nominate', 'vote', 'night_choice'])
    for (const tool of tools) {
      const parameters = tool.function.parameters
      const properties = parameters.properties as Record<string, Record<string, unknown>>
      expect(Object.keys(properties)[0]).toBe('reasoning')
      expect(Object.keys(properties).at(-1)).toBe('memo')
      expect(properties.memo!.maxLength).toBe(2000)
      expect(parameters.required).not.toContain('memo')
      expect(parameters.required).toContain('reasoning')
      for (const field of ['slayer_target', 'nominee', 'members', 'targets']) if (properties[field]) {
        const schema = (properties[field]!.items ?? properties[field]) as Record<string, unknown>
        expect((schema.enum as unknown[]).filter(s => s !== null)).toEqual(Array.from({ length: count }, (_, i) => i + 1))
      }
    }
    const storyteller = storytellerTools(count, lang)
    expect(storyteller.map(t => t.function.name)).toEqual(['decide'])
    const schema = storyteller[0]!.function.parameters
    const props = schema.properties as Record<string, Record<string, unknown>>
    expect(Object.keys(props)[0]).toBe('reasoning')
    expect(schema.required).toEqual(['reasoning'])
    expect((props.roles!.items as Record<string, unknown>).enum).toEqual(ROLES.map(r => r.id))
    expect((props.seats!.items as Record<string, unknown>).enum).toEqual(Array.from({ length: count }, (_, i) => i + 1))
  }
})

it('renders every validation code in both languages with structured field details', () => {
  const codes: ValidationCode[] = ['no_tool_call', 'wrong_tool', 'bad_json', 'missing_field', 'bad_type', 'unknown_field', 'memo_too_long', 'seat_out_of_range', 'speech_required', 'slayer_not_allowed', 'members_empty', 'members_include_self', 'members_duplicate', 'member_unavailable', 'rank_unknown_room', 'rank_duplicate', 'nominee_not_eligible', 'vote_token_used', 'target_count', 'target_self', 'not_a_candidate', 'invalid_setup']
  for (const code of codes) {
    const zh = validationMessage({ code, field: 'FIELD' }, 'zh')
    const en = validationMessage({ code, field: 'FIELD' }, 'en')
    expect(zh).not.toBe(en)
    expect(zh).toContain('FIELD')
    expect(en).toContain('FIELD')
  }
})

it('describes more than a thousand legal candidates structurally, not as a thousand-item list', () => {
  const values: DiscretionValue[] = []
  const roles = ROLES.filter(r => r.type === 'townsfolk')
  for (let a = 2; a <= 15; a++) for (let b = a + 1; b <= 15; b++) for (const role of roles) values.push({ seats: [a, b], roles: [role.id] })
  expect(values.length).toBeGreaterThan(1000)
  const request: DiscretionAsk = { discretion: 'D8', candidates: { kind: 'list', values }, context: { subject: 1, ability: 'washerwoman', fields: ['seats', 'roles'], truth: { seats: [2, 3], roles: ['chef'] } } }
  for (const language of ['zh', 'en'] as const) {
    const text = buildStorytellerMessages({ config: config(language, 15), events: [], ask: request })[1]!.content
    expect(text).toContain('D8')
    expect(text).toContain('"choose":2')
    expect(text).toContain('washerwoman')
    expect(text).toContain('chef')
    expect(text.length).toBeLessThan(4000)
  }
})

it('renders all discretion meanings and seat-order setup instructions in both languages', () => {
  for (const language of ['zh', 'en'] as const) for (const discretion of DISCRETION_IDS) {
    const request: DiscretionAsk = discretion === 'D1'
      ? { discretion, candidates: { kind: 'setup', seatCount: 8 }, context: { fields: ['roles'] } }
      : discretion === 'seating'
        ? { discretion, candidates: { kind: 'seating', roles: ['chef', 'empath', 'slayer', 'saint', 'poisoner', 'imp', 'monk', 'soldier'] }, context: { fields: ['roles'] } }
        : { ...ask, discretion }
    const text = buildStorytellerMessages({ config: config(language), events: [], ask: request })[1]!.content
    expect(text).toContain(discretion)
    expect(text.endsWith(language === 'zh' ? '请调用 decide' : 'Call decide')).toBe(true)
    if (discretion === 'D1' || discretion === 'seating') expect(text).toContain(language === 'zh' ? '座位顺序' : 'seat order')
  }
})
