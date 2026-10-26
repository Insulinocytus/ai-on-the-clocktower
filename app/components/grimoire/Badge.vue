<script setup lang="ts">
withDefaults(defineProps<{ variant?: 'accent' | 'outline' }>(), { variant: 'outline' })
</script>

<template>
  <span :class="['grimoire-badge', `grimoire-badge--${variant}`]"><slot /></span>
</template>

<style scoped>
.grimoire-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: var(--size-badge);
  padding-inline: var(--space-3);
  border: 1px solid transparent;
  border-radius: var(--radius-pill);
  font-size: var(--font-size-caption);
  font-weight: var(--font-weight-medium);
  line-height: var(--line-height-ui);
  white-space: nowrap;
}

.grimoire-badge--accent {
  background: var(--accent);
  color: var(--accent-ink);
}

.grimoire-badge--outline {
  border-color: var(--ink2);
  color: var(--ink2);
}
</style>
