import { DISCRETION_IDS, LOG_VERSION } from '../../../shared/rules/types'
import type { EventBody, GameConfig, GameEvent, RoleId } from '../../../shared/rules/types'
import { ROLE_BY_ID } from '../../../shared/rules/roles'

export const config: GameConfig = {
  seatCount: 5,
  seats: Array.from({ length: 5 }, () => ({ presetId: 'p', name: 'Preset', model: 'model', providerId: 'provider', forceToolChoice: true, extraBody: {} })),
  storyteller: null,
  sources: Object.fromEntries(DISCRETION_IDS.map(id => [id, 'random'])) as GameConfig['sources'],
  maxSpeeches: 10, whisperRooms: 3, language: 'en', seed: 'test', logVersion: LOG_VERSION, promptVersion: 'test',
}
export const legalRoles: RoleId[] = ['washerwoman', 'chef', 'mayor', 'poisoner', 'imp']

export function setupEvent(roles: RoleId[] = legalRoles): EventBody {
  return { type: 'grimoire.set', seats: roles.map((role, i) => ({ seat: i + 1, role, alignment: ROLE_BY_ID[role].alignment })) }
}

export function logEvents(bodies: EventBody[]): GameEvent[] {
  return bodies.map((body, i) => ({ ...body, seq: i + 1 }))
}
