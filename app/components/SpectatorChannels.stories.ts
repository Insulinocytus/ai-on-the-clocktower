import type { Meta, StoryObj } from '@storybook-vue/nuxt'
import { expect, fn } from 'storybook/test'
import { computed, reactive } from 'vue'
import { perspective } from './spectator.fixtures'
import SpectatorChannels from './SpectatorChannels.vue'

const onSelect = fn()
const live = perspective()

// Fixture titles are i18n keys; resolving them in setup keeps them on the active locale.
function useLocalizedBlocks<T extends { title: string }>(source: { blocks: T[] }) {
  const { t } = useI18n()
  return computed(() => source.blocks.map((block) => ({ ...block, title: t(block.title) })))
}

const meta = {
  component: SpectatorChannels,
  args: { blocks: live.blocks, selected: live.selected.key },
  render: (args) => ({
    components: { SpectatorChannels },
    setup: () => {
      const state = reactive({ ...args })
      const blocks = useLocalizedBlocks(args)
      const select = (key: string) => {
        state.selected = key
        onSelect(key)
      }
      return { state, blocks, select }
    },
    template: '<SpectatorChannels :blocks="blocks" :selected="state.selected" @select="select" />',
  }),
  beforeEach: () => {
    onSelect.mockClear()
  },
} satisfies Meta<typeof SpectatorChannels>

export default meta
type Story = StoryObj<typeof meta>

export const LatestBlockSelected: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getAllByRole('listitem')).toHaveLength(live.blocks.length)
    await expect(canvas.getByRole('button', { name: /提名/ })).toHaveAttribute(
      'aria-current',
      'step',
    )
  },
}

export const SelectBlock: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: /首夜/ }))
    await expect(onSelect).toHaveBeenCalledWith(
      live.blocks.find((b) => b.kind === 'first-night')?.key,
    )
  },
}

const seat = perspective({ observer: 'seat:4' })

export const SeatPerspective: Story = {
  args: { blocks: seat.blocks, selected: seat.selected.key },
  play: async ({ canvas }) => {
    await expect(canvas.getAllByRole('listitem')).toHaveLength(seat.blocks.length)
  },
}

export const Loading: Story = {
  args: { blocks: [], selected: undefined },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('等待事件…')).toBeVisible()
  },
}

export const English: Story = {
  globals: { locale: 'en' },
  args: { selected: live.blocks[1]?.key },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('navigation', { name: 'Channel blocks' })).toBeVisible()
    await expect(canvas.getByRole('button', { name: /First night/ })).toHaveAttribute(
      'aria-current',
      'step',
    )
  },
}
