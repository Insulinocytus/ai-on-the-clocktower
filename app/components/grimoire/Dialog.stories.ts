import type { Meta, StoryObj } from '@storybook-vue/nuxt'
import { expect, screen, waitFor } from 'storybook/test'
import { ref } from 'vue'
import Button from './Button.vue'
import Dialog from './Dialog.vue'
import Input from './Input.vue'

const meta = {
  component: Dialog,
  // open is required by the types; render drives it via v-model:open
  args: { open: true, title: '添加提供商' },
  render: (args) => ({
    components: { Button, Dialog, Input },
    setup: () => ({ args, open: ref(true), name: ref('') }),
    template: `
      <Button @click="open = true">打开</Button>
      <Dialog v-bind="args" v-model:open="open">
        <Input v-model="name" aria-label="名称" />
        <template #footer>
          <Button variant="secondary" @click="open = false">取消</Button>
          <Button>保存</Button>
        </template>
      </Dialog>
    `,
  }),
} satisfies Meta<typeof Dialog>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: { description: '填写 API 地址与密钥。' },
  play: async ({ userEvent }) => {
    const dialog = await screen.findByRole('dialog', { name: '添加提供商' })
    await expect(dialog).toHaveAccessibleDescription('填写 API 地址与密钥。')
    await userEvent.click(screen.getByRole('button', { name: '关闭' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: '打开' }))
    await expect(await screen.findByRole('dialog', { name: '添加提供商' })).toBeVisible()
  },
}

export const FooterCancel: Story = {
  play: async ({ userEvent }) => {
    await screen.findByRole('dialog', { name: '添加提供商' })
    await userEvent.click(screen.getByRole('button', { name: '取消' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  },
}

export const Wide: Story = { args: { size: 'wide' } }

export const Discretion: Story = { args: { size: 'discretion' } }
