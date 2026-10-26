<script setup lang="ts">
import { Toaster } from 'vue-sonner'
</script>

<template>
  <Toaster
    :toast-options="{
      unstyled: true,
      classes: {
        toast: 'grimoire-toast',
        description: 'grimoire-toast-description',
        icon: 'grimoire-toast-icon',
        error: 'grimoire-toast--error',
      },
    }"
  >
    <template #success-icon>
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <circle cx="10" cy="10" r="8" stroke="currentColor" />
        <path
          d="m6 10 3 3 5-6"
          stroke="currentColor"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </template>
    <template #info-icon>
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <circle cx="10" cy="10" r="8" stroke="currentColor" />
        <path d="M10 9v5m0-9v1" stroke="currentColor" stroke-linecap="round" />
      </svg>
    </template>
    <template #error-icon>
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <circle cx="10" cy="10" r="8" fill="currentColor" />
        <path d="M10 5v6m0 3v1" stroke="var(--paper2)" stroke-linecap="round" />
      </svg>
    </template>
  </Toaster>
</template>

<style>
[data-sonner-toast].grimoire-toast {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  width: var(--width);
  padding: var(--space-3) var(--space-4);
  border: 1px solid var(--rule);
  border-radius: var(--radius-thought);
  background: var(--paper3);
  color: var(--ink2);
  box-shadow: none;
  font-family: var(--font-family-sans);
  font-size: var(--font-size-small);
  line-height: var(--line-height-ui);
}

[data-sonner-toast].grimoire-toast:focus-visible {
  outline: var(--focus-ring-width) solid var(--accent2);
  outline-offset: var(--focus-ring-offset);
  box-shadow: none;
}

[data-sonner-toast].grimoire-toast--error {
  border-color: var(--accent);
}

.grimoire-toast-icon {
  display: flex;
  flex-shrink: 0;
}

.grimoire-toast--error .grimoire-toast-icon {
  color: var(--accent);
}

.grimoire-toast-description {
  margin-top: var(--space-1);
  color: var(--muted);
}
</style>
