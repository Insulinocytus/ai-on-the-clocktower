import type { Meta, StoryObj } from '@storybook-vue/nuxt'
import { expect, fn } from 'storybook/test'
import { computed } from 'vue'
import { config, perspective } from './spectator.fixtures'
import { ROLES } from '#shared/game/roles'
import SpectatorRing from './SpectatorRing.vue'

const onFocus = fn()

function view(options: Parameters<typeof perspective>[0]) {
  const { grimoire, publicState, events, selected } = perspective(options)
  return { grimoire, publicState, events, title: selected.title }
}

const meta = {
  component: SpectatorRing,
  args: { config, focusedSeat: undefined, ...view({ kind: 'first-night' }) },
  render: (args) => ({
    components: { SpectatorRing },
    setup: () => {
      // Fixture titles are i18n keys; resolving them in setup keeps them on the active locale.
      const { t } = useI18n()
      return { args, title: computed(() => t(args.title)), onFocus }
    },
    template: `
      <div class="h-175 w-190">
        <SpectatorRing v-bind="args" :title="title" @focus="onFocus" />
      </div>
    `,
  }),
  // label-content-name-mismatch: seat aria-label omits visible text (known component bug)
  parameters: { a11y: { test: 'todo' } },
  beforeEach: () => {
    onFocus.mockClear()
  },
} satisfies Meta<typeof SpectatorRing>

export default meta
type Story = StoryObj<typeof meta>

export const FirstNight: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByText('存活 5 / 5 人')).toBeVisible()
    await expect(canvas.getByRole('button', { name: '2 号足迹' })).toHaveTextContent(
      ROLES.chef.name.zh,
    )
    await expect(canvas.getByText('中毒')).toBeVisible()
  },
}

export const ExecutionPending: Story = {
  args: view({ through: 31 }),
  play: async ({ canvas }) => {
    await expect(canvas.getByText('存活 4 / 5 人')).toBeVisible()
    await expect(canvas.getByText('过半门槛：2 票')).toBeVisible()
    await expect(canvas.getByText('5 号即将被处决')).toBeVisible()
    await expect(canvas.getByRole('button', { name: '3 号足迹' })).toHaveTextContent(
      '已死亡 · 死者票已用',
    )
  },
}

export const Ended: Story = {
  args: view({}),
  play: async ({ canvas }) => {
    await expect(canvas.getByText('存活 3 / 5 人')).toBeVisible()
    await expect(canvas.queryByText('5 号即将被处决')).not.toBeInTheDocument()
  },
}

export const SeatPerspective: Story = {
  args: view({ observer: 'seat:3' }),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button', { name: '3 号足迹' })).toHaveTextContent(
      ROLES.empath.name.zh,
    )
    await expect(canvas.getAllByText('角色未知')).toHaveLength(4)
  },
}

export const PublicOnly: Story = {
  args: view({ observer: 'public' }),
  play: async ({ canvas }) => {
    await expect(canvas.getAllByText('角色未知')).toHaveLength(5)
  },
}

export const FocusedSeat: Story = {
  args: { focusedSeat: 2 },
  play: async ({ canvas, userEvent }) => {
    await expect(canvas.getByRole('button', { name: '2 号足迹' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await userEvent.click(canvas.getByRole('button', { name: '4 号足迹' }))
    await expect(onFocus).toHaveBeenCalledWith(4)
  },
}

export const English: Story = {
  globals: { locale: 'en' },
  args: view({ through: 31 }),
  play: async ({ canvas }) => {
    await expect(canvas.getByText('4 / 5 alive')).toBeVisible()
    await expect(canvas.getByText('Seat 5 about to be executed')).toBeVisible()
  },
}
