import type { Meta, StoryObj } from '@storybook-vue/nuxt'
import Badge from './Badge.vue'

const meta = {
  component: Badge,
  render: (args) => ({
    components: { Badge },
    setup: () => ({ args }),
    template: '<Badge v-bind="args">进行中</Badge>',
  }),
} satisfies Meta<typeof Badge>

export default meta
type Story = StoryObj<typeof meta>

export const Outline: Story = {}

export const Accent: Story = { args: { variant: 'accent' } }

export const AccentOutline: Story = { args: { variant: 'accent-outline' } }

export const Large: Story = { args: { size: 'large' } }
