import { audience } from './audience'
import type { EventBody, GameEvent, Grimoire, PublicState, SeatTruth } from './types'

export function initialGrimoire(seatCount: number): Grimoire {
  return {
    seatCount, seats: [], drunkBelieves: null, redHerring: null,
    spyRegisters: null, recluseRegisters: null, bluffs: [], day: 0, phase: null,
  }
}

export function applyGrimoire(g: Grimoire, e: GameEvent | EventBody): Grimoire {
  switch (e.type) {
    case 'game.created': return { ...g, seatCount: e.config.seatCount }
    case 'phase.started': return { ...g, day: e.day, phase: e.phase }
    case 'grimoire.set': {
      const { type: _type, seats, ...patch } = e
      const next: Grimoire = {
        ...g,
        ...('drunkBelieves' in patch ? { drunkBelieves: patch.drunkBelieves } : {}),
        ...('redHerring' in patch ? { redHerring: patch.redHerring } : {}),
        ...('spyRegisters' in patch ? { spyRegisters: patch.spyRegisters } : {}),
        ...('recluseRegisters' in patch ? { recluseRegisters: patch.recluseRegisters } : {}),
        ...('bluffs' in patch ? { bluffs: patch.bluffs } : {}),
      }
      if (seats) {
        next.seats = [...g.seats]
        for (const s of seats) {
          next.seats[s.seat - 1] = {
            ...(g.seats[s.seat - 1] ?? {
              alive: true, poisonedBy: null, protectedBy: null, masterOf: null,
              abilityUsed: false, voteTokenUsed: false,
            }),
            ...s,
          }
        }
      }
      return next
    }
    case 'status.changed': {
      let patch: Partial<SeatTruth>
      switch (e.status) {
        case 'poisoned': patch = { poisonedBy: e.on ? e.source ?? e.seat : null }; break
        case 'protected': patch = { protectedBy: e.on ? e.source ?? e.seat : null }; break
        case 'master': patch = { masterOf: e.on ? e.source ?? e.seat : null }; break
        case 'ability_used': patch = { abilityUsed: e.on }; break
        case 'vote_token_used': patch = { voteTokenUsed: e.on }; break
      }
      return patchSeat(g, e.seat, patch)
    }
    case 'role.changed': return patchSeat(g, e.seat, { role: e.to, alignment: e.alignment })
    case 'night.death': case 'execution': return patchSeat(g, e.seat, { alive: false })
    case 'slayer.resolved': return e.died ? patchSeat(g, e.target, { alive: false }) : g
    case 'vote': return e.tokenUsed ? patchSeat(g, e.seat, { voteTokenUsed: true }) : g
    default: return g
  }
}

function patchSeat(g: Grimoire, seat: number, patch: Partial<SeatTruth>): Grimoire {
  if (!g.seats[seat - 1]) return g
  return { ...g, seats: g.seats.map(s => s.seat === seat ? { ...s, ...patch } : s) }
}

export function foldGrimoire(events: readonly GameEvent[], uptoSeq = Infinity): Grimoire {
  let g = initialGrimoire(0)
  for (const e of events) {
    if (e.seq <= uptoSeq) g = applyGrimoire(g, e)
  }
  return g
}

export function initialPublic(seatCount: number): PublicState {
  return {
    seatCount, day: 0, phase: null, alive: Array<boolean>(seatCount).fill(true),
    voteTokenUsed: Array<boolean>(seatCount).fill(false), nominatorsToday: [], nomineesToday: [],
    aboutToDie: null, ended: null,
  }
}

export function applyPublic(p: PublicState, e: GameEvent | EventBody): PublicState {
  if (audience(e).level !== 'public') return p
  switch (e.type) {
    case 'phase.started': return {
      ...p, day: e.day, phase: e.phase,
      ...(e.phase === 'dawn' ? { nominatorsToday: [], nomineesToday: [] } : {}),
      ...(e.phase === 'night' || e.phase === 'first_night' ? { aboutToDie: null } : {}),
    }
    case 'dawn.announced': return { ...p, alive: p.alive.map((alive, i) => e.deaths.includes(i + 1) ? false : alive) }
    case 'slayer.resolved': return e.died ? { ...p, alive: p.alive.map((alive, i) => i + 1 === e.target ? false : alive) } : p
    case 'execution': return { ...p, alive: p.alive.map((alive, i) => i + 1 === e.seat ? false : alive), aboutToDie: null }
    case 'nomination': return { ...p, nominatorsToday: [...p.nominatorsToday, e.nominator], nomineesToday: [...p.nomineesToday, e.nominee] }
    case 'vote': return e.tokenUsed ? { ...p, voteTokenUsed: p.voteTokenUsed.map((used, i) => i + 1 === e.seat ? true : used) } : p
    case 'vote.tallied': return {
      ...p, aboutToDie: e.aboutToDie ? { seat: e.nominee, votes: e.votes }
        : p.aboutToDie?.votes === e.votes ? null : p.aboutToDie,
    }
    case 'game.ended': return { ...p, ended: { winner: e.winner, reason: e.reason } }
    default: return p
  }
}

export function foldPublic(events: readonly GameEvent[], uptoSeq = Infinity): PublicState {
  const created = events.find(e => e.seq <= uptoSeq && e.type === 'game.created')
  let p = initialPublic(created?.type === 'game.created' ? created.config.seatCount : 0)
  for (const e of events) {
    if (e.seq <= uptoSeq) p = applyPublic(p, e)
  }
  return p
}
