import { describe, expect, it } from 'vitest'
import { createRng } from '../../../shared/rules/rng'
import { sampleSetup, setupCounts, validateSetup } from '../../../shared/rules/setup'
import { applyGrimoire, initialGrimoire } from '../../../shared/rules/fold'
import { isFunctioning, registeredAlignment, registeredRole } from '../../../shared/rules/register'
import { winner } from '../../../shared/rules/winner'
import { legalRoles, setupEvent } from './fixtures'

const grimoire = () => applyGrimoire(initialGrimoire(5), setupEvent())
describe('setup legality', () => {
  it('validates actual roles with Baron and Drunk counted as an outsider', () => {
    expect(setupCounts(5, false)).toEqual([3, 0, 1, 1])
    expect(setupCounts(9, true)).toEqual([3, 4, 1, 1])
    expect(validateSetup(legalRoles, 5)).toBeNull()
    expect(validateSetup(['chef', 'drunk', 'saint', 'baron', 'imp'], 5)).toBeNull()
    expect(validateSetup(['chef', 'empath', 'mayor', 'drunk', 'poisoner', 'imp'], 6)).toBeNull()
    expect(validateSetup(['chef', 'chef', 'mayor', 'poisoner', 'imp'], 5)?.code).toBe('invalid_setup')
    expect(validateSetup(['chef', 'empath', 'mayor', 'baron', 'imp'], 5)?.code).toBe('invalid_setup')
    expect(validateSetup(['chef', 'empath', 'mayor', 'poisoner', 'spy'], 5)?.code).toBe('invalid_setup')
    expect(validateSetup(['chef', 'drunk', 'mayor', 'poisoner', 'imp'], 5)?.code).toBe('invalid_setup')
    expect(validateSetup(legalRoles, 4)?.code).toBe('invalid_setup')
    expect(validateSetup(legalRoles, 16)?.code).toBe('invalid_setup')
    expect(validateSetup(legalRoles, 5.5)?.code).toBe('invalid_setup')
    expect(validateSetup(legalRoles, 6)?.code).toBe('invalid_setup')
    expect(() => setupCounts(4, false)).toThrow(RangeError)
  })
  it('samples legal configurations in seat order for many seeds at every size', () => {
    const orders = new Set<string>()
    for (let n = 5; n <= 15; n++) {
      let barons = 0
      let drunks = 0
      for (let seed = 0; seed < 200; seed++) {
        const roles = sampleSetup(n, createRng(`setup:${n}:${seed}`))
        expect(validateSetup(roles, n)).toBeNull()
        barons += Number(roles.includes('baron'))
        drunks += Number(roles.includes('drunk'))
        if (n === 5) orders.add(roles.join(','))
      }
      expect(barons).toBeGreaterThan(0)
      expect(barons).toBeLessThan(200)
      expect(drunks).toBeGreaterThan(0)
    }
    expect(orders.size).toBeGreaterThan(100)
    expect(sampleSetup(10, createRng('repeat'))).toEqual(sampleSetup(10, createRng('repeat')))
  })
})

describe('true-role victory conditions', () => {
  it('wins for good when the demon is dead, including simultaneous two alive', () => {
    expect(winner(grimoire())).toBeNull()
    const deadDemon = applyGrimoire(grimoire(), { type: 'execution', seat: 5 })
    expect(winner(deadDemon)).toEqual({ winner: 'good', reason: 'demon_dead' })
    const two = applyGrimoire(applyGrimoire(deadDemon, { type: 'execution', seat: 1 }), { type: 'execution', seat: 2 })
    expect(winner(two)).toEqual({ winner: 'good', reason: 'demon_dead' })
    expect(winner(initialGrimoire(5))).toBeNull()
  })
  it('wins for evil at two alive while the demon survives', () => {
    let g = grimoire()
    for (const seat of [1, 2, 3]) g = applyGrimoire(g, { type: 'night.death', seat, cause: 'demon' })
    expect(winner(g)).toEqual({ winner: 'evil', reason: 'two_alive' })
  })
  it('only triggers a functioning Saint on execution, not an ordinary death', () => {
    const g = applyGrimoire(initialGrimoire(5), setupEvent(['chef', 'saint', 'drunk', 'baron', 'imp']))
    const dead = applyGrimoire(g, { type: 'execution', seat: 2 })
    expect(winner(dead)).toBeNull()
    expect(winner(dead, { executed: 2 })).toEqual({ winner: 'evil', reason: 'saint_executed' })
    const poisoned = applyGrimoire(dead, { type: 'status.changed', seat: 2, status: 'poisoned', on: true, source: 4 })
    expect(winner(poisoned, { executed: 2 })).toBeNull()
    expect(winner(applyGrimoire(dead, { type: 'execution', seat: 5 }), { executed: 2 })).toEqual({ winner: 'good', reason: 'demon_dead' })
  })
  it('requires a living functioning Mayor with exactly three alive and no execution', () => {
    let g = grimoire()
    for (const seat of [1, 2]) g = applyGrimoire(g, { type: 'night.death', seat, cause: 'demon' })
    expect(winner(g)).toBeNull()
    expect(winner(g, { dayEndedWithoutExecution: true })).toEqual({ winner: 'good', reason: 'mayor_win' })
    expect(winner(applyGrimoire(g, { type: 'status.changed', seat: 3, status: 'poisoned', on: true, source: 4 }), { dayEndedWithoutExecution: true })).toBeNull()
    const noMayor = applyGrimoire(applyGrimoire(grimoire(), { type: 'execution', seat: 3 }), { type: 'execution', seat: 1 })
    expect(winner(noMayor, { dayEndedWithoutExecution: true })).toBeNull()
    expect(winner(grimoire(), { dayEndedWithoutExecution: true })).toBeNull()
  })
})

describe('registration and functioning', () => {
  it('uses fixed independent registrations even for dead Spy and Recluse; poison restores truth', () => {
    let g = applyGrimoire(initialGrimoire(5), setupEvent(['spy', 'recluse', 'drunk', 'chef', 'imp']))
    g = applyGrimoire(g, { type: 'grimoire.set', spyRegisters: { alignment: 'evil', role: 'mayor' }, recluseRegisters: { alignment: 'good', role: 'imp' } })
    for (const seat of [1, 2]) g = applyGrimoire(g, { type: 'execution', seat })
    expect(isFunctioning(g, 1)).toBe(true)
    expect(registeredAlignment(g, 1)).toBe('evil')
    expect(registeredRole(g, 1)).toBe('mayor')
    expect(registeredAlignment(g, 2)).toBe('good')
    expect(registeredRole(g, 2)).toBe('imp')
    expect(isFunctioning(g, 3)).toBe(false)
    expect(registeredRole(g, 3)).toBe('drunk')
    for (const seat of [1, 2]) g = applyGrimoire(g, { type: 'status.changed', seat, status: 'poisoned', on: true, source: 4 })
    expect(registeredRole(g, 1)).toBe('spy')
    expect(registeredRole(g, 2)).toBe('recluse')
    expect(isFunctioning(g, 1)).toBe(false)
    expect(registeredAlignment(g, 2)).toBe('good')
  })
})
