import { expect, it } from 'vitest'
import { characterIconUrl } from '../app/utils/character-icons'

it('uses the self-hosted official icon for the character and alignment', () => {
  expect(characterIconUrl('washerwoman', 'good')).toBe('/botc/characters/tb/washerwoman_g.webp')
  expect(characterIconUrl('imp', 'evil')).toBe('/botc/characters/tb/imp_e.webp')
})
