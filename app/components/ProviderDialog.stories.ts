import type { Meta, StoryObj } from '@storybook-vue/nuxt'
import { expect, fn, mocked, screen, waitFor } from 'storybook/test'
import { onMounted, ref } from 'vue'
import { createProvider, updateProvider, type Provider } from '@/api'
import Toaster from '@/components/grimoire/Toaster.vue'
import ProviderDialog from './ProviderDialog.vue'

const onSaved = fn()

const provider: Provider = {
  id: 7,
  name: 'DeepSeek',
  baseUrl: 'https://api.deepseek.com/v1',
  apiFormat: 'openai_completions',
  apiKey: 'sk-old',
  timeoutSec: 120,
  maxConcurrency: 3,
}

const meta = {
  component: ProviderDialog,
  // open is required by the types; render drives it via v-model:open
  args: { open: true },
  render: (args) => ({
    components: { ProviderDialog, Toaster },
    setup: () => {
      const open = ref(false)
      onMounted(() => {
        open.value = true
      })
      return { args, open, onSaved }
    },
    template: '<ProviderDialog v-bind="args" v-model:open="open" @saved="onSaved" /><Toaster />',
  }),
  beforeEach: () => {
    onSaved.mockClear()
    mocked(createProvider).mockReset().mockResolvedValue(provider)
    mocked(updateProvider).mockReset().mockResolvedValue(provider)
  },
} satisfies Meta<typeof ProviderDialog>

export default meta
type Story = StoryObj<typeof meta>

export const Create: Story = {
  play: async ({ userEvent }) => {
    await expect(await screen.findByRole('dialog', { name: '添加提供商' })).toBeVisible()
    await expect(screen.getByLabelText('名称')).toHaveValue('')
    await expect(screen.getByLabelText('单次调用超时（秒）')).toHaveValue(300)
    await expect(screen.getByLabelText('最大并发')).toHaveValue(5)
    await expect(screen.getByLabelText('Base URL')).toHaveAttribute(
      'placeholder',
      'https://api.openai.com/v1',
    )
    await userEvent.click(screen.getByRole('combobox', { name: '接口格式' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Anthropic Messages' }))
    await expect(screen.getByLabelText('Base URL')).toHaveAttribute(
      'placeholder',
      'https://api.anthropic.com',
    )
  },
}

export const Edit: Story = {
  args: { provider },
  play: async ({ userEvent }) => {
    await expect(await screen.findByRole('dialog', { name: '编辑提供商' })).toBeVisible()
    await waitFor(() => expect(screen.getByLabelText('名称')).toHaveValue('DeepSeek'))
    await expect(screen.getByLabelText('Base URL')).toHaveValue('https://api.deepseek.com/v1')
    await expect(screen.getByLabelText('单次调用超时（秒）')).toHaveValue(120)

    await userEvent.clear(screen.getByLabelText('API 密钥'))
    await userEvent.type(screen.getByLabelText('API 密钥'), 'sk-new')
    await userEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() =>
      expect(updateProvider).toHaveBeenCalledWith(7, {
        name: 'DeepSeek',
        baseUrl: 'https://api.deepseek.com/v1',
        apiFormat: 'openai_completions',
        apiKey: 'sk-new',
        timeoutSec: 120,
        maxConcurrency: 3,
      }),
    )
    await expect(createProvider).not.toHaveBeenCalled()
    await expect(onSaved).toHaveBeenCalledOnce()
  },
}

export const EnglishCreate: Story = {
  globals: { locale: 'en' },
  play: async () => {
    await expect(await screen.findByRole('dialog', { name: 'Add provider' })).toBeVisible()
  },
}

export const ValidationErrors: Story = {
  play: async ({ userEvent }) => {
    await screen.findByRole('dialog')
    await userEvent.click(screen.getByRole('button', { name: '保存' }))
    await expect(screen.getByLabelText('名称')).toBeInvalid()
    await expect(screen.getByLabelText('API 密钥')).toBeInvalid()

    await userEvent.type(screen.getByLabelText('名称'), 'Local')
    await userEvent.type(screen.getByLabelText('Base URL'), 'not a url')
    await userEvent.type(screen.getByLabelText('API 密钥'), 'sk-test')
    await userEvent.click(screen.getByRole('button', { name: '保存' }))
    await expect(screen.getByLabelText('Base URL')).toBeInvalid()

    await expect(createProvider).not.toHaveBeenCalled()
    await expect(onSaved).not.toHaveBeenCalled()
    await expect(screen.getByRole('dialog')).toBeVisible()
  },
}

export const SubmitCreate: Story = {
  play: async ({ userEvent }) => {
    await screen.findByRole('dialog')
    await userEvent.type(screen.getByLabelText('名称'), 'Anthropic')
    await userEvent.type(screen.getByLabelText('Base URL'), 'https://api.anthropic.com')
    await userEvent.click(screen.getByRole('combobox', { name: '接口格式' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Anthropic Messages' }))
    await userEvent.type(screen.getByLabelText('API 密钥'), 'sk-ant')
    await userEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() =>
      expect(createProvider).toHaveBeenCalledWith({
        name: 'Anthropic',
        baseUrl: 'https://api.anthropic.com',
        apiFormat: 'anthropic_messages',
        apiKey: 'sk-ant',
        timeoutSec: 300,
        maxConcurrency: 5,
      }),
    )
    await expect(onSaved).toHaveBeenCalledOnce()
    await expect(await screen.findByText('已保存')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  },
}

export const ApiFailure: Story = {
  beforeEach: () => {
    mocked(createProvider).mockRejectedValue(new Error('IndexedDB write failed'))
  },
  play: async ({ userEvent }) => {
    await screen.findByRole('dialog')
    await userEvent.type(screen.getByLabelText('名称'), 'Broken')
    await userEvent.type(screen.getByLabelText('Base URL'), 'https://example.com')
    await userEvent.type(screen.getByLabelText('API 密钥'), 'sk-test')
    await userEvent.click(screen.getByRole('button', { name: '保存' }))

    await expect(await screen.findByText('IndexedDB write failed')).toBeInTheDocument()
    await expect(createProvider).toHaveBeenCalledOnce()
    await expect(onSaved).not.toHaveBeenCalled()
    await expect(screen.getByRole('dialog')).toBeVisible()
  },
}
