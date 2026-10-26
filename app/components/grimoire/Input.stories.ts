import type { Meta, StoryObj } from '@storybook-vue/nuxt'
import { expect } from 'storybook/test'
import { ref } from 'vue'
import Input from './Input.vue'

const meta = {
  component: Input,
  render: (args) => ({
    components: { Input },
    setup: () => ({ args }),
    template: '<Input v-model="args.modelValue" aria-label="名称" placeholder="例如 OpenAI" />',
  }),
} satisfies Meta<typeof Input>

export default meta
type Story = StoryObj<typeof meta>

export const Empty: Story = {
  play: async ({ canvas, userEvent }) => {
    const input = canvas.getByRole('textbox', { name: '名称' })
    await userEvent.type(input, 'Claude')
    await expect(input).toHaveValue('Claude')
  },
}

export const Filled: Story = {
  args: { modelValue: 'OpenAI' },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('textbox', { name: '名称' })).toHaveValue('OpenAI')
  },
}

export const NumberValue: Story = {
  render: () => ({
    components: { Input },
    setup: () => ({ value: ref(3) }),
    template: '<Input v-model="value" type="number" aria-label="次数" />',
  }),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('spinbutton', { name: '次数' })).toHaveValue(3)
  },
}

export const Invalid: Story = {
  render: () => ({
    components: { Input },
    setup: () => ({ value: ref('') }),
    template: '<Input v-model="value" aria-label="名称" aria-invalid="true" />',
  }),
}

export const Disabled: Story = {
  render: () => ({
    components: { Input },
    setup: () => ({ value: ref('OpenAI') }),
    template: '<Input v-model="value" aria-label="名称" disabled />',
  }),
}
