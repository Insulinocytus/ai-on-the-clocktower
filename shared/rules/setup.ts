import { ROLES, ROLE_BY_ID, SETUP_COUNTS } from './roles'
import type { Rng, RoleId, ValidationError } from './types'

export function setupCounts(seatCount: number, baron: boolean): [number, number, number, number] {
  const counts = SETUP_COUNTS[seatCount]
  if (!Number.isInteger(seatCount) || !counts) throw new RangeError('Seat count must be an integer from 5 to 15')
  return [counts[0] - (baron ? 2 : 0), counts[1] + (baron ? 2 : 0), counts[2], counts[3]]
}

export function validateSetup(roles: readonly RoleId[], seatCount: number): ValidationError | null {
  if (!Number.isInteger(seatCount) || seatCount < 5 || seatCount > 15 || roles.length !== seatCount) {
    return { code: 'invalid_setup', field: 'roles', detail: 'Seat count must be 5–15 and match the role count' }
  }
  if (new Set(roles).size !== roles.length || roles.some(role => !Object.hasOwn(ROLE_BY_ID, role))) {
    return { code: 'invalid_setup', field: 'roles', detail: 'Roles must be known and unique' }
  }
  const expected = setupCounts(seatCount, roles.includes('baron'))
  const counts = [0, 0, 0, 0]
  const types = ['townsfolk', 'outsider', 'minion', 'demon']
  for (const role of roles) counts[types.indexOf(ROLE_BY_ID[role].type)]!++
  if (roles.filter(role => role === 'imp').length !== 1 || counts.some((count, i) => count !== expected[i])) {
    return { code: 'invalid_setup', field: 'roles', detail: `Expected ${expected.join('/')} townsfolk/outsiders/minions/demons` }
  }
  return null
}

export function sampleSetup(seatCount: number, rng: Rng): RoleId[] {
  const base = setupCounts(seatCount, false)
  const minions = rng.shuffle(ROLES.filter(r => r.type === 'minion').map(r => r.id)).slice(0, base[2])
  const counts = setupCounts(seatCount, minions.includes('baron'))
  const townsfolk = rng.shuffle(ROLES.filter(r => r.type === 'townsfolk').map(r => r.id)).slice(0, counts[0])
  const outsiders = rng.shuffle(ROLES.filter(r => r.type === 'outsider').map(r => r.id)).slice(0, counts[1])
  return rng.shuffle([...townsfolk, ...outsiders, ...minions, 'imp' as const])
}
