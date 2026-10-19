<script setup lang="ts">
import { Button } from '@/components/ui/button'
import { Toaster } from '@/components/ui/sonner'
import { LOCALE_KEY } from '@/plugins/locale'

const { t, locale, setLocale } = useI18n()

async function toggleLocale() {
  const next = locale.value === 'zh' ? 'en' : 'zh'
  localStorage.setItem(LOCALE_KEY, next)
  await setLocale(next)
}

useHead({ title: () => t('app.title'), htmlAttrs: { lang: locale } })
</script>

<template>
  <div class="min-h-screen bg-background text-foreground">
    <header class="flex items-center gap-6 border-b px-6 py-3">
      <span class="font-semibold">{{ t('app.title') }}</span>
      <nav class="flex gap-4 text-sm">
        <NuxtLink to="/games" active-class="font-medium underline">{{ t('nav.games') }}</NuxtLink>
        <NuxtLink to="/models" active-class="font-medium underline">{{ t('nav.models') }}</NuxtLink>
      </nav>
      <Button variant="outline" size="sm" class="ml-auto" @click="toggleLocale">
        {{ t('app.language') }}
      </Button>
    </header>
    <main class="mx-auto max-w-6xl p-6">
      <NuxtPage />
    </main>
    <Toaster rich-colors />
  </div>
</template>
