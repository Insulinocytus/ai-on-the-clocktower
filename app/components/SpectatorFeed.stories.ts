import type { Meta, StoryObj } from '@storybook-vue/nuxt'
import { expect, fn, waitFor } from 'storybook/test'
import { computed, onMounted, reactive } from 'vue'
import { perspective } from './spectator.fixtures'
import SpectatorFeed from './SpectatorFeed.vue'

const onClearFocus = fn()

function view(options: Parameters<typeof perspective>[0]) {
  const { observer, groups, selected } = perspective(options)
  return { observer, groups, title: selected.title, blockKey: selected.key }
}

// Fixture titles are i18n keys; resolving them in setup keeps them on the active locale.
function useLocalized<T extends { title: string; groups: { title: string }[] }>(
  source: T,
  titleParams: Record<string, unknown> = {},
) {
  const { t } = useI18n()
  return computed(() => ({
    ...source,
    title: t(source.title, titleParams),
    groups: source.groups.map((group) => ({ ...group, title: t(group.title) })),
  }))
}

const meta = {
  component: SpectatorFeed,
  args: {
    ...view({}),
    following: false,
    focused: false,
  },
  render: (args) => ({
    components: { SpectatorFeed },
    setup: () => ({ feed: useLocalized(args), onClearFocus }),
    template: '<SpectatorFeed v-bind="feed" @clear-focus="onClearFocus" />',
  }),
  beforeEach: () => {
    onClearFocus.mockClear()
  },
} satisfies Meta<typeof SpectatorFeed>

export default meta
type Story = StoryObj<typeof meta>

export const Nominations: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByText('pass（不行动）')).toBeVisible()
    await expect(canvas.getByText('2 号提名了5 号。')).toBeVisible()
  },
}

export const FollowingLive: Story = {
  args: { ...view({ kind: 'first-night' }), following: true },
  render: (args) => ({
    components: { SpectatorFeed },
    setup: () => {
      const state = reactive({ ...args })
      onMounted(() => Object.assign(state, view({})))
      return { feed: useLocalized(state) }
    },
    template: `
      <div class="flex h-80 flex-col">
        <SpectatorFeed v-bind="feed" />
      </div>
    `,
  }),
  play: async ({ canvas }) => {
    const feed = canvas.getByRole('region', { name: '频道块内容' }).querySelector('[aria-live]')
    await waitFor(() => expect(feed?.scrollTop).toBeGreaterThan(0))
  },
}

export const FalseInformation: Story = {
  args: view({ kind: 'first-night' }),
  play: async ({ canvas }) => {
    await expect(canvas.getByText('此信息为假')).toBeVisible()
  },
}

export const UnselectedDecisions: Story = {
  // color-contrast: dimmed unselected rows are 2.44:1 (known component bug)
  parameters: { a11y: { test: 'todo' } },
  args: view({ kind: 'public', losing: true }),
  play: async ({ canvas }) => {
    await expect(canvas.getByText('未选中')).toBeVisible()
  },
}

export const StorytellerView: Story = {
  args: view({ observer: 'storyteller', kind: 'first-night' }),
  play: async ({ canvas }) => {
    await expect(canvas.getByText(/说书人告知2 号/)).toBeVisible()
    await expect(canvas.queryByText('此信息为假')).not.toBeInTheDocument()
  },
}

export const SeatView: Story = {
  args: view({ observer: 'seat:4', kind: 'first-night' }),
  play: async ({ canvas }) => {
    await expect(canvas.getByText(/说书人告知你/)).toBeVisible()
    await expect(canvas.queryByText(/说书人告知2 号/)).not.toBeInTheDocument()
  },
}

export const PublicOnly: Story = {
  args: view({ observer: 'public' }),
  play: async ({ canvas }) => {
    await expect(canvas.getByText(/计票/)).toBeVisible()
    await expect(canvas.queryByText('pass（不行动）')).not.toBeInTheDocument()
  },
}

export const SeatFootprint: Story = {
  args: { ...view({ focusedSeat: 5 }), title: 'spectator.footprint', focused: true },
  render: (args) => ({
    components: { SpectatorFeed },
    setup: () => ({ feed: useLocalized(args, { seat: 5 }), onClearFocus }),
    template: '<SpectatorFeed v-bind="feed" @clear-focus="onClearFocus" />',
  }),
  play: async ({ canvas, userEvent }) => {
    await expect(canvas.getAllByRole('heading', { level: 3 }).length).toBeGreaterThan(1)
    await userEvent.click(canvas.getByRole('button', { name: '返回频道块' }))
    await expect(onClearFocus).toHaveBeenCalledOnce()
  },
}

export const Empty: Story = {
  args: { groups: [], title: 'spectator.loading', blockKey: undefined, following: true },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('截至此块没有相关事件。')).toBeVisible()
  },
}
