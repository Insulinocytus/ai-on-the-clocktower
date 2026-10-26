import type { Meta, StoryObj } from '@storybook-vue/nuxt'
import { expect, fn, mocked, screen, waitFor } from 'storybook/test'
import { reactive } from 'vue'
import { ManualDiscretionConflictError, submitManualDiscretion } from '@/api'
import Toaster from '@/components/grimoire/Toaster.vue'
import { config, events, manualRequest, setupRequest } from './spectator.fixtures'
import SpectatorDiscretion from './SpectatorDiscretion.vue'

const onSubmitted = fn()
const onAbort = fn()

const meta = {
  component: SpectatorDiscretion,
  args: {
    open: true,
    gameId: 'game-1',
    config,
    request: manualRequest,
    events,
    aborting: false,
  },
  render: (args) => ({
    components: { SpectatorDiscretion, Toaster },
    setup: () => ({ state: reactive({ ...args }), onSubmitted, onAbort }),
    template: `
      <SpectatorDiscretion
        v-bind="state"
        v-model:open="state.open"
        @submitted="onSubmitted"
        @abort="onAbort"
      />
      <Toaster />
    `,
  }),
  // scrollable-region-focusable: the candidate table scrolls but is not focusable (known component bug)
  parameters: { a11y: { test: 'todo' } },
  beforeEach: () => {
    onSubmitted.mockClear()
    onAbort.mockClear()
    mocked(submitManualDiscretion).mockReset().mockResolvedValue({ choice: 0 })
  },
} satisfies Meta<typeof SpectatorDiscretion>

export default meta
type Story = StoryObj<typeof meta>

function conflict(choice?: number) {
  const data = { status: 'running', ...(choice === undefined ? {} : { choice }) }
  // The automocked constructor is a no-op, so `data` must be set by hand.
  return Object.assign(new ManualDiscretionConflictError(data), { data })
}

export const Candidates: Story = {
  play: async () => {
    const dialog = await screen.findByRole('dialog', { name: '手动裁量 D8' })
    await expect(dialog).toBeVisible()
    await expect(screen.getAllByRole('row')).toHaveLength(config.seatCount + 1)
    await expect(screen.getByText('中毒')).toBeVisible()
    await expect(screen.getByText(/2 号座位/)).toBeVisible()
    await expect(screen.getByText(/— 厨师/)).toBeVisible()
    await expect(screen.getByRole('button', { name: '确认选择' })).toBeDisabled()
  },
}

export const SubmitChoice: Story = {
  play: async ({ userEvent }) => {
    await screen.findByRole('dialog')
    await userEvent.click(screen.getByRole('combobox', { name: '选择合法候选' }))
    await userEvent.click(await screen.findByRole('option', { name: '0' }))
    await userEvent.click(screen.getByRole('button', { name: '确认选择' }))
    await waitFor(() => expect(onSubmitted).toHaveBeenCalledOnce())
    await expect(submitManualDiscretion).toHaveBeenCalledWith('game-1', 9, 0)
  },
}

export const ConflictAlreadySubmitted: Story = {
  beforeEach: () => {
    mocked(submitManualDiscretion).mockRejectedValue(conflict(1))
  },
  play: async ({ userEvent }) => {
    await screen.findByRole('dialog')
    await userEvent.click(screen.getByRole('combobox', { name: '选择合法候选' }))
    await userEvent.click(await screen.findByRole('option', { name: '2' }))
    await userEvent.click(screen.getByRole('button', { name: '确认选择' }))
    await expect(await screen.findByText('已在别处提交为 1，按服务器结果继续')).toBeInTheDocument()
    await expect(onSubmitted).toHaveBeenCalledOnce()
  },
}

export const ConflictExpired: Story = {
  beforeEach: () => {
    mocked(submitManualDiscretion).mockRejectedValue(conflict())
  },
  play: async ({ userEvent }) => {
    await screen.findByRole('dialog')
    await userEvent.click(screen.getByRole('combobox', { name: '选择合法候选' }))
    await userEvent.click(await screen.findByRole('option', { name: '2' }))
    await userEvent.click(screen.getByRole('button', { name: '确认选择' }))
    await expect(
      await screen.findByText('已在别处提交为 已过期或已终止，按服务器结果继续'),
    ).toBeInTheDocument()
    await expect(onSubmitted).toHaveBeenCalledOnce()
  },
}

export const SubmitFailure: Story = {
  beforeEach: () => {
    mocked(submitManualDiscretion).mockRejectedValue(new Error('Server unavailable'))
  },
  play: async ({ userEvent }) => {
    await screen.findByRole('dialog')
    await userEvent.click(screen.getByRole('combobox', { name: '选择合法候选' }))
    await userEvent.click(await screen.findByRole('option', { name: '1' }))
    await userEvent.click(screen.getByRole('button', { name: '确认选择' }))
    await expect(await screen.findByText('Server unavailable')).toBeInTheDocument()
    await expect(onSubmitted).not.toHaveBeenCalled()
    await expect(screen.getByRole('button', { name: '确认选择' })).toBeEnabled()
  },
}

export const Setup: Story = {
  args: { request: setupRequest, events: events.slice(0, 1) },
  play: async ({ userEvent }) => {
    await screen.findByRole('dialog', { name: '手动裁量 D1' })
    await expect(screen.getByRole('button', { name: '确认选择' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: '随机填一份' }))
    await expect(await screen.findByText('配置合法，可以确认。')).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: '确认选择' }))
    await waitFor(() =>
      expect(submitManualDiscretion).toHaveBeenCalledWith('game-1', 2, expect.any(Array)),
    )
    await expect(onSubmitted).toHaveBeenCalledOnce()
  },
}

export const Collapse: Story = {
  play: async ({ userEvent }) => {
    await screen.findByRole('dialog')
    await userEvent.click(screen.getByRole('button', { name: '收起，先看局面' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  },
}

export const Abort: Story = {
  play: async ({ userEvent }) => {
    await screen.findByRole('dialog')
    await userEvent.click(screen.getByRole('button', { name: '终止对局' }))
    await expect(onAbort).toHaveBeenCalledOnce()
  },
}

export const Aborting: Story = {
  args: { aborting: true },
  play: async () => {
    await screen.findByRole('dialog')
    await expect(screen.getByRole('button', { name: '终止对局' })).toBeDisabled()
  },
}

export const English: Story = {
  globals: { locale: 'en' },
  play: async () => {
    await expect(await screen.findByRole('dialog', { name: 'Manual discretion D8' })).toBeVisible()
    await expect(screen.getByRole('combobox', { name: 'Choose a legal candidate' })).toBeVisible()
  },
}
