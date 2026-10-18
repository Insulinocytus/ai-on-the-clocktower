import { ROLES, ROLE_BY_ID } from '../roles'
import { registeredRole } from '../register'
import type { DiscretionValue, Grimoire, RoleId, RoleType, Seat } from '../types'

export const roleIds = ROLES.map(role => role.id)
export const rolesOfType = (type: RoleType): RoleId[] => ROLES.filter(role => role.type === type).map(role => role.id)

export function pairs(seats: readonly Seat[]): Seat[][] {
  return seats.flatMap((a, i) => seats.slice(i + 1).map(b => [a, b]))
}

export function triples(roles: readonly RoleId[]): DiscretionValue[] {
  return roles.flatMap((a, i) => roles.slice(i + 1).flatMap((b, j) => roles.slice(i + j + 2).map(c => ({ roles: [a, b, c] }))))
}

export function firstInfo(g: Grimoire, self: Seat, as: RoleId, registered: boolean, fake = false): DiscretionValue[] {
  const type = as === 'washerwoman' ? 'townsfolk' : as === 'librarian' ? 'outsider' : 'minion'
  const others = g.seats.filter(seat => seat.seat !== self)
  const roleAt = (seat: Seat) => registered ? registeredRole(g, seat) : g.seats[seat - 1]!.role
  const values = pairs(others.map(seat => seat.seat)).flatMap(seats => rolesOfType(type).filter(role =>
    fake || seats.some(seat => roleAt(seat) === role),
  ).map(role => ({ seats, roles: [role] })))
  if (as !== 'washerwoman' && (fake ? as === 'librarian' : !others.some(seat => ROLE_BY_ID[roleAt(seat.seat)].type === type))) {
    values.push({ seats: [], roles: [] })
  }
  // A sole Washerwoman must see herself: excluding her would make truthful information impossible.
  if (!fake && as === 'washerwoman' && values.length === 0) {
    for (const other of others) values.push({ seats: [self, other.seat].sort((a, b) => a - b), roles: ['washerwoman'] })
  }
  return values
}

export function fakeInfo(g: Grimoire, self: Seat, as: RoleId, targets: Seat[]): DiscretionValue[] {
  if (['washerwoman', 'librarian', 'investigator'].includes(as)) return firstInfo(g, self, as, true, true)
  if (as === 'chef' || as === 'empath') return Array.from({ length: as === 'chef' ? g.seatCount + 1 : 3 }, (_, number) => ({ number }))
  if (as === 'fortuneteller') return [{ answer: false }, { answer: true }]
  return roleIds.map(role => ({ ...(as === 'ravenkeeper' ? { seats: targets } : {}), roles: [role] }))
}

export function sameInfo(a: DiscretionValue, b: DiscretionValue): boolean {
  return a.number === b.number && a.answer === b.answer && a.alignment === b.alignment
    && JSON.stringify(a.seats?.toSorted((x, y) => x - y)) === JSON.stringify(b.seats?.toSorted((x, y) => x - y))
    && JSON.stringify(a.roles?.toSorted()) === JSON.stringify(b.roles?.toSorted())
}
