import { describe, expect, it } from 'vitest'
import { applyGrimoire, applyPublic, foldGrimoire, foldPublic, initialGrimoire, initialPublic } from '../../../shared/rules/fold'
import { config, legalRoles, logEvents, setupEvent } from './fixtures'

const events = logEvents([
  { type: 'game.created', config },
  setupEvent(),
  { type: 'grimoire.set', drunkBelieves: 'empath', redHerring: 3, bluffs: ['monk', 'virgin', 'soldier'] },
  { type: 'phase.started', day: 1, phase: 'first_night' },
  { type: 'status.changed', seat: 1, status: 'poisoned', on: true, source: 4 },
  { type: 'status.changed', seat: 2, status: 'protected', on: true, source: 3 },
  { type: 'status.changed', seat: 3, status: 'master', on: true, source: 2 },
  { type: 'night.death', seat: 2, cause: 'demon' },
  { type: 'phase.started', day: 1, phase: 'dawn' },
  { type: 'dawn.announced', deaths: [2] },
  { type: 'nomination', nominator: 1, nominee: 4 },
  { type: 'vote', seat: 2, raised: true, tokenUsed: true, decisionSeq: null },
  { type: 'vote.tallied', nominee: 4, votes: 3, threshold: 2, aboutToDie: true },
  { type: 'vote.tallied', nominee: 3, votes: 2, threshold: 2, aboutToDie: false },
  { type: 'vote.tallied', nominee: 5, votes: 3, threshold: 2, aboutToDie: false },
  { type: 'vote.tallied', nominee: 3, votes: 4, threshold: 2, aboutToDie: true },
  { type: 'virgin.triggered', nominator: 1 },
  { type: 'execution', seat: 1 },
  { type: 'status.changed', seat: 1, status: 'poisoned', on: false },
  { type: 'role.changed', seat: 4, from: 'poisoner', to: 'imp', alignment: 'evil' },
  { type: 'slayer.resolved', seat: 3, target: 5, died: false },
  { type: 'slayer.resolved', seat: 3, target: 5, died: true },
  { type: 'phase.started', day: 2, phase: 'night' },
  { type: 'phase.started', day: 2, phase: 'dawn' },
  { type: 'game.ended', winner: 'evil', reason: 'two_alive' },
])

describe('event folds', () => {
  it('reconstructs truth and public knowledge at every sequence without replaying effects', () => {
    for (let seq = 0; seq <= events.length; seq++) {
      const g = foldGrimoire(events, seq)
      const p = foldPublic(events, seq)
      expect(g.seatCount).toBe(seq >= 1 ? 5 : 0)
      expect(p.seatCount).toBe(seq >= 1 ? 5 : 0)
      expect(g.seats.map(s => s.role)).toEqual(seq < 2 ? [] : legalRoles.map((role, i) => i === 3 && seq >= 20 ? 'imp' : role))
      if (seq >= 2) {
        expect(g.seats.map(s => s.alive)).toEqual([seq < 18, seq < 8, true, true, seq < 22])
        expect(g.seats[0]?.poisonedBy).toBe(seq >= 5 && seq < 19 ? 4 : null)
        expect(g.seats[1]?.protectedBy).toBe(seq >= 6 ? 3 : null)
        expect(g.seats[2]?.masterOf).toBe(seq >= 7 ? 2 : null)
        expect(g.seats[1]?.voteTokenUsed).toBe(seq >= 12)
      }
      if (seq >= 1) {
        expect(p.alive).toEqual([seq < 18, seq < 10, true, true, seq < 22])
        expect(p.voteTokenUsed).toEqual([false, seq >= 12, false, false, false])
        expect(p.nominatorsToday).toEqual(seq >= 11 && seq < 24 ? [1] : [])
        expect(p.nomineesToday).toEqual(seq >= 11 && seq < 24 ? [4] : [])
      }
      expect(p.aboutToDie).toEqual(seq >= 13 && seq < 15 ? { seat: 4, votes: 3 } : seq >= 16 && seq < 18 ? { seat: 3, votes: 4 } : null)
      expect(p.ended).toEqual(seq >= 25 ? { winner: 'evil', reason: 'two_alive' } : null)
      expect(g.day).toBe(seq >= 23 ? 2 : seq >= 4 ? 1 : 0)
      expect(p.day).toBe(g.day)
    }
  })
  it('keeps patches and folds immutable and does not kill at virgin.triggered', () => {
    const g = applyGrimoire(initialGrimoire(5), setupEvent())
    const poisoned = applyGrimoire(g, { type: 'status.changed', seat: 1, status: 'poisoned', on: true, source: 4 })
    expect(g.seats[0]?.poisonedBy).toBeNull()
    const patch = applyGrimoire(poisoned, { type: 'grimoire.set', redHerring: 3 })
    expect(patch.seats[0]?.poisonedBy).toBe(4)
    expect(patch.seats.map(s => s.role)).toEqual(legalRoles)
    expect(applyGrimoire(patch, { type: 'virgin.triggered', nominator: 1 })).toBe(patch)
    expect(applyPublic(initialPublic(5), { type: 'night.death', seat: 1, cause: 'demon' }).alive).toEqual([true, true, true, true, true])
    expect(applyGrimoire(g, { type: 'public.speech', seat: 1, text: 'hi', kind: 'free', decisionSeq: 1 })).toBe(g)
    expect(applyPublic(initialPublic(5), { type: 'virgin.triggered', nominator: 1 }).alive[0]).toBe(true)
  })
  it('sets and clears every status, and role patches preserve death and statuses', () => {
    let g = applyGrimoire(initialGrimoire(5), setupEvent())
    for (const status of ['poisoned', 'protected', 'master', 'ability_used', 'vote_token_used'] as const) {
      g = applyGrimoire(g, { type: 'status.changed', seat: 1, status, on: true, source: 4 })
    }
    expect(g.seats[0]).toMatchObject({ poisonedBy: 4, protectedBy: 4, masterOf: 4, abilityUsed: true, voteTokenUsed: true })
    g = applyGrimoire(g, { type: 'execution', seat: 1 })
    g = applyGrimoire(g, { type: 'grimoire.set', seats: [{ seat: 1, role: 'imp', alignment: 'evil' }] })
    expect(g.seats[0]).toMatchObject({ role: 'imp', alignment: 'evil', alive: false, poisonedBy: 4 })
    for (const status of ['poisoned', 'protected', 'master', 'ability_used', 'vote_token_used'] as const) {
      g = applyGrimoire(g, { type: 'status.changed', seat: 1, status, on: false })
    }
    expect(g.seats[0]).toMatchObject({ poisonedBy: null, protectedBy: null, masterOf: null, abilityUsed: false, voteTokenUsed: false })
  })
  it('clears the execution candidate on entering night', () => {
    const p = applyPublic(initialPublic(5), { type: 'vote.tallied', nominee: 1, votes: 3, threshold: 3, aboutToDie: true })
    expect(applyPublic(p, { type: 'phase.started', day: 2, phase: 'night' }).aboutToDie).toBeNull()
    expect(p.aboutToDie).toEqual({ seat: 1, votes: 3 })
  })
})
