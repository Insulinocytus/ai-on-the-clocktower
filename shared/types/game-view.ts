import type { GameConfig, GameReason } from './game'

export interface GameSummary {
  id: string
  createdAt: string
  status: 'running' | 'waiting' | 'ended' | 'aborted'
  reason?: GameReason
  replayable: boolean
  config: GameConfig
}
