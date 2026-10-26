import type { Meta, StoryObj } from '@storybook-vue/nuxt'
import { expect, mocked } from 'storybook/test'
import { getGame, listPresets } from '@/api'
import { presets } from '@/components/spectator.fixtures'
import NewGame from '@/pages/games/new.vue'
import { renderPage } from './page'

const meta = {
  title: 'Pages/New Game',
  render: renderPage(NewGame, { path: '/games/new' }),
  parameters: { layout: 'fullscreen' },
  beforeEach: () => {
    mocked(listPresets).mockReset().mockResolvedValue(presets)
  },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

export const WithPresets: Story = {
  play: async ({ canvas }) => {
    await expect(await canvas.findByText('1 号座位还没选模型预设。')).toBeVisible()
    await expect(canvas.queryByText('还没有模型预设。')).not.toBeInTheDocument()
  },
}

export const NoPresets: Story = {
  beforeEach: () => {
    mocked(listPresets).mockResolvedValue([])
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText(/还没有模型预设。/)).toBeVisible()
  },
}

export const TemplateUnavailable: Story = {
  render: renderPage(NewGame, { path: '/games/new', query: { template: 'gone-1234' } }),
  beforeEach: () => {
    mocked(getGame).mockReset().mockRejectedValue(new Error('对局不存在'))
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole('alert')).toHaveTextContent('对局不存在')
  },
}
