import type { Meta, StoryObj } from '@storybook-vue/nuxt'
import { expect } from 'storybook/test'
import { eventProps } from './spectator.fixtures'
import SpectatorEvent from './SpectatorEvent.vue'

const meta = {
  component: SpectatorEvent,
  args: eventProps(17),
  render: (args) => ({
    components: { SpectatorEvent },
    setup: () => ({ args }),
    template: '<ol><SpectatorEvent v-bind="args" /></ol>',
  }),
} satisfies Meta<typeof SpectatorEvent>

export default meta
type Story = StoryObj<typeof meta>

export const Speech: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByText(/我是士兵，今晚恶魔杀不了我/)).toBeVisible()
  },
}

export const Narration: Story = {
  args: eventProps(24),
  play: async ({ canvas }) => {
    await expect(canvas.getByText(/第 2 天黎明：昨夜死亡的是3 号/)).toBeVisible()
  },
}

export const ContestantDecision: Story = {
  // scrollable-region-focusable: the raw-response block scrolls but is not focusable (known component bug)
  parameters: { a11y: { test: 'todo' } },
  args: eventProps(16),
  play: async ({ canvas, userEvent }) => {
    await expect(canvas.getByText('1 号的推理摘要')).toBeVisible()
    await expect(
      canvas.getByText('我是士兵，先公开身份，让好人知道谁不会被恶魔杀死。'),
    ).toBeVisible()
    await expect(canvas.getByText(/deepseek-chat · 1840 ms · 第 1 次尝试/)).toBeVisible()
    const raw = canvas.getByText('原始响应')
    await userEvent.click(raw)
    await expect(canvas.getByText(/"tool_calls"/)).toBeVisible()
  },
}

export const StorytellerDecision: Story = {
  args: eventProps(21, 'storyteller'),
  play: async ({ canvas }) => {
    await expect(canvas.getByText('说书人的推理摘要')).toBeVisible()
    await expect(canvas.getByText('共情者未被保护，击杀成立。')).toBeVisible()
  },
}

export const Pass: Story = {
  args: eventProps(27),
  play: async ({ canvas }) => {
    await expect(canvas.getByText('pass（不行动）')).toBeVisible()
  },
}

export const Unselected: Story = {
  // color-contrast: muted unselected text is 2.44:1 (known component bug)
  parameters: { a11y: { test: 'todo' } },
  args: eventProps(18, 'spectator', true),
  play: async ({ canvas }) => {
    await expect(canvas.getByText('未选中')).toBeVisible()
    await expect(canvas.getByText('我暂时没有信息可分享。')).toBeVisible()
  },
}

export const FalseInformation: Story = {
  args: eventProps(12),
  play: async ({ canvas }) => {
    await expect(canvas.getByText('此信息为假')).toHaveAttribute(
      'title',
      '该座位已中毒，能力无效。',
    )
  },
}

export const FalseInformationHiddenFromSeat: Story = {
  args: eventProps(12, 'seat:2'),
  play: async ({ canvas }) => {
    await expect(canvas.getByText(/你/)).toBeVisible()
    await expect(canvas.queryByText('此信息为假')).not.toBeInTheDocument()
  },
}

export const English: Story = {
  globals: { locale: 'en' },
  args: eventProps(26, 'storyteller'),
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Seat 2 reasoning summary')).toBeVisible()
  },
}
