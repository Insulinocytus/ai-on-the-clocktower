import type { Meta, StoryObj } from '@storybook-vue/nuxt'
import { expect, mocked } from 'storybook/test'
import { listGames } from '@/api'
import { gameSummary as game } from '@/components/spectator.fixtures'
import GamesIndex from '@/pages/games/index.vue'
import { renderPage } from './page'

const meta = {
  title: 'Pages/Games',
  render: renderPage(GamesIndex, { path: '/games' }),
  parameters: { layout: 'fullscreen' },
  beforeEach: () => {
    mocked(listGames).mockReset().mockResolvedValue([])
  },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

export const Empty: Story = {
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole('heading', { name: '还没有对局' })).toBeVisible()
  },
}

export const AllStatuses: Story = {
  beforeEach: () => {
    mocked(listGames).mockResolvedValue([
      game('a1running', 'running'),
      game('b2waiting', 'waiting'),
      game('c3paused0', 'paused'),
      game('d4ended00', 'ended', 'all_demons_dead'),
      game('e5aborted', 'aborted', 'human'),
      { ...game('f6oldengn', 'ended', 'mayor'), compatible: false },
    ])
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText('等待手动裁量')).toBeVisible()
    for (const label of ['运行中', '已暂停', '已结束', '已终止', '引擎版本不兼容，无法回放。'])
      await expect(canvas.getByText(label)).toBeVisible()
  },
}
