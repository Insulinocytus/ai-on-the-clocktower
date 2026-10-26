import type { Meta, StoryObj } from '@storybook-vue/nuxt'
import { expect } from 'storybook/test'
import { ref } from 'vue'
import Textarea from './Textarea.vue'

const meta = {
  component: Textarea,
  render: (args) => ({
    components: { Textarea },
    setup: () => ({ args }),
    template:
      '<Textarea v-model="args.modelValue" aria-label="附加请求体" rows="3" placeholder="{}" />',
  }),
} satisfies Meta<typeof Textarea>

export default meta
type Story = StoryObj<typeof meta>

export const Empty: Story = {
  play: async ({ canvas, userEvent }) => {
    const textarea = canvas.getByRole('textbox', { name: '附加请求体' })
    await userEvent.type(textarea, 'a{enter}b')
    await expect(textarea).toHaveValue('a\nb')
  },
}

export const Filled: Story = {
  args: { modelValue: '{\n  "temperature": 0.7\n}' },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('textbox', { name: '附加请求体' })).toHaveValue(
      '{\n  "temperature": 0.7\n}',
    )
  },
}

export const Disabled: Story = {
  render: () => ({
    components: { Textarea },
    setup: () => ({ value: ref('{}') }),
    template: '<Textarea v-model="value" aria-label="附加请求体" rows="3" disabled />',
  }),
}
