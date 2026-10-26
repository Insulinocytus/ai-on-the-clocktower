import type { Meta, StoryObj } from '@storybook-vue/nuxt'
import { expect, mocked } from 'storybook/test'
import { listPresets, listProviders } from '@/api'
import { presets } from '@/components/spectator.fixtures'
import Models from '@/pages/models.vue'
import { renderPage } from './page'

const meta = {
  title: 'Pages/Models',
  render: renderPage(Models, { path: '/models' }),
  parameters: { layout: 'fullscreen' },
  beforeEach: () => {
    mocked(listProviders).mockReset().mockResolvedValue([])
    mocked(listPresets).mockReset().mockResolvedValue([])
  },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

export const Empty: Story = {
  play: async ({ canvas }) => {
    await expect(await canvas.findByText('还没有提供商。')).toBeVisible()
    await expect(canvas.getByText('请先添加提供商。')).toBeVisible()
  },
}

export const Populated: Story = {
  beforeEach: () => {
    mocked(listProviders).mockResolvedValue([
      {
        id: 1,
        name: 'OpenRouter',
        baseUrl: 'https://openrouter.ai/api/v1',
        apiFormat: 'openai_completions',
        apiKey: 'sk-or',
        timeoutSec: 300,
        maxConcurrency: 5,
      },
    ])
    mocked(listPresets).mockResolvedValue(presets)
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole('rowheader', { name: 'OpenRouter' })).toBeVisible()
    await expect(canvas.getByRole('rowheader', { name: 'claude-sonnet' })).toBeVisible()
  },
}
