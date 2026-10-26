import type { Meta, StoryObj } from '@storybook-vue/nuxt'
import { expect, fn, mocked, screen } from 'storybook/test'
import { abortGame, gameEvents, getGame, resumeGame, subscribeGame } from '@/api'
import { events, gameSummary } from '@/components/spectator.fixtures'
import GameSpectator from '@/pages/games/[id].vue'
import { project } from '#shared/game/rules'
import type { GameEvent } from '#shared/types/game'
import type { GameSummary } from '#shared/types/game-view'
import { renderPage } from './page'

const id = 'game-1a2b3c4d'
const live = events.filter((event) => event.seq <= 31)

const stage =
  (log: GameEvent[], status: GameSummary['status'], reason?: GameSummary['reason']) => () => {
    const game = gameSummary(id, status, reason)
    mocked(getGame).mockReset().mockResolvedValue(game)
    mocked(abortGame).mockReset().mockResolvedValue(game)
    mocked(resumeGame).mockReset().mockResolvedValue(game)
    mocked(gameEvents)
      .mockReset()
      .mockImplementation((_, observer = 'spectator', after = 0) =>
        Promise.resolve(project(log, observer).filter((event) => event.seq > after)),
      )
    mocked(subscribeGame)
      .mockReset()
      .mockImplementation((_, observer, after, onEvent) => {
        for (const event of project(log, observer)) if (event.seq > after) onEvent(event)
        return fn()
      })
  }

const meta = {
  title: 'Pages/Game',
  render: renderPage(GameSpectator, { path: `/games/${id}`, spectator: true, params: { id } }),
  parameters: { layout: 'fullscreen' },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

export const Running: Story = {
  beforeEach: stage(live, 'running'),
  play: async ({ canvas }) => {
    await expect(await canvas.findByText('● 正在跟随直播')).toBeVisible()
    await expect(canvas.getByText('运行中')).toBeVisible()
  },
}

export const AwaitingDiscretion: Story = {
  beforeEach: stage(
    events.filter((event) => event.seq <= 9),
    'waiting',
  ),
  play: async ({ canvas }) => {
    await expect(await screen.findByRole('dialog', { name: '手动裁量 D8' })).toBeVisible()
    await expect(canvas.getByText('等待手动裁量')).toBeVisible()
  },
}

export const PausedOnDecision: Story = {
  beforeEach: stage(
    [...live, { seq: 32, type: 'game.paused', seat: 1, error: '模型输出不合法' }],
    'paused',
  ),
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole('alert')).toHaveTextContent(/对局已暂停：1 号/)
    await expect(canvas.getByRole('button', { name: '继续' })).toBeEnabled()
  },
}

export const PausedOnPageClosed: Story = {
  beforeEach: stage(live, 'paused'),
  play: async ({ canvas }) => {
    await expect(await canvas.findByText(/运行对局的页面已关闭或刷新/)).toBeVisible()
  },
}

export const Ended: Story = {
  beforeEach: stage(events, 'ended', 'all_demons_dead'),
  play: async ({ canvas }) => {
    await expect(await canvas.findByText('回放')).toBeVisible()
    await expect(canvas.getByText('已结束')).toBeVisible()
    await expect(canvas.queryByRole('button', { name: '终止对局' })).not.toBeInTheDocument()
  },
}

export const Aborted: Story = {
  beforeEach: stage(
    [...live, { seq: 32, type: 'game.aborted', reason: 'human' }],
    'aborted',
    'human',
  ),
  play: async ({ canvas }) => {
    await expect(await canvas.findByText('回放')).toBeVisible()
    await expect(canvas.getByText('已终止')).toBeVisible()
  },
}
