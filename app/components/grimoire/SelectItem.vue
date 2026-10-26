<script setup lang="ts">
import { SelectItem, SelectItemIndicator, SelectItemText, type SelectItemProps } from 'reka-ui'

defineProps<Pick<SelectItemProps, 'value' | 'disabled' | 'textValue'>>()
</script>

<template>
  <SelectItem v-bind="$props" class="grimoire-select-item">
    <SelectItemText><slot /></SelectItemText>
    <SelectItemIndicator class="grimoire-select-check" aria-hidden="true">✓</SelectItemIndicator>
  </SelectItem>
</template>

<style scoped>
.grimoire-select-item {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-6);
  min-height: 36px;
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-thought);
  color: var(--ink2);
  font-size: var(--font-size-ui);
  line-height: var(--line-height-ui);
  cursor: pointer;
  user-select: none;
}

.grimoire-select-item[data-highlighted] {
  background: var(--paper3);
  color: var(--ink);
  outline: var(--focus-ring-width) solid var(--accent2);
  outline-offset: -2px;
}

.grimoire-select-item[data-state='checked'] {
  color: var(--ink);
}

.grimoire-select-item[data-disabled] {
  cursor: not-allowed;
  opacity: 0.5;
}

.grimoire-select-check {
  flex-shrink: 0;
}
</style>
