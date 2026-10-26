<script setup lang="ts">
import Toaster from '@/components/grimoire/Toaster.vue'
import Topbar from '@/components/grimoire/Topbar.vue'
import { APPLICATION_READY_KEY } from '@/utils/application'

const { t, locale } = useI18n()
const route = useRoute()
const ready = useState<boolean | undefined>(APPLICATION_READY_KEY, () => undefined)

useHead({ title: () => t('app.title'), htmlAttrs: { lang: locale } })
</script>

<template>
  <div
    v-if="ready === false"
    role="alert"
    class="grain tab-blocked fixed inset-0 flex items-center justify-center"
  >
    <div class="tab-blocked-message text-center">
      <h1>{{ t('app.tabBlockedTitle') }}</h1>
      <p>{{ t('app.tabBlockedDescription') }}</p>
    </div>
  </div>
  <div v-else-if="ready" class="grain min-h-screen bg-paper text-ink">
    <Topbar />
    <main :class="route.meta.spectator ? '' : 'mx-auto max-w-6xl p-6'">
      <NuxtPage />
    </main>
    <Toaster />
  </div>
</template>

<style scoped>
.tab-blocked {
  background: var(--paper);
  color: var(--ink);
  padding: var(--space-6);
}

.tab-blocked-message h1 {
  margin-bottom: var(--space-4);
  font-size: var(--font-size-dialog);
  font-weight: var(--font-weight-semibold);
  line-height: var(--line-height-heading);
}

.tab-blocked-message p {
  color: var(--ink2);
  font-size: var(--font-size-body);
  line-height: var(--line-height-body);
}
</style>
