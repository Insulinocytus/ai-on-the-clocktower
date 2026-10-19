import type { GameConfig } from './game'

export interface GameSummary {
  id: string
  createdAt: string
  status: 'running' | 'waiting' | 'ended' | 'aborted'
  reason?: string
  replayable: boolean
  config: GameConfig
}
