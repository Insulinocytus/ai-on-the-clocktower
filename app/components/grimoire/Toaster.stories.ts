import type { Meta, StoryObj } from '@storybook-vue/nuxt'
import { screen } from 'storybook/test'
import { toast } from 'vue-sonner'
import Toaster from './Toaster.vue'

const meta = {
  component: Toaster,
  beforeEach: () => {
    toast.dismiss()
  },
} satisfies Meta<typeof Toaster>

export default meta
type Story = StoryObj<typeof meta>

export const Success: Story = {
  play: async () => {
    toast.success('已保存', { duration: Infinity })
    await screen.findByText('已保存') // let the toast render before the a11y check runs
  },
}

export const Info: Story = {
  play: async () => {
    toast.info('选择已过期', { duration: Infinity, description: '已采用说书人的决定。' })
    await screen.findByText('选择已过期')
  },
}

export const Failure: Story = {
  play: async () => {
    toast.error('请求失败', { duration: Infinity })
    await screen.findByText('请求失败')
  },
}
