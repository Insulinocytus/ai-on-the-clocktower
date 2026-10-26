<script setup lang="ts">
import { LOCALE_KEY } from '@/plugins/locale'

const { t, locale, setLocale } = useI18n()
const route = useRoute()

async function toggleLocale() {
  const next = locale.value === 'zh' ? 'en' : 'zh'
  localStorage.setItem(LOCALE_KEY, next)
  await setLocale(next)
}
</script>

<template>
  <header class="topbar">
    <span class="topbar-wordmark">{{ t('app.title') }}</span>
    <nav class="topbar-nav">
      <NuxtLink
        to="/games"
        :class="{ 'topbar-active': route.path.startsWith('/games') }"
        :aria-current="route.path.startsWith('/games') ? 'page' : undefined"
        >{{ t('nav.games') }}</NuxtLink
      >
      <NuxtLink
        to="/models"
        :class="{ 'topbar-active': route.path === '/models' }"
        :aria-current="route.path === '/models' ? 'page' : undefined"
        >{{ t('nav.models') }}</NuxtLink
      >
    </nav>
    <img
      class="topbar-ccc"
      :src="publicAssetUrl('botc/community/ccc-parchment.png')"
      :alt="t('app.communityContent')"
      width="80"
      height="32"
    />
    <button class="topbar-language" type="button" @click="toggleLocale">
      {{ t('app.language') }}
    </button>
  </header>
</template>

<style scoped>
.topbar {
  display: flex;
  align-items: center;
  gap: var(--space-10);
  height: var(--layout-topbar-height);
  padding-inline: var(--layout-gutter);
  border-bottom: 1px solid var(--rule);
  background: var(--paper);
  color: var(--ink2);
  font-size: var(--font-size-ui);
}

.topbar-wordmark {
  color: var(--ink);
  font-family: var(--font-family-serif);
  font-size: var(--font-size-wordmark);
  font-weight: var(--font-weight-semibold);
}

.topbar-nav {
  display: flex;
  align-self: stretch;
  gap: var(--space-8);
}

.topbar-nav a {
  display: flex;
  align-items: center;
  position: relative;
}

.topbar-active {
  color: var(--ink);
}

.topbar-active::after {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  height: 2px;
  background: var(--accent);
  content: '';
}

.topbar-ccc {
  width: 80px;
  height: 32px;
  object-fit: contain;
  margin-left: auto;
}

.topbar-language {
  color: var(--muted);
  cursor: pointer;
}
</style>
