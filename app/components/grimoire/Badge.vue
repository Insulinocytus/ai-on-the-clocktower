<script setup lang="ts">
withDefaults(
  defineProps<{ variant?: 'accent' | 'outline' | 'accent-outline'; size?: 'default' | 'large' }>(),
  { variant: 'outline', size: 'default' },
)
</script>

<template>
  <span :class="['grimoire-badge', `grimoire-badge--${variant}`, `grimoire-badge--${size}`]"
    ><slot
  /></span>
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

.grimoire-badge--accent-outline {
  border-color: var(--accent);
  color: var(--accent);
}

.grimoire-badge--large {
  height: var(--size-button);
  padding-inline: var(--space-5);
  font-size: var(--font-size-ui);
}
</style>
