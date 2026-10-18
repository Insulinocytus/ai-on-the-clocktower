import type { Alignment, Grimoire, RoleId, Seat, SeatTruth } from './types'

function truth(g: Grimoire, seat: Seat): SeatTruth {
  const value = g.seats[seat - 1]
  if (!value) throw new RangeError(`Seat ${seat} has no assigned role`)
  return value
}

export function isFunctioning(g: Grimoire, seat: Seat): boolean {
  const s = truth(g, seat)
  return s.role !== 'drunk' && s.poisonedBy === null
}

export function registeredAlignment(g: Grimoire, seat: Seat): Alignment {
  const s = truth(g, seat)
  if (isFunctioning(g, seat)) {
    if (s.role === 'spy' && g.spyRegisters) return g.spyRegisters.alignment
    if (s.role === 'recluse' && g.recluseRegisters) return g.recluseRegisters.alignment
  }
  return s.alignment
}

export function registeredRole(g: Grimoire, seat: Seat): RoleId {
  const s = truth(g, seat)
  if (isFunctioning(g, seat)) {
    if (s.role === 'spy' && g.spyRegisters) return g.spyRegisters.role
    if (s.role === 'recluse' && g.recluseRegisters) return g.recluseRegisters.role
  }
  return s.role
}
