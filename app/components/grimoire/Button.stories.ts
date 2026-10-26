import type { Meta, StoryObj } from '@storybook-vue/nuxt'
import { expect, fn } from 'storybook/test'
import Button from './Button.vue'

const onClick = fn()

const meta = {
  component: Button,
  render: (args) => ({
    components: { Button },
    setup: () => ({ args, onClick }),
    template: '<Button v-bind="args" @click="onClick">开始对局</Button>',
  }),
  beforeEach: () => {
    onClick.mockClear()
  },
} satisfies Meta<typeof Button>

export default meta
type Story = StoryObj<typeof meta>

export const Primary: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: '开始对局' }))
    await expect(onClick).toHaveBeenCalledOnce()
  },
}

export const Secondary: Story = { args: { variant: 'secondary' } }

export const Disabled: Story = {
  args: { disabled: true },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button', { name: '开始对局' })).toBeDisabled()
  },
}
