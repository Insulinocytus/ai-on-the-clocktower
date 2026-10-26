import type { Meta, StoryObj } from '@storybook-vue/nuxt'
import { expect, screen } from 'storybook/test'
import { ref } from 'vue'
import { setupSample } from './spectator.fixtures'
import { ROLES } from '#shared/game/roles'
import type { RoleId } from '#shared/types/game'
import SpectatorSetup from './SpectatorSetup.vue'

const meta = {
  component: SpectatorSetup,
  args: { seatCount: 5, candidates: { type: 'setup', sample: setupSample }, roles: [] },
  render: (args) => ({
    components: { SpectatorSetup },
    setup: () => ({ args, choice: ref<RoleId[]>(), roles: ref<string[]>([]) }),
    template: '<SpectatorSetup v-bind="args" v-model="choice" v-model:roles="roles" />',
  }),
} satisfies Meta<typeof SpectatorSetup>

export default meta
type Story = StoryObj<typeof meta>

export const Empty: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getAllByRole('combobox')).toHaveLength(5)
    await expect(canvas.getByText('镇民: 0 / 3')).toBeVisible()
    await expect(canvas.getByText('请为每个座位选择角色。')).toBeVisible()
  },
}

export const RandomFill: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: '随机填一份' }))
    await expect(await canvas.findByText('配置合法，可以确认。')).toBeVisible()
    await expect(canvas.queryByText('请为每个座位选择角色。')).not.toBeInTheDocument()
  },
}

export const DuplicateRole: Story = {
  play: async ({ canvas, userEvent }) => {
    for (const seat of ['1 号座位', '2 号座位']) {
      await userEvent.click(canvas.getByRole('combobox', { name: seat }))
      await userEvent.click(await screen.findByRole('option', { name: ROLES.soldier.name.zh }))
    }
    await expect(await canvas.findByText('角色不能重复。')).toBeVisible()
    await expect(canvas.queryByText('配置合法，可以确认。')).not.toBeInTheDocument()
  },
}

export const BaronAdjustment: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('combobox', { name: '1 号座位' }))
    await userEvent.click(await screen.findByRole('option', { name: ROLES.baron.name.zh }))
    await expect(await canvas.findByText('男爵修正：镇民 −2，外来者 +2。')).toBeVisible()
    await expect(canvas.getByText('镇民: 0 / 1')).toBeVisible()
    await expect(canvas.getByText('外来者: 0 / 2')).toBeVisible()
  },
}

export const Seating: Story = {
  args: { candidates: { type: 'seating', sample: setupSample, roles: setupSample } },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('combobox', { name: '1 号座位' }))
    await expect(await screen.findAllByRole('option')).toHaveLength(setupSample.length)
    await userEvent.keyboard('{Escape}')
    await userEvent.click(canvas.getByRole('button', { name: '随机填一份' }))
    await expect(await canvas.findByText('配置合法，可以确认。')).toBeVisible()
  },
}

export const English: Story = {
  globals: { locale: 'en' },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button', { name: 'Fill randomly' })).toBeVisible()
    await expect(canvas.getByText('Townsfolk: 0 / 3')).toBeVisible()
    await expect(canvas.getByRole('combobox', { name: 'Seat 1' })).toBeVisible()
  },
}
