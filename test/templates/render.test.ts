import { describe, expect, it } from 'vitest'
import { project } from '../../shared/rules/audience'
import { DISCRETION_IDS } from '../../shared/rules/types'
import type { AbilityInfo, EventBody, EventType, GameConfig, GameEvent, Grimoire, Lang, RoleId } from '../../shared/rules/types'
import { formatAbilityInfo, phaseLabel, renderEvent, roleName, seatLabel } from '../../shared/templates'

const grimoire: Grimoire = {
  seatCount: 3,
  seats: [
    { seat: 1, role: 'drunk', alignment: 'good', alive: true, poisonedBy: null, protectedBy: 2, masterOf: null, abilityUsed: false, voteTokenUsed: false },
    { seat: 2, role: 'poisoner', alignment: 'evil', alive: false, poisonedBy: 2, protectedBy: null, masterOf: 3, abilityUsed: true, voteTokenUsed: true },
    { seat: 3, role: 'imp', alignment: 'evil', alive: true, poisonedBy: null, protectedBy: null, masterOf: null, abilityUsed: false, voteTokenUsed: false },
  ],
  drunkBelieves: 'investigator', redHerring: 1,
  spyRegisters: { role: 'saint', alignment: 'good' },
  recluseRegisters: { role: 'imp', alignment: 'evil' },
  bluffs: ['washerwoman', 'soldier', 'butler'], day: 2, phase: 'night',
}
const preset = { presetId: 'private-preset-id', name: 'private-preset-name', model: 'private-model-name', providerId: 'private-provider-id', forceToolChoice: true, extraBody: {} }
const config: GameConfig = {
  seatCount: 3, seats: [preset, preset, preset], storyteller: preset,
  sources: Object.fromEntries(DISCRETION_IDS.map(d => [d, 'random'])) as GameConfig['sources'],
  maxSpeeches: 10, whisperRooms: 3, language: 'zh', seed: 'seed', logVersion: 1, promptVersion: 'test',
}
const decision = {
  params: { private: 'private-params' }, response: { private: 'private-response' }, model: 'private-model-name', usage: null,
  durationMs: 1, attempt: 1,
  outcome: { ok: true as const, call: { tool: 'decide', args: { reasoning: 'private-reasoning', seats: [2] } } },
}
const truth: AbilityInfo = { seats: [2, 3], roles: ['poisoner'] }
const misinformation: AbilityInfo = { seats: [2, 3], roles: ['baron'] }

// Record makes a newly added event type require an audience/rendering fixture.
const examples = {
  'game.created': { type: 'game.created', config },
  'phase.started': { type: 'phase.started', phase: 'dawn', day: 2 },
  'game.ended': { type: 'game.ended', winner: 'good', reason: 'demon_dead' },
  'game.aborted': { type: 'game.aborted', reason: 'model_failure', detail: 'Request timed out', seat: 2 },
  'contestant.decision': { type: 'contestant.decision', seat: 1, request: { kind: 'night_choice', as: 'investigator', count: 1, allowSelf: true }, ...decision },
  'storyteller.decision': { type: 'storyteller.decision', discretion: 'D8', requestSeq: 1, ...decision },
  'discretion.requested': { type: 'discretion.requested', discretion: 'D8', candidates: { kind: 'list', values: [truth, misinformation] }, context: { subject: 1, ability: 'investigator', truth, fields: ['seats', 'roles'] }, source: 'storyteller' },
  'discretion.resolved': { type: 'discretion.resolved', discretion: 'D8', requestSeq: 1, value: misinformation, source: 'storyteller', decisionSeq: 2 },
  'grimoire.set': { type: 'grimoire.set', ...grimoire },
  'status.changed': { type: 'status.changed', seat: 1, status: 'poisoned', on: true, source: 2 },
  'role.changed': { type: 'role.changed', seat: 2, from: 'poisoner', to: 'imp', alignment: 'evil' },
  'ability.resolved': { type: 'ability.resolved', seat: 1, role: 'drunk', as: 'investigator', effective: false, result: truth, told: { value: misinformation, deviates: true, reason: 'drunk' } },
  'night.death': { type: 'night.death', seat: 2, cause: 'demon' },
  told: { type: 'told', seat: 1, kind: 'role', role: 'investigator' },
  'seat.memo.updated': { type: 'seat.memo.updated', seat: 1, text: 'Keep this exact memo.' },
  'night.choice': { type: 'night.choice', seat: 1, as: 'fortuneteller', targets: [2, 3], decisionSeq: 1 },
  'dawn.announced': { type: 'dawn.announced', deaths: [2] },
  'whisper.proposed': { type: 'whisper.proposed', round: 1, rooms: [{ members: [1, 2], proposers: [2] }] },
  'whisper.candidates': { type: 'whisper.candidates', round: 1, seat: 1, rooms: [{ room: 1, members: [1, 2] }] },
  'whisper.ranked': { type: 'whisper.ranked', round: 1, seat: 1, ranking: [1] },
  'whisper.room.opened': { type: 'whisper.room.opened', round: 1, room: 'day2-r1-a', members: [1, 2] },
  'whisper.speech': { type: 'whisper.speech', round: 1, room: 'day2-r1-a', members: [1, 2], seat: 1, text: 'Original whisper 原话.', decisionSeq: 1 },
  'whisper.room.closed': { type: 'whisper.room.closed', round: 1, room: 'day2-r1-a', members: [1, 2] },
  'public.speech': { type: 'public.speech', seat: 1, text: 'Original speech 原话.', kind: 'free', slayerTarget: 3, decisionSeq: 1 },
  'slayer.resolved': { type: 'slayer.resolved', seat: 1, target: 3, died: false },
  nomination: { type: 'nomination', nominator: 1, nominee: 2 },
  'virgin.triggered': { type: 'virgin.triggered', nominator: 1 },
  vote: { type: 'vote', seat: 1, raised: true, tokenUsed: true, decisionSeq: null },
  'vote.tallied': { type: 'vote.tallied', nominee: 2, votes: 3, threshold: 2, aboutToDie: true },
  execution: { type: 'execution', seat: 2 },
} satisfies Record<EventType, EventBody>

const events: GameEvent[] = Object.values(examples).map((e, i) => ({ ...e, seq: i + 1 }))
const noText: EventType[] = ['game.created', 'contestant.decision', 'storyteller.decision']
const languages: Lang[] = ['zh', 'en']

for (const lang of languages) {
  describe(`${lang} templates`, () => {
    for (const observer of [{ kind: 'seat', seat: 1 }, { kind: 'storyteller' }, { kind: 'spectator' }] as const) {
      for (const e of project(events, observer)) {
        it(`renders ${e.type} for ${observer.kind} without empty or missing values`, () => {
          const text = renderEvent(e, { lang, person: observer.kind, self: 1 })
          if (noText.includes(e.type)) expect(text).toBeNull()
          else {
            expect(text?.trim().length).toBeGreaterThan(0)
            expect(text).not.toMatch(/undefined|\[object Object\]/)
          }
        })
      }
    }

    it('seat projection tells the believed role, not drunkenness, truth, models, or dawn causes', () => {
      const lines = project(events, { kind: 'seat', seat: 1 }).map(e => renderEvent(e, { lang, person: 'seat', self: 1 }))
      const timeline = lines.filter((line): line is string => line !== null).join('\n')
      expect(timeline).toContain(roleName('investigator', lang))
      expect(timeline).not.toContain(roleName('drunk', lang))
      expect(timeline).not.toMatch(/private-|醉酒|中毒|真值|not functioning|Truth:|poisoned|drunk/)
      expect(timeline).toContain(lang === 'zh' ? '你' : 'you')
      const dawn = renderEvent({ ...examples['dawn.announced'], seq: 40 }, { lang, person: 'seat', self: 1 })
      expect(dawn).toContain(seatLabel(2, lang))
      expect(dawn).not.toMatch(/恶魔|Demon|cause|死因/)
      const told: GameEvent = { type: 'told', seat: 1, kind: 'ability', ability: 'investigator', value: misinformation, seq: 50 }
      const line = renderEvent(told, { lang, person: 'seat', self: 1 })
      expect(line).toContain(roleName('baron', lang))
      expect(line).not.toContain(roleName('poisoner', lang))
      expect(renderEvent({ ...told, seq: 999 }, { lang, person: 'seat', self: 1 })).toBe(line)
    })

    it('storyteller distinguishes the recipient, true result, and told deviation without model records', () => {
      const timeline = project(events, { kind: 'storyteller' }).map(e => renderEvent(e, { lang, person: 'storyteller', self: 1 })).join('\n')
      expect(timeline).toContain(seatLabel(1, lang))
      expect(timeline).toContain(roleName('drunk', lang))
      expect(timeline).toContain(roleName('poisoner', lang))
      expect(timeline).toContain(roleName('baron', lang))
      expect(timeline).toContain(lang === 'zh' ? '偏离真值' : 'deviates from truth')
      expect(timeline).not.toMatch(/private-|告知你|Your character|The Storyteller tells you/)
    })

    it('spectator uses third person while keeping true grimoire and original speech intact', () => {
      const told: GameEvent = { type: 'told', seat: 1, kind: 'spy_grimoire', grimoire, seq: 50 }
      const line = renderEvent(told, { lang, person: 'spectator', self: 1 })
      expect(line).toContain(seatLabel(1, lang))
      expect(line).toContain(roleName('drunk', lang))
      expect(line).toContain(roleName('investigator', lang))
      expect(line).toContain(lang === 'zh' ? '干扰项' : 'red herring')
      expect(line).not.toMatch(/告知你|Your character|The Storyteller tells you|private-/)
      for (const speech of [examples['public.speech'], examples['whisper.speech']]) {
        const text = renderEvent({ ...speech, seq: 1 }, { lang, person: 'spectator', self: 1 })
        expect(text).toContain(speech.text)
        expect(text).toContain(seatLabel(1, lang))
      }
    })

    const abilityCases: { ability: RoleId; info: AbilityInfo; expected: string | number }[] = [
      { ability: 'washerwoman', info: { seats: [2, 3], roles: ['empath'] }, expected: roleName('empath', lang) },
      { ability: 'librarian', info: { seats: [2, 3], roles: ['recluse'] }, expected: roleName('recluse', lang) },
      { ability: 'librarian', info: { seats: [], roles: [] }, expected: lang === 'zh' ? '没有外来者' : 'no Outsiders' },
      { ability: 'investigator', info: truth, expected: roleName('poisoner', lang) },
      { ability: 'chef', info: { number: 0 }, expected: 0 },
      { ability: 'empath', info: { number: 2 }, expected: 2 },
      { ability: 'fortuneteller', info: { answer: false }, expected: lang === 'zh' ? '没有' : 'No' },
      { ability: 'fortuneteller', info: { answer: true }, expected: lang === 'zh' ? '有恶魔' : 'Yes' },
      { ability: 'undertaker', info: { roles: ['saint'] }, expected: roleName('saint', lang) },
      { ability: 'ravenkeeper', info: { seats: [3], roles: ['imp'] }, expected: roleName('imp', lang) },
    ]
    it.each(abilityCases)('renders $ability information as told and as truth', ({ ability, info, expected }) => {
      const formatted = formatAbilityInfo(ability, info, lang)
      expect(formatted).toContain(String(expected))
      expect(formatted).not.toMatch(/undefined|\[object Object\]/)
      for (const person of ['seat', 'storyteller', 'spectator'] as const) {
        const told = renderEvent({ type: 'told', kind: 'ability', seat: 1, ability, value: info, seq: 1 }, { person, lang, self: 1 })
        expect(told).toContain(String(expected))
      }
      const resolved = renderEvent({ type: 'ability.resolved', seat: 1, role: ability, as: ability, effective: true, result: info, told: { value: info, deviates: false }, seq: 1 }, { person: 'storyteller', lang })
      expect(resolved).toContain(formatted)
    })

    it.each<EventBody>([
      { type: 'told', kind: 'minion_info', seat: 2, demon: 3, minions: [] },
      { type: 'told', kind: 'demon_info', seat: 3, minions: [2], bluffs: ['monk', 'soldier', 'butler'] },
      { type: 'told', kind: 'became_imp', seat: 2 },
      { type: 'dawn.announced', deaths: [] },
      { type: 'public.speech', kind: 'nomination_reason', seat: 1, text: 'Reason.', decisionSeq: 1 },
      { type: 'public.speech', kind: 'defense', seat: 2, text: 'Defense.', decisionSeq: 1 },
      { type: 'slayer.resolved', seat: 1, target: 3, died: true },
      { type: 'vote', seat: 1, raised: false, tokenUsed: false, decisionSeq: null },
      { type: 'vote.tallied', nominee: 2, votes: 1, threshold: 2, aboutToDie: false },
      { type: 'whisper.proposed', round: 2, rooms: [] },
      { type: 'whisper.candidates', round: 2, seat: 1, rooms: [] },
      { type: 'whisper.ranked', round: 2, seat: 1, ranking: [] },
      { type: 'discretion.requested', discretion: 'D1', source: 'manual', candidates: { kind: 'setup', seatCount: 8 }, context: { fields: ['roles'] } },
      { type: 'discretion.requested', discretion: 'seating', source: 'random', candidates: { kind: 'seating', roles: ['slayer', 'poisoner', 'imp'] }, context: { fields: ['roles'] } },
      { type: 'discretion.resolved', discretion: 'D1', source: 'manual', requestSeq: 1, decisionSeq: null, value: { roles: ['slayer', 'poisoner', 'imp'] } },
      { type: 'ability.resolved', seat: 2, role: 'poisoner', as: 'poisoner', effective: true, targets: [1] },
    ])('renders the $type variant without missing values', body => {
      const text = renderEvent({ ...body, seq: 1 }, { lang, person: 'spectator' })
      expect(text?.length).toBeGreaterThan(0)
      expect(text).not.toMatch(/undefined|\[object Object\]/)
    })

    it('does not identify a fake Slayer or disclose why a shot failed', () => {
      const text = renderEvent({ ...examples['slayer.resolved'], seq: 1 }, { lang, person: 'seat', self: 1 })
      expect(text).toBe(lang === 'zh' ? '无事发生。' : 'Nothing happens.')
    })

    it('labels seats and all phases without identities', () => {
      expect(seatLabel(3, lang)).toBe(lang === 'zh' ? '3 号' : 'Seat 3')
      expect(seatLabel(3, lang, 3)).toBe(lang === 'zh' ? '你' : 'you')
      for (const phase of ['first_night', 'night', 'dawn', 'whisper', 'public', 'nomination'] as const) {
        expect(phaseLabel(phase, 2, lang).length).toBeGreaterThan(0)
      }
      expect(phaseLabel('dawn', 2, lang)).toContain('2')
    })
  })
}
