import type { GameEvent, Language } from '../types/game'

export const PHASE_LABELS = {
  'first-night': { zh: '首夜', en: 'First night' },
  night: { zh: '夜晚', en: 'Night' },
  dawn: { zh: '黎明', en: 'Dawn' },
  whisper: { zh: '私聊阶段', en: 'Whisper phase' },
  public: { zh: '公聊阶段', en: 'Public discussion' },
  nomination: { zh: '提名阶段', en: 'Nominations' },
} satisfies Record<Extract<GameEvent, { type: 'phase.started' }>['phase'], Record<Language, string>>
