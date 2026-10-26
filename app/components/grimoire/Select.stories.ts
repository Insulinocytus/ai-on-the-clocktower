import type { Meta, StoryObj } from '@storybook-vue/nuxt'
import { expect, screen, waitFor } from 'storybook/test'
import Select from './Select.vue'

type Props = Parameters<typeof Select>[0]

const meta = {
  args: {
    options: [
      { value: 'openai', label: 'OpenAI' },
      { value: 'anthropic', label: 'Anthropic' },
      { value: 'gemini', label: 'Gemini', disabled: true },
    ],
    placeholder: '选择格式',
  },
  render: (args) => ({
    components: { Select },
    setup: () => ({ args }),
    template: '<Select v-bind="args" v-model="args.modelValue" aria-label="格式" />',
  }),
} satisfies Meta<Props>

export default meta
type Story = StoryObj<typeof meta>

export const Placeholder: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('combobox', { name: '格式' })).toHaveTextContent('选择格式')
  },
}

export const ChooseOption: Story = {
  play: async ({ canvas, userEvent }) => {
    const trigger = canvas.getByRole('combobox', { name: '格式' })
    await userEvent.click(trigger)
    await userEvent.click(await screen.findByRole('option', { name: 'Anthropic' }))
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument())
    await expect(trigger).toHaveTextContent('Anthropic')
  },
}

export const DisabledOption: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('combobox', { name: '格式' }))
    await expect(await screen.findByRole('option', { name: 'Gemini' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    await userEvent.keyboard('{Escape}')
  },
}

export const Selected: Story = {
  args: { modelValue: 'openai' },
  play: async ({ canvas, userEvent }) => {
    const trigger = canvas.getByRole('combobox', { name: '格式' })
    await expect(trigger).toHaveTextContent('OpenAI')
    await userEvent.click(trigger)
    await expect(await screen.findByRole('option', { name: /OpenAI/ })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await userEvent.keyboard('{Escape}')
  },
}

export const Compact: Story = { args: { compact: true, modelValue: 'anthropic' } }

export const Invalid: Story = {
  args: { invalid: true },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('combobox', { name: '格式' })).toBeInvalid()
  },
}

export const Disabled: Story = {
  args: { disabled: true, modelValue: 'openai' },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('combobox', { name: '格式' })).toBeDisabled()
  },
}
