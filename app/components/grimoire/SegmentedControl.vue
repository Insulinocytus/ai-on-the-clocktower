<script setup lang="ts" generic="T extends string">
import { RadioGroupItem, RadioGroupRoot } from 'reka-ui'

defineProps<{
  modelValue?: T
  options: { value: T; label: string }[]
}>()
const emit = defineEmits<{ 'update:modelValue': [value: T] }>()
</script>

<template>
  <RadioGroupRoot
    :model-value="modelValue ?? ''"
    orientation="horizontal"
    class="grimoire-segmented"
    @update:model-value="emit('update:modelValue', $event as T)"
  >
    <RadioGroupItem
      v-for="option in options"
      :key="option.value"
      :value="option.value"
      class="grimoire-segmented-option"
    >
      {{ option.label }}
    </RadioGroupItem>
  </RadioGroupRoot>
</template>

<style>
.grimoire-segmented {
  display: inline-flex;
  width: max-content;
  height: var(--size-button);
  padding: var(--space-1);
  border-radius: var(--radius-pill);
  background: var(--paper3);
  font-family: var(--font-family-sans);
  font-size: var(--font-size-ui);
  line-height: var(--line-height-ui);
}

.grimoire-segmented-option {
  padding-inline: var(--space-3);
  border-radius: var(--radius-pill);
  color: var(--ink2);
  white-space: nowrap;
  cursor: pointer;
}

.grimoire-segmented-option[data-state='checked'] {
  background: var(--accent);
  color: var(--accent-ink);
}
</style>
