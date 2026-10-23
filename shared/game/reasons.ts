import type { GameReason, Language } from '../types/game'

export const GAME_REASON_LABELS = {
  engine_error: { zh: '引擎错误', en: 'Engine error' },
  human: { zh: '观战者终止', en: 'Stopped by spectator' },
  all_demons_dead: { zh: '所有恶魔死亡', en: 'All Demons are dead' },
  two_alive: { zh: '只剩两名玩家存活', en: 'Only two players remain alive' },
  mayor: {
    zh: '镇长存活至仅三人存活且无人被处决的白天结束',
    en: 'The Mayor survived to the end of a day with three players alive and no execution',
  },
  saint_executed: { zh: '圣徒死于处决', en: 'The Saint died by execution' },
} satisfies Record<GameReason, Record<Language, string>>
