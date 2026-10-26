import type { Meta, StoryObj } from '@storybook-vue/nuxt'
import { expect, fn, mocked, screen, waitFor } from 'storybook/test'
import { onMounted, ref } from 'vue'
import { createPreset, updatePreset, type Provider } from '@/api'
import Toaster from '@/components/grimoire/Toaster.vue'
import type { Preset } from '#shared/types/models'
import PresetDialog from './PresetDialog.vue'

const onSaved = fn()

const providers: Provider[] = [
  {
    id: 1,
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    apiFormat: 'openai_completions',
    apiKey: 'sk-deepseek',
    timeoutSec: 300,
    maxConcurrency: 5,
  },
  {
    id: 2,
    name: 'Anthropic',
    baseUrl: 'https://api.anthropic.com',
    apiFormat: 'anthropic_messages',
    apiKey: 'sk-ant',
    timeoutSec: 300,
    maxConcurrency: 5,
  },
]

const preset: Preset = {
  id: 9,
  name: 'Claude fast',
  providerId: 2,
  model: 'claude-haiku',
  forceToolChoice: true,
  extraBody: '{"temperature":0.2}',
}

const meta = {
  component: PresetDialog,
  // open is required by the types; render drives it via v-model:open
  args: { open: true, providers },
  render: (args) => ({
    components: { PresetDialog, Toaster },
    setup: () => {
      const open = ref(false)
      onMounted(() => {
        open.value = true
      })
      return { args, open, onSaved }
    },
    template: '<PresetDialog v-bind="args" v-model:open="open" @saved="onSaved" /><Toaster />',
  }),
  beforeEach: () => {
    onSaved.mockClear()
    mocked(createPreset).mockReset().mockResolvedValue(preset)
    mocked(updatePreset).mockReset().mockResolvedValue(preset)
  },
} satisfies Meta<typeof PresetDialog>

export default meta
type Story = StoryObj<typeof meta>

export const Create: Story = {
  play: async () => {
    await expect(await screen.findByRole('dialog', { name: '添加模型预设' })).toBeVisible()
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: '所属提供商' })).toHaveTextContent('DeepSeek'),
    )
    await expect(screen.getByLabelText('名称')).toHaveValue('')
    await expect(screen.getByRole('checkbox', { name: '允许强制 tool_choice' })).not.toBeChecked()
    await expect(screen.getByLabelText('extra_body（JSON 对象）')).toHaveValue('{}')
  },
}

export const Edit: Story = {
  args: { preset },
  play: async ({ userEvent }) => {
    await expect(await screen.findByRole('dialog', { name: '编辑模型预设' })).toBeVisible()
    await waitFor(() => expect(screen.getByLabelText('名称')).toHaveValue('Claude fast'))
    await expect(screen.getByRole('combobox', { name: '所属提供商' })).toHaveTextContent(
      'Anthropic',
    )
    await expect(screen.getByRole('checkbox', { name: '允许强制 tool_choice' })).toBeChecked()

    await userEvent.clear(screen.getByLabelText('模型名'))
    await userEvent.type(screen.getByLabelText('模型名'), 'claude-sonnet')
    await userEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() =>
      expect(updatePreset).toHaveBeenCalledWith(9, {
        name: 'Claude fast',
        providerId: 2,
        model: 'claude-sonnet',
        forceToolChoice: true,
        extraBody: '{"temperature":0.2}',
      }),
    )
    await expect(createPreset).not.toHaveBeenCalled()
    await expect(onSaved).toHaveBeenCalledOnce()
  },
}

export const EnglishCreate: Story = {
  globals: { locale: 'en' },
  play: async () => {
    await expect(await screen.findByRole('dialog', { name: 'Add preset' })).toBeVisible()
  },
}

export const RequiredFields: Story = {
  play: async ({ userEvent }) => {
    await screen.findByRole('dialog')
    await userEvent.click(screen.getByRole('button', { name: '保存' }))
    await expect(screen.getByLabelText('名称')).toBeInvalid()
    await expect(screen.getByLabelText('模型名')).toBeInvalid()
    await expect(createPreset).not.toHaveBeenCalled()
    await expect(onSaved).not.toHaveBeenCalled()
  },
}

export const InvalidExtraBody: Story = {
  play: async ({ userEvent }) => {
    await screen.findByRole('dialog')
    const extraBody = screen.getByLabelText('extra_body（JSON 对象）')
    await userEvent.clear(extraBody)
    await userEvent.paste('[1, 2]')

    await expect(await screen.findByRole('alert')).toHaveTextContent('必须是合法的 JSON 对象。')
    await expect(extraBody).toBeInvalid()
    await expect(screen.getByRole('button', { name: '保存' })).toBeDisabled()

    await userEvent.clear(extraBody)
    await userEvent.paste('{"top_p":0.9}')
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
    await expect(screen.getByRole('button', { name: '保存' })).toBeEnabled()
  },
}

export const SubmitCreate: Story = {
  play: async ({ userEvent }) => {
    await screen.findByRole('dialog')
    await userEvent.type(screen.getByLabelText('名称'), 'Claude fast')
    await userEvent.click(screen.getByRole('combobox', { name: '所属提供商' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Anthropic' }))
    await userEvent.type(screen.getByLabelText('模型名'), 'claude-haiku')
    await userEvent.click(screen.getByRole('checkbox', { name: '允许强制 tool_choice' }))
    await userEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() =>
      expect(createPreset).toHaveBeenCalledWith({
        name: 'Claude fast',
        providerId: 2,
        model: 'claude-haiku',
        forceToolChoice: true,
        extraBody: '{}',
      }),
    )
    await expect(onSaved).toHaveBeenCalledOnce()
    await expect(await screen.findByText('已保存')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  },
}

export const ApiFailure: Story = {
  beforeEach: () => {
    mocked(createPreset).mockRejectedValue(new Error('Provider not found'))
  },
  play: async ({ userEvent }) => {
    await screen.findByRole('dialog')
    await userEvent.type(screen.getByLabelText('名称'), 'Orphan')
    await userEvent.type(screen.getByLabelText('模型名'), 'deepseek-v4-pro')
    await userEvent.click(screen.getByRole('button', { name: '保存' }))

    await expect(await screen.findByText('Provider not found')).toBeInTheDocument()
    await expect(createPreset).toHaveBeenCalledOnce()
    await expect(onSaved).not.toHaveBeenCalled()
    await expect(screen.getByRole('dialog')).toBeVisible()
  },
}
