import type { Alignment, RoleId } from '#shared/types/game'
import { ROLES } from '#shared/game/roles'

export function characterIconUrl(
  role: RoleId,
  alignment: Alignment = ROLES[role].alignment,
): string {
  return `/botc/characters/tb/${role}_${alignment === 'good' ? 'g' : 'e'}.webp`
}
