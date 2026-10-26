<script setup lang="ts">
import Toaster from '@/components/grimoire/Toaster.vue'
import Topbar from '@/components/grimoire/Topbar.vue'

defineProps<{ spectator?: boolean }>()
</script>

<template>
  <div class="grain min-h-screen bg-paper text-ink">
    <Topbar />
    <main :class="{ 'page-main': !spectator }">
      <slot />
    </main>
    <Toaster />
  </div>
</template>

<style scoped>
.page-main {
  width: var(--layout-content-width);
  margin-inline: auto;
  padding-block: calc(var(--space-6) + var(--space-8)) var(--space-6);
}

.page-main :deep(h1) {
  color: var(--ink);
  font-size: var(--font-size-page);
  line-height: var(--line-height-heading);
}
</style>
