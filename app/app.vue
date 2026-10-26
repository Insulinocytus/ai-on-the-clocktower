<script setup lang="ts">
import AppShell from '@/components/AppShell.vue'
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
    <img
      class="tab-blocked-ccc"
      :src="publicAssetUrl('botc/community/ccc-parchment.png')"
      :alt="t('app.communityContent')"
      width="80"
      height="32"
    />
    <div class="tab-blocked-message text-center">
      <h1>{{ t('app.tabBlockedTitle') }}</h1>
      <p>{{ t('app.tabBlockedDescription') }}</p>
    </div>
  </div>
  <AppShell v-else-if="ready" :spectator="!!route.meta.spectator">
    <NuxtPage />
  </AppShell>
</template>

<style scoped>
.tab-blocked {
  background: var(--paper);
  color: var(--ink);
  padding: var(--space-6);
}

.tab-blocked-ccc {
  position: absolute;
  top: 12px;
  right: var(--layout-gutter);
  width: 80px;
  height: 32px;
  object-fit: contain;
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
