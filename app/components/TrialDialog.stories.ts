import type { Meta, StoryObj } from '@storybook-vue/nuxt'
import { expect, mocked, screen, waitFor } from 'storybook/test'
import { onMounted, ref } from 'vue'
import { trialPreset } from '@/api'
import type { Preset, TrialResult } from '#shared/types/models'
import TrialDialog from './TrialDialog.vue'

const preset: Preset = {
  id: 9,
  name: 'Claude fast',
  providerId: 2,
  model: 'claude-haiku',
  forceToolChoice: true,
  extraBody: '{}',
}

const valid: TrialResult = {
  valid: true,
  toolCall: { name: 'speak', arguments: { channel: 'public', text: '大家好。' } },
  raw: { id: 'msg_1', stop_reason: 'tool_use' },
}

const invalid: TrialResult = {
  valid: false,
  error: 'Model did not call a tool',
  raw: 'I would rather chat.',
}

const meta = {
  component: TrialDialog,
  // open is required by the types; render drives it via v-model:open
  args: { open: true, preset },
  render: (args) => ({
    components: { TrialDialog },
    setup: () => {
      const open = ref(false)
      onMounted(() => {
        open.value = true
      })
      return { args, open }
    },
    template: '<TrialDialog v-bind="args" v-model:open="open" />',
  }),
  beforeEach: () => {
    mocked(trialPreset).mockReset()
  },
} satisfies Meta<typeof TrialDialog>

export default meta
type Story = StoryObj<typeof meta>

export const Running: Story = {
  beforeEach: () => {
    mocked(trialPreset).mockReturnValue(Promise.withResolvers<TrialResult>().promise)
  },
  play: async () => {
    await expect(await screen.findByRole('dialog', { name: '试调用：Claude fast' })).toBeVisible()
    await expect(await screen.findByText('正在调用模型…')).toBeVisible()
    await expect(screen.getByRole('button', { name: '再试一次' })).toBeDisabled()
    await expect(trialPreset).toHaveBeenCalledWith(9, { lang: 'zh' }, expect.any(AbortSignal))
  },
}

export const Valid: Story = {
  beforeEach: () => {
    mocked(trialPreset).mockResolvedValue(valid)
  },
  play: async () => {
    await expect(await screen.findByText('得到合法的 tool call')).toBeVisible()
    await expect(screen.getByRole('heading', { name: 'Tool call: speak' })).toBeVisible()
    await expect(screen.getByText(/"channel": "public"/)).toBeVisible()
    await expect(screen.getByText(/"stop_reason": "tool_use"/)).toBeVisible()
    await expect(screen.getByRole('button', { name: '再试一次' })).toBeEnabled()
  },
}

export const Invalid: Story = {
  beforeEach: () => {
    mocked(trialPreset).mockResolvedValue(invalid)
  },
  play: async () => {
    await expect(await screen.findByText('没有得到合法的 tool call')).toBeVisible()
    await expect(screen.getByText('Model did not call a tool')).toBeVisible()
    await expect(screen.getByText('I would rather chat.')).toBeVisible()
    await expect(screen.queryByRole('heading', { name: /Tool call/ })).not.toBeInTheDocument()
  },
}

export const ApiFailure: Story = {
  beforeEach: () => {
    mocked(trialPreset).mockRejectedValue(new Error('401 Unauthorized'))
  },
  play: async () => {
    await expect(await screen.findByRole('alert')).toHaveTextContent('401 Unauthorized')
    await expect(screen.queryByText('正在调用模型…')).not.toBeInTheDocument()
    await expect(screen.getByRole('button', { name: '再试一次' })).toBeEnabled()
  },
}

export const RetryAfterFailure: Story = {
  beforeEach: () => {
    mocked(trialPreset).mockRejectedValueOnce(new Error('503 Service Unavailable'))
    mocked(trialPreset).mockResolvedValue(valid)
  },
  play: async ({ userEvent }) => {
    await expect(await screen.findByRole('alert')).toHaveTextContent('503 Service Unavailable')
    await userEvent.click(screen.getByRole('button', { name: '再试一次' }))

    await expect(await screen.findByText('得到合法的 tool call')).toBeVisible()
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
    await expect(trialPreset).toHaveBeenCalledTimes(2)
  },
}

export const English: Story = {
  globals: { locale: 'en' },
  beforeEach: () => {
    mocked(trialPreset).mockResolvedValue(valid)
  },
  play: async () => {
    await expect(
      await screen.findByRole('dialog', { name: 'Trial call: Claude fast' }),
    ).toBeVisible()
    await expect(trialPreset).toHaveBeenCalledWith(9, { lang: 'en' }, expect.any(AbortSignal))
  },
}
