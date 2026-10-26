import type { Alignment, RoleId } from '../../shared/types/game'

export function characterIconUrl(role: RoleId, alignment: Alignment): string {
  return `/botc/characters/tb/${role}_${alignment === 'good' ? 'g' : 'e'}.webp`
}
