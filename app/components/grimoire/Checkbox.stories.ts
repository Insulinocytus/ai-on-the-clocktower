import type { Meta, StoryObj } from '@storybook-vue/nuxt'
import { expect } from 'storybook/test'
import Checkbox from './Checkbox.vue'

const meta = {
  component: Checkbox,
  render: (args) => ({
    components: { Checkbox },
    setup: () => ({ args }),
    template: '<Checkbox v-bind="args" v-model="args.modelValue" aria-label="启用提供商" />',
  }),
} satisfies Meta<typeof Checkbox>

export default meta
type Story = StoryObj<typeof meta>

export const Unchecked: Story = {
  play: async ({ canvas, userEvent }) => {
    const checkbox = canvas.getByRole('checkbox', { name: '启用提供商' })
    await expect(checkbox).not.toBeChecked()
    await userEvent.click(checkbox)
    await expect(checkbox).toBeChecked()
    await userEvent.click(checkbox)
    await expect(checkbox).not.toBeChecked()
  },
}

export const Checked: Story = {
  args: { modelValue: true },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('checkbox', { name: '启用提供商' })).toBeChecked()
  },
}

export const Disabled: Story = {
  args: { disabled: true },
  play: async ({ canvas, userEvent }) => {
    const checkbox = canvas.getByRole('checkbox', { name: '启用提供商' })
    await expect(checkbox).toBeDisabled()
    await userEvent.click(checkbox)
    await expect(checkbox).not.toBeChecked()
  },
}
