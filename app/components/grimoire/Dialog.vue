<script setup lang="ts">
import {
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
} from 'reka-ui'

defineOptions({ inheritAttrs: false })
withDefaults(
  defineProps<{
    title: string
    description?: string
    size?: 'form' | 'wide'
    theme?: 'day' | 'night'
  }>(),
  { size: 'form', description: undefined, theme: undefined },
)
const open = defineModel<boolean>('open', { required: true })
const descriptionId = useId()
</script>

<template>
  <DialogRoot v-model:open="open">
    <DialogPortal>
      <DialogOverlay class="grimoire-dialog-overlay" />
      <DialogContent
        v-bind="$attrs"
        :data-theme="theme"
        :aria-describedby="description ? descriptionId : undefined"
        :class="['grimoire-dialog', `grimoire-dialog--${size}`]"
      >
        <header class="grimoire-dialog-header">
          <DialogTitle class="grimoire-dialog-title">{{ title }}</DialogTitle>
          <DialogDescription
            v-if="description"
            :id="descriptionId"
            class="grimoire-dialog-description"
          >
            {{ description }}
          </DialogDescription>
        </header>
        <div class="grimoire-dialog-body"><slot /></div>
        <footer v-if="$slots.footer" class="grimoire-dialog-footer"><slot name="footer" /></footer>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>

<style scoped>
.grimoire-dialog-overlay {
  position: fixed;
  inset: 0;
  z-index: 110;
  background: rgb(0 0 0 / 72%);
}

.grimoire-dialog {
  position: fixed;
  top: 50%;
  left: 50%;
  z-index: 111;
  display: flex;
  flex-direction: column;
  width: min(600px, calc(100vw - 48px));
  max-height: calc(100vh - 64px);
  transform: translate(-50%, -50%);
  overflow: auto;
  border-radius: var(--radius-dialog);
  background: var(--paper2);
  color: var(--ink);
  box-shadow: 0 24px 80px rgb(0 0 0 / 40%);
}

.grimoire-dialog--wide {
  width: min(760px, calc(100vw - 48px));
}

.grimoire-dialog-header {
  padding: var(--space-8) 36px 0;
}

.grimoire-dialog-title {
  font-family: var(--font-family-serif);
  font-size: var(--font-size-title);
  font-weight: var(--font-weight-semibold);
  line-height: var(--line-height-heading);
}

.grimoire-dialog-description {
  margin-top: var(--space-3);
  color: var(--ink2);
  font-size: var(--font-size-ui);
  line-height: var(--line-height-body);
}

.grimoire-dialog-body {
  min-width: 0;
  padding: var(--space-8) 36px;
}

.grimoire-dialog-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--space-3);
  border-top: 1px solid var(--rule);
  padding: var(--space-5) 36px;
}
</style>
