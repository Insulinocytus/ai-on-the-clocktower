import type { Meta, StoryObj } from '@storybook-vue/nuxt'
import { expect, screen, waitFor } from 'storybook/test'
import { reactive } from 'vue'
import SpectatorControls from './SpectatorControls.vue'

const meta = {
  component: SpectatorControls,
  args: { seatCount: 5, observer: 'spectator', losing: false },
  render: (args) => ({
    components: { SpectatorControls },
    setup: () => ({ state: reactive({ ...args }) }),
    template: `
      <SpectatorControls
        :seat-count="state.seatCount"
        v-model:observer="state.observer"
        v-model:losing="state.losing"
      />
    `,
  }),
} satisfies Meta<typeof SpectatorControls>

export default meta
type Story = StoryObj<typeof meta>

export const Omniscient: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('combobox', { name: '观战视角' })).toHaveTextContent('上帝视角')
    await expect(canvas.getByRole('checkbox', { name: '落选决策' })).not.toBeChecked()
  },
}

export const Storyteller: Story = {
  args: { observer: 'storyteller' },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('combobox', { name: '观战视角' })).toHaveTextContent('说书人视角')
  },
}

export const SeatView: Story = {
  args: { observer: 'seat:3' },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('combobox', { name: '观战视角' })).toHaveTextContent('3 号视角')
  },
}

export const PublicOnly: Story = {
  args: { observer: 'public' },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('combobox', { name: '观战视角' })).toHaveTextContent('仅公开信息')
  },
}

export const ChoosePerspective: Story = {
  play: async ({ canvas, userEvent }) => {
    const trigger = canvas.getByRole('combobox', { name: '观战视角' })
    await userEvent.click(trigger)
    await expect(await screen.findAllByRole('option')).toHaveLength(8)
    await userEvent.click(screen.getByRole('option', { name: '3 号视角' }))
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument())
    await expect(trigger).toHaveTextContent('3 号视角')
  },
}

export const ShowLosing: Story = {
  play: async ({ canvas, userEvent }) => {
    const checkbox = canvas.getByRole('checkbox', { name: '落选决策' })
    await userEvent.click(checkbox)
    await expect(checkbox).toBeChecked()
  },
}

export const FifteenSeats: Story = {
  args: { seatCount: 15 },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('combobox', { name: '观战视角' }))
    await expect(await screen.findAllByRole('option')).toHaveLength(18)
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument())
  },
}

export const English: Story = {
  globals: { locale: 'en' },
  args: { observer: 'seat:2' },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('combobox', { name: 'Perspective' })).toHaveTextContent(
      'Seat 2 view',
    )
    await expect(canvas.getByRole('checkbox', { name: 'Unselected decisions' })).toBeVisible()
  },
}
