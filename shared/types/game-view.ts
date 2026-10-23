import type { GameConfig, GameReason } from './game'

export interface GameSummary {
  id: string
  createdAt: string
  status: 'running' | 'waiting' | 'paused' | 'ended' | 'aborted'
  reason?: GameReason
  compatible: boolean
  config: GameConfig
}
