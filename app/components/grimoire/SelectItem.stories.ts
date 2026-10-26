import type { Meta, StoryObj } from '@storybook-vue/nuxt'
import { expect, screen } from 'storybook/test'
import {
  SelectContent,
  SelectPortal,
  SelectRoot,
  SelectTrigger,
  SelectValue,
  SelectViewport,
} from 'reka-ui'
import SelectItem from './SelectItem.vue'

const meta = {
  component: SelectItem,
  args: { value: 'night' },
  render: (args) => ({
    components: {
      SelectContent,
      SelectItem,
      SelectPortal,
      SelectRoot,
      SelectTrigger,
      SelectValue,
      SelectViewport,
    },
    setup: () => ({ args }),
    template: `
      <SelectRoot default-open default-value="night">
        <SelectTrigger class="grimoire-field" aria-label="主题"><SelectValue /></SelectTrigger>
        <SelectPortal>
          <SelectContent class="grimoire-select-content" position="popper" :side-offset="6">
            <SelectViewport class="grimoire-select-viewport">
              <SelectItem v-bind="args">夜间</SelectItem>
            </SelectViewport>
          </SelectContent>
        </SelectPortal>
      </SelectRoot>
    `,
  }),
} satisfies Meta<typeof SelectItem>

export default meta
type Story = StoryObj<typeof meta>

export const Selected: Story = {
  play: async ({ userEvent }) => {
    const option = await screen.findByRole('option', { name: /夜间/ })
    await expect(option).toHaveAttribute('aria-selected', 'true')
    await expect(option).toHaveTextContent('✓')
    await userEvent.keyboard('{Escape}')
  },
}

export const Unselected: Story = {
  args: { value: 'day' },
  play: async ({ userEvent }) => {
    const option = await screen.findByRole('option', { name: '夜间' })
    await expect(option).toHaveAttribute('aria-selected', 'false')
    await expect(option).not.toHaveTextContent('✓')
    await userEvent.keyboard('{Escape}')
  },
}

export const Disabled: Story = {
  args: { value: 'day', disabled: true },
  play: async ({ userEvent }) => {
    await expect(await screen.findByRole('option', { name: '夜间' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    await userEvent.keyboard('{Escape}')
  },
}
