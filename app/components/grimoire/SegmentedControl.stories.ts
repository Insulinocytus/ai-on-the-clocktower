import type { Meta, StoryObj } from '@storybook-vue/nuxt'
import { expect, waitFor } from 'storybook/test'
import SegmentedControl from './SegmentedControl.vue'

type Props = Parameters<typeof SegmentedControl>[0]

const meta = {
  args: {
    options: [
      { value: 'ai', label: 'AI' },
      { value: 'human', label: '真人' },
      { value: 'random', label: '随机' },
    ],
  },
  render: (args) => ({
    components: { SegmentedControl },
    setup: () => ({ args }),
    template: '<SegmentedControl v-bind="args" v-model="args.modelValue" aria-label="来源" />',
  }),
} satisfies Meta<Props>

export default meta
type Story = StoryObj<typeof meta>

export const Unselected: Story = {
  play: async ({ canvas, userEvent }) => {
    await expect(canvas.queryByRole('radio', { checked: true })).not.toBeInTheDocument()
    await userEvent.click(canvas.getByRole('radio', { name: '真人' }))
    await expect(canvas.getByRole('radio', { name: '真人' })).toBeChecked()
  },
}

export const Selected: Story = {
  args: { modelValue: 'ai' },
  play: async ({ canvas, userEvent }) => {
    await expect(canvas.getByRole('radio', { name: 'AI' })).toBeChecked()
    await userEvent.click(canvas.getByRole('radio', { name: '随机' }))
    await expect(canvas.getByRole('radio', { name: '随机' })).toBeChecked()
    await expect(canvas.getByRole('radio', { name: 'AI' })).not.toBeChecked()
  },
}

export const Keyboard: Story = {
  args: { modelValue: 'ai' },
  play: async ({ canvas, userEvent }) => {
    await userEvent.tab()
    await userEvent.keyboard('{ArrowRight>}')
    await waitFor(() => expect(canvas.getByRole('radio', { name: '真人' })).toBeChecked())
    await userEvent.keyboard('{/ArrowRight}')
  },
}
