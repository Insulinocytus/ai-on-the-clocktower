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
import type { GameConfig, DiscretionSource } from '#shared/types/game'
import { DISCRETION_IDS } from '#shared/game/rules'

const { t, locale } = useI18n()
const { data: presets } = await useFetch<Preset[]>('/api/presets', { default: () => [] })
const route = useRoute()
const templateId = typeof route.query.template === 'string' ? route.query.template : undefined
const templateError = ref('')
let templateConfig: GameConfig | undefined
if (templateId) {
  try {
    const game = await $fetch<GameSummary>(`/api/games/${encodeURIComponent(templateId)}`)
    if (!game.compatible) throw new Error(t('games.incompatible'))
    templateConfig = game.config
  } catch (cause) {
    templateError.value = apiErrorMessage(cause)
  }
}
const form = reactive({
  ...templateConfig,
  presets:
    templateConfig?.seats.map((seat) => String(seat.id)) ?? Array.from({ length: 5 }, () => ''),
  storyteller: templateConfig?.storyteller ? String(templateConfig.storyteller.id) : '',
  discretions: Object.fromEntries(
    DISCRETION_IDS.map((id) => [id, templateConfig?.discretions[id] ?? 'manual']),
  ) as GameConfig['discretions'],
  language: templateConfig?.language ?? (locale.value === 'zh' ? 'zh' : 'en'),
  speechLimit: templateConfig?.speechLimit ?? 10,
  whisperLimit: templateConfig?.whisperLimit ?? 3,
})
const seatCount = computed({
  get: () => String(form.presets.length),
  set: (value: string) => {
    form.presets = Array.from({ length: Number(value) }, (_, index) => form.presets[index] ?? '')
  },
})
const missingPreset = (id: string) =>
  !!id && !presets.value.some((preset) => String(preset.id) === id)
const needsStoryteller = computed(() => Object.values(form.discretions).includes('storyteller'))
const invalidPresets = computed(
  () =>
    form.presets.some((id) => !id || missingPreset(id)) ||
    (needsStoryteller.value && (!form.storyteller || missingPreset(form.storyteller))),
)
const busy = ref(false)
const error = ref('')
const sources = ['random', 'storyteller', 'manual'] as const
function setAll(source: DiscretionSource) {
  for (const id of DISCRETION_IDS) form.discretions[id] = source
}

async function create() {
  if (templateError.value || invalidPresets.value) return
  busy.value = true
  error.value = ''
  try {
    const game = await $fetch<GameSummary>('/api/games', {
      method: 'POST',
      body: {
        ...form,
        seatCount: form.presets.length,
        presets: form.presets.map(Number),
        storyteller: form.storyteller ? Number(form.storyteller) : null,
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
    <p class="mb-8 text-sm leading-6 text-muted-foreground">{{ t('games.setupHelp') }}</p>
    <p v-if="templateId" class="mb-6 text-sm text-muted-foreground">
      {{ t('games.templateFrom', { id: templateId.slice(0, 8) }) }}
    </p>
    <p v-if="templateError" role="alert" class="mb-6 text-destructive">{{ templateError }}</p>
    <p v-if="!presets.length" class="mb-6">
      {{ t('presets.empty') }}
      <NuxtLink to="/models" class="underline">{{ t('nav.models') }}</NuxtLink>
    </p>
    <form class="grid gap-6" @submit.prevent="create">
      <div class="grid grid-cols-[7rem_1fr] items-center gap-4">
        <Label for="seat-count">{{ t('games.seatCount') }}</Label>
        <Select v-model="seatCount">
          <SelectTrigger id="seat-count"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem v-for="count in 11" :key="count" :value="String(count + 4)">
              {{ count + 4 }}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div
        v-for="(choice, index) in form.presets"
        :key="index"
        class="grid grid-cols-[7rem_1fr] items-center gap-4"
      >
        <Label :for="`seat-${index + 1}`">{{ t('games.seat', { seat: index + 1 }) }}</Label>
        <Select v-model="form.presets[index]">
          <SelectTrigger
            :id="`seat-${index + 1}`"
            :class="{ 'border-destructive text-destructive': missingPreset(choice) }"
            :aria-invalid="missingPreset(choice)"
            :aria-describedby="missingPreset(choice) ? `missing-seat-${index + 1}` : undefined"
            ><SelectValue :placeholder="t('games.selectPreset')"
          /></SelectTrigger>
          <SelectContent
            ><SelectItem v-for="preset in presets" :key="preset.id" :value="String(preset.id)">{{
              preset.name
            }}</SelectItem></SelectContent
          >
        </Select>
        <p
          v-if="missingPreset(choice)"
          :id="`missing-seat-${index + 1}`"
          role="alert"
          class="col-start-2 text-sm text-destructive"
        >
          {{ t('games.deletedPreset', { name: templateConfig?.seats[index]?.name ?? choice }) }}
        </p>
      </div>
      <fieldset class="grid gap-4">
        <legend class="mb-3 font-medium">{{ t('games.discretions') }}</legend>
        <div class="flex flex-wrap gap-2">
          <Button
            v-for="source in sources"
            :key="source"
            type="button"
            variant="outline"
            size="sm"
            @click="setAll(source)"
            >{{ t('manual.batch', { source: t(`games.sources.${source}`) }) }}</Button
          >
        </div>
        <div
          v-for="id in DISCRETION_IDS"
          :key="id"
          class="grid grid-cols-[7rem_1fr] items-center gap-4"
        >
          <Label :for="`source-${id}`">{{ id === 'seating' ? t('games.seating') : id }}</Label>
          <Select v-model="form.discretions[id]">
            <SelectTrigger :id="`source-${id}`"
              ><SelectValue>{{
                t(`games.sources.${form.discretions[id]}`)
              }}</SelectValue></SelectTrigger
            >
            <SelectContent>
              <SelectItem value="random">{{ t('games.sources.random') }}</SelectItem>
              <SelectItem value="storyteller">{{ t('games.sources.storyteller') }}</SelectItem>
              <SelectItem value="manual">{{ t('games.sources.manual') }}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </fieldset>
      <div v-if="needsStoryteller" class="grid grid-cols-[7rem_1fr] items-center gap-4">
        <Label for="storyteller">{{ t('games.storyteller') }}</Label>
        <Select v-model="form.storyteller">
          <SelectTrigger
            id="storyteller"
            :class="{ 'border-destructive text-destructive': missingPreset(form.storyteller) }"
            :aria-invalid="missingPreset(form.storyteller)"
            :aria-describedby="missingPreset(form.storyteller) ? 'missing-storyteller' : undefined"
            ><SelectValue :placeholder="t('games.selectPreset')"
          /></SelectTrigger>
          <SelectContent>
            <SelectItem v-for="preset in presets" :key="preset.id" :value="String(preset.id)">
              {{ preset.name }}
            </SelectItem>
          </SelectContent>
        </Select>
        <p
          v-if="missingPreset(form.storyteller)"
          id="missing-storyteller"
          role="alert"
          class="col-start-2 text-sm text-destructive"
        >
          {{
            t('games.deletedPreset', {
              name: templateConfig?.storyteller?.name ?? form.storyteller,
            })
          }}
        </p>
      </div>
      <div class="grid grid-cols-[7rem_1fr] items-center gap-4">
        <Label for="game-language">{{ t('games.language') }}</Label>
        <Select v-model="form.language"
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
          v-model.number="form.speechLimit"
          type="number"
          min="1"
          step="1"
          required
        />
      </div>
      <div class="grid grid-cols-[7rem_1fr] items-center gap-4">
        <Label for="whisper-limit">{{ t('games.whisperLimit') }}</Label>
        <Input
          id="whisper-limit"
          v-model.number="form.whisperLimit"
          type="number"
          min="0"
          step="1"
          required
        />
      </div>
      <p v-if="error" role="alert" class="text-destructive">{{ error }}</p>
      <Button
        class="justify-self-start"
        :disabled="busy || !!templateError || invalidPresets"
        type="submit"
        >{{ busy ? t('games.starting') : t('games.start') }}</Button
      >
    </form>
  </section>
</template>
