import type { Meta, StoryObj } from '@storybook-vue/nuxt'
import { expect } from 'storybook/test'
import Topbar from './Topbar.vue'

const meta = {
  component: Topbar,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof Topbar>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('link', { name: '对局' })).toHaveAttribute('href', '/games')
    await expect(canvas.getByRole('link', { name: '模型' })).toHaveAttribute('href', '/models')
  },
}

export const English: Story = {
  globals: { locale: 'en' },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('link', { name: 'Games' })).toBeVisible()
  },
}

export const ToggleLanguage: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button'))
    await expect(await canvas.findByRole('link', { name: 'Games' })).toBeVisible()
  },
}
