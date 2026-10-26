import type { StorybookConfig } from '@storybook-vue/nuxt'

const config: StorybookConfig = {
  framework: '@storybook-vue/nuxt',
  stories: ['../app/components/**/*.stories.ts'],
  addons: ['@storybook/addon-a11y', '@storybook/addon-vitest', '@storybook/addon-mcp'],
  staticDirs: ['../public'],
  // ajv is CommonJS; without pre-bundling the browser cannot resolve its named exports.
  viteFinal: (config) => {
    config.optimizeDeps = {
      ...config.optimizeDeps,
      include: [...(config.optimizeDeps?.include ?? []), 'ajv'],
    }
    return config
  },
}

export default config
