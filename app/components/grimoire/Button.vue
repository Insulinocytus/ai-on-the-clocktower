<script setup lang="ts">
import { Primitive, type PrimitiveProps } from 'reka-ui'

withDefaults(
  defineProps<PrimitiveProps & { variant?: 'primary' | 'secondary'; disabled?: boolean }>(),
  { as: 'button', variant: 'primary', disabled: false },
)
</script>

<template>
  <Primitive
    :as="as"
    :as-child="asChild"
    :type="as === 'button' && !asChild ? 'button' : undefined"
    :disabled="disabled || undefined"
    :class="['grimoire-button', `grimoire-button--${variant}`]"
  >
    <slot />
  </Primitive>
</template>

<style scoped>
.grimoire-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  height: var(--size-button);
  padding-inline: var(--space-5);
  border: 1px solid transparent;
  border-radius: var(--radius-pill);
  font-family: var(--font-family-sans);
  font-size: var(--font-size-ui);
  font-weight: var(--font-weight-medium);
  line-height: var(--line-height-ui);
  white-space: nowrap;
  cursor: pointer;
}

.grimoire-button--primary {
  background: var(--accent);
  color: var(--accent-ink);
}

.grimoire-button--secondary {
  border-color: var(--ink2);
  background: transparent;
  color: var(--ink2);
}

.grimoire-button--primary:enabled:hover,
.grimoire-button--primary[href]:hover {
  filter: brightness(1.08);
}

.grimoire-button--primary:enabled:active,
.grimoire-button--primary[href]:active {
  filter: brightness(0.95);
}
</style>
