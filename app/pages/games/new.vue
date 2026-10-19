<script setup lang="ts">
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { Preset } from '#shared/types/models'
import type { GameSummary } from '#shared/types/game-view'

const { t, locale } = useI18n()
const { data: presets } = await useFetch<Preset[]>('/api/presets', { default: () => [] })
const choices = ref<string[]>(Array.from({ length: 5 }, () => ''))
const language = ref(locale.value === 'zh' ? 'zh' : 'en')
const speechLimit = ref(10)
const busy = ref(false)
const error = ref('')

async function create() {
  busy.value = true
  error.value = ''
  try {
    const game = await $fetch<GameSummary>('/api/games', {
      method: 'POST',
      body: {
        presets: choices.value.map(Number),
        language: language.value,
        speechLimit: speechLimit.value,
      },
    })
    await navigateTo(`/games/${game.id}`)
  } catch (cause) {
    const details = cause as { data?: { data?: { missing?: string[] } } }
    error.value = details.data?.data?.missing?.join(', ') ?? apiErrorMessage(cause)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <section class="max-w-2xl">
    <h1 class="mb-3 text-2xl font-semibold">{{ t('games.new') }}</h1>
    <p class="mb-8 text-sm leading-6 text-muted-foreground">{{ t('games.tracer') }}</p>
    <p v-if="!presets.length" class="mb-6">
      {{ t('presets.empty') }}
      <NuxtLink to="/models" class="underline">{{ t('nav.models') }}</NuxtLink>
    </p>
    <form class="grid gap-6" @submit.prevent="create">
      <div v-for="seat in 5" :key="seat" class="grid grid-cols-[7rem_1fr] items-center gap-4">
        <Label :for="`seat-${seat}`">{{ t('games.seat', { seat }) }}</Label>
        <Select v-model="choices[seat - 1]">
          <SelectTrigger :id="`seat-${seat}`"
            ><SelectValue :placeholder="t('games.selectPreset')"
          /></SelectTrigger>
          <SelectContent
            ><SelectItem v-for="preset in presets" :key="preset.id" :value="String(preset.id)">{{
              preset.name
            }}</SelectItem></SelectContent
          >
        </Select>
      </div>
      <div class="grid grid-cols-[7rem_1fr] items-center gap-4">
        <Label for="game-language">{{ t('games.language') }}</Label>
        <Select v-model="language"
          ><SelectTrigger id="game-language"><SelectValue /></SelectTrigger
          ><SelectContent
            ><SelectItem value="zh">中文</SelectItem
            ><SelectItem value="en">English</SelectItem></SelectContent
          ></Select
        >
      </div>
      <div class="grid grid-cols-[7rem_1fr] items-center gap-4">
        <Label for="speech-limit">{{ t('games.speechLimit') }}</Label>
        <Input
          id="speech-limit"
          v-model.number="speechLimit"
          type="number"
          min="1"
          step="1"
          required
        />
      </div>
      <p v-if="error" role="alert" class="text-destructive">{{ error }}</p>
      <Button
        class="justify-self-start"
        :disabled="busy || choices.some((choice) => !choice)"
        type="submit"
        >{{ busy ? t('games.starting') : t('games.start') }}</Button
      >
    </form>
  </section>
</template>
