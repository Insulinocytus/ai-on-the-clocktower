<script setup lang="ts">
import { CheckboxIndicator, CheckboxRoot, type CheckboxRootProps } from 'reka-ui'

defineProps<Pick<CheckboxRootProps, 'id' | 'name' | 'disabled' | 'required' | 'value'>>()
const model = defineModel<boolean | 'indeterminate'>({ default: false })
</script>

<template>
  <CheckboxRoot v-bind="$props" v-model="model" class="grimoire-checkbox">
    <CheckboxIndicator class="grimoire-checkbox-indicator">
      <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true">
        <path v-if="model === 'indeterminate'" d="M4 8h8" />
        <path v-else d="m4 8 3 3 5-7" />
      </svg>
    </CheckboxIndicator>
  </CheckboxRoot>
</template>

<style scoped>
.grimoire-checkbox {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  padding: 0;
  border: 1px solid var(--ink2);
  border-radius: 4px;
  background: transparent;
  color: var(--ink);
  cursor: pointer;
}

.grimoire-checkbox[data-state='checked'],
.grimoire-checkbox[data-state='indeterminate'] {
  border-color: var(--accent);
  background: var(--accent);
  color: var(--accent-ink);
}

.grimoire-checkbox:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.grimoire-checkbox-indicator {
  display: flex;
}

.grimoire-checkbox-indicator path {
  stroke: currentColor;
  stroke-width: 1.6;
  stroke-linecap: round;
  stroke-linejoin: round;
}
</style>
