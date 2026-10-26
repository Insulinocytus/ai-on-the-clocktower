<script setup lang="ts" generic="T extends string | number">
import {
  SelectContent,
  SelectIcon,
  SelectPortal,
  SelectRoot,
  SelectTrigger,
  SelectValue,
  SelectViewport,
} from 'reka-ui'
import SelectItem from './SelectItem.vue'

defineOptions({ inheritAttrs: false })
defineProps<{
  options: { value: T; label: string; disabled?: boolean }[]
  placeholder?: string
  compact?: boolean
  invalid?: boolean
  disabled?: boolean
  required?: boolean
  name?: string
  theme?: 'day' | 'night'
  contentClass?: string
}>()
const model = defineModel<T>()
</script>

<template>
  <SelectRoot v-model="model" :disabled="disabled" :required="required" :name="name">
    <SelectTrigger
      v-bind="$attrs"
      :aria-invalid="invalid || $attrs['aria-invalid'] || undefined"
      :class="[
        'grimoire-field grimoire-select-trigger',
        { 'grimoire-select-trigger--compact': compact },
      ]"
    >
      <SelectValue :placeholder="placeholder">
        {{ options.find((option) => option.value === model)?.label ?? placeholder }}
      </SelectValue>
      <SelectIcon as-child>
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path
            d="m3 6 5 4 5-4"
            stroke="currentColor"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </SelectIcon>
    </SelectTrigger>
    <SelectPortal>
      <SelectContent
        class="grimoire-select-content"
        :class="contentClass"
        :data-theme="theme"
        position="popper"
        :side-offset="6"
      >
        <SelectViewport class="grimoire-select-viewport">
          <SelectItem
            v-for="option in options"
            :key="option.value"
            :value="option.value"
            :disabled="option.disabled"
            :text-value="option.label"
          >
            <slot name="option" :option="option">{{ option.label }}</slot>
          </SelectItem>
        </SelectViewport>
      </SelectContent>
    </SelectPortal>
  </SelectRoot>
</template>

<style>
.grimoire-select-trigger {
  display: inline-flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  text-align: left;
  cursor: pointer;
}

.grimoire-select-trigger--compact {
  width: auto;
  min-width: 200px;
  height: var(--size-button);
  padding-inline: var(--space-4);
  border-radius: var(--radius-pill);
  font-size: var(--font-size-ui);
}

.grimoire-select-trigger[data-placeholder] {
  color: var(--muted);
}

.grimoire-select-trigger svg {
  flex-shrink: 0;
}

.grimoire-select-content {
  z-index: 120;
  min-width: var(--reka-select-trigger-width);
  max-width: calc(100vw - 32px);
  max-height: var(--reka-select-content-available-height);
  overflow: hidden;
  border: 1px solid var(--rule);
  border-radius: var(--radius-thought);
  background: var(--paper2);
  color: var(--ink);
}

.grimoire-select-viewport {
  padding: var(--space-1);
}
</style>
