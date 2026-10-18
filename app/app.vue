<script setup lang="ts">
import { ConfigProvider } from 'reka-ui'
import { Toaster } from '~/components/ui/sonner'
import { Button } from '~/components/ui/button'
const { t, locale, setLocale } = useI18n()
useHead(() => ({ title: t('app.title'), htmlAttrs: { lang: locale.value === 'zh' ? 'zh-CN' : 'en', dir: 'ltr' } }))
onMounted(async () => {
  let remembered: string | null = null
  try { remembered = localStorage.getItem('clocktower.locale') } catch {}
  await setLocale(remembered === 'zh' || remembered === 'en' ? remembered : navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en')
})
async function switchLanguage() {
  const next = locale.value === 'zh' ? 'en' : 'zh'
  await setLocale(next)
  try { localStorage.setItem('clocktower.locale', next) } catch {}
}
</script>

<template>
  <ConfigProvider :locale="locale === 'zh' ? 'zh-CN' : 'en-US'" dir="ltr">
    <header class="app-header">
      <NuxtLink to="/" class="brand"><span class="brand-mark" aria-hidden="true">◷</span>{{ t('app.title') }}</NuxtLink>
      <nav class="app-nav" :aria-label="t('app.title')">
        <NuxtLink to="/">{{ t('app.games') }}</NuxtLink>
        <NuxtLink to="/models">{{ t('app.models') }}</NuxtLink>
        <NuxtLink to="/games/new">{{ t('app.new') }}</NuxtLink>
      </nav>
      <Button variant="ghost" class="header-end" :aria-label="t('app.language')" @click="switchLanguage">中文 / EN</Button>
    </header>
    <NuxtPage />
    <Toaster theme="light" :container-aria-label="t('app.notifications')" close-button />
  </ConfigProvider>
</template>
