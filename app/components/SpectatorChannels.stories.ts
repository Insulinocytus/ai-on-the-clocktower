import type { Meta, StoryObj } from '@storybook-vue/nuxt'
import { expect, fn, waitFor } from 'storybook/test'
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

const longGame = Array.from({ length: 8 }, (_, index) =>
  live.blocks.map((block) => ({
    ...block,
    key: `${block.key}-day${String(index + 1)}`,
    day: index + 1,
    end: block.end + index * 40,
  })),
).flat()

export const ManyDaysScroll: Story = {
  args: { blocks: longGame, selected: longGame.at(-1)?.key },
  play: async ({ canvas, canvasElement }) => {
    const strip = canvasElement.querySelector('ol')?.parentElement
    await expect(strip?.scrollWidth).toBeGreaterThan(strip?.clientWidth ?? Infinity)
    const current = canvas.getByRole('button', { current: 'step' })
    await waitFor(() => {
      const box = current.getBoundingClientRect()
      const view = strip?.getBoundingClientRect()
      return expect(view && box.right <= view.right + 1 && box.left >= view.left - 1).toBe(true)
    })
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
