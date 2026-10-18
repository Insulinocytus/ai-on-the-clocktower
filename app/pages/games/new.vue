<script setup lang="ts">
import type { ApiError, CreateGameBody, CreateGameResponse, GameDetail, Preset } from '#shared/api'
import { DISCRETION_IDS } from '#shared/rules/types'
import type { DiscretionId, DiscretionSource, Lang, PresetSnapshot } from '#shared/rules/types'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'

const { t, locale } = useI18n()
const route = useRoute()
const localePath = useLocalePath()
const templateId = computed(() => typeof route.query.from === 'string' ? route.query.from : '')
const presets = ref<Preset[]>([])
const loading = ref(true)
const loadFailed = ref(false)
const creating = ref(false)
const createFailed = ref(false)
const missingEnv = ref<string[]>([])
const seatCount = ref(8)
const seatPresets = ref<string[]>(Array(15).fill(''))
const snapshots = ref<(PresetSnapshot | null)[]>(Array(15).fill(null))
const storytellerPresetId = ref('')
const storytellerSnapshot = ref<PresetSnapshot | null>(null)
const sources = ref<Record<DiscretionId, DiscretionSource>>(manualSources())
const maxSpeeches = ref(10)
const whisperRooms = ref(3)
const language = ref<Lang>(locale.value === 'en' ? 'en' : 'zh')
const sourceOptions: DiscretionSource[] = ['random', 'storyteller', 'manual']
const presetIds = computed(() => new Set(presets.value.map(preset => preset.id)))
const needsStoryteller = computed(() => DISCRETION_IDS.some(id => sources.value[id] === 'storyteller'))
const activeSeats = computed(() => Array.from({ length: seatCount.value }, (_, index) => index))
const storytellerMissing = computed(() => Boolean(storytellerPresetId.value) && !presetIds.value.has(storytellerPresetId.value))
const valid = computed(() =>
  Number.isInteger(seatCount.value) && seatCount.value >= 5 && seatCount.value <= 15
  && activeSeats.value.every(index => presetIds.value.has(seatPresets.value[index] ?? ''))
  && (!needsStoryteller.value || presetIds.value.has(storytellerPresetId.value))
  && Number.isSafeInteger(maxSpeeches.value) && maxSpeeches.value >= 1
  && Number.isSafeInteger(whisperRooms.value) && whisperRooms.value >= 0,
)

function manualSources(): Record<DiscretionId, DiscretionSource> {
  return Object.fromEntries(DISCRETION_IDS.map(id => [id, 'manual'])) as Record<DiscretionId, DiscretionSource>
}

function setAllSources(source: DiscretionSource) {
  for (const id of DISCRETION_IDS) sources.value[id] = source
}

function isMissing(index: number) {
  const id = seatPresets.value[index]
  return Boolean(id) && !presetIds.value.has(id ?? '')
}

function deletedName(index: number) {
  return snapshots.value[index]?.name ?? seatPresets.value[index] ?? ''
}

let loadController: AbortController | undefined

async function load() {
  loadController?.abort()
  const controller = new AbortController()
  loadController = controller
  loading.value = true
  loadFailed.value = false
  createFailed.value = false
  missingEnv.value = []
  try {
    const [availablePresets, template] = await Promise.all([
      $fetch<Preset[]>('/api/presets', { signal: controller.signal }),
      templateId.value
        ? $fetch<GameDetail>(`/api/games/${encodeURIComponent(templateId.value)}`, { signal: controller.signal })
        : Promise.resolve(null),
    ])
    if (controller.signal.aborted) return
    presets.value = availablePresets
    const config = template?.config
    seatCount.value = config?.seatCount ?? 8
    seatPresets.value = Array.from({ length: 15 }, (_, index) => config?.seats[index]?.presetId ?? '')
    snapshots.value = Array.from({ length: 15 }, (_, index) => config?.seats[index] ?? null)
    storytellerPresetId.value = config?.storyteller?.presetId ?? ''
    storytellerSnapshot.value = config?.storyteller ?? null
    sources.value = config ? { ...config.sources } : manualSources()
    maxSpeeches.value = config?.maxSpeeches ?? 10
    whisperRooms.value = config?.whisperRooms ?? 3
    language.value = config?.language ?? (locale.value === 'en' ? 'en' : 'zh')
  } catch {
    if (!controller.signal.aborted) loadFailed.value = true
  } finally {
    if (!controller.signal.aborted) loading.value = false
  }
}

function apiError(error: unknown): ApiError | null {
  if (!error || typeof error !== 'object' || !('data' in error)) return null
  const data: unknown = error.data
  if (!data || typeof data !== 'object' || !('error' in data) || typeof data.error !== 'string') return null
  return {
    error: data.error,
    missing: 'missing' in data && Array.isArray(data.missing)
      ? data.missing.filter((value: unknown): value is string => typeof value === 'string')
      : undefined,
  }
}

async function createGame() {
  if (!valid.value || creating.value || loading.value) return
  creating.value = true
  createFailed.value = false
  missingEnv.value = []
  const body: CreateGameBody = {
    seatCount: seatCount.value,
    seats: seatPresets.value.slice(0, seatCount.value),
    storytellerPresetId: needsStoryteller.value ? storytellerPresetId.value : null,
    sources: { ...sources.value },
    maxSpeeches: maxSpeeches.value,
    whisperRooms: whisperRooms.value,
    language: language.value,
  }
  try {
    const game = await $fetch<CreateGameResponse>('/api/games', { method: 'POST', body })
    await navigateTo(localePath(`/games/${encodeURIComponent(game.id)}`))
  } catch (error: unknown) {
    const response = apiError(error)
    if (response?.error === 'missing_env' && response.missing?.length) missingEnv.value = response.missing
    else createFailed.value = true
  } finally {
    creating.value = false
  }
}

watch(templateId, load, { immediate: true })
onBeforeUnmount(() => loadController?.abort())
</script>

<template>
  <main class="page new-game-page">
    <header class="page-heading">
      <div>
        <h1>{{ t('newGame.title') }}</h1>
        <p class="muted">{{ t('newGame.description') }}</p>
      </div>
      <NuxtLink :to="localePath('/')" class="back-link">{{ t('newGame.back') }}</NuxtLink>
    </header>

    <p v-if="loading" class="panel muted" role="status">{{ t('newGame.loading') }}</p>
    <section v-else-if="loadFailed" class="panel" role="alert">
      <p class="error">{{ t('newGame.loadError') }}</p>
      <Button variant="outline" @click="load">{{ t('newGame.retry') }}</Button>
    </section>

    <form v-else class="configuration-form" @submit.prevent="createGame">
      <p v-if="templateId" class="template-notice">{{ t('newGame.templateNotice') }}</p>
      <section v-if="!presets.length" class="panel empty-presets">
        <div>
          <h2>{{ t('newGame.noPresetsTitle') }}</h2>
          <p class="muted">{{ t('newGame.noPresetsDescription') }}</p>
        </div>
        <NuxtLink :to="localePath('/models')" class="back-link">{{ t('newGame.manageModels') }}</NuxtLink>
      </section>

      <fieldset :disabled="creating" class="configuration-fields">
        <div class="setup-columns">
          <section class="panel seats-panel" aria-labelledby="seats-heading">
            <div class="section-heading">
              <div>
                <h2 id="seats-heading">{{ t('newGame.seatsTitle') }}</h2>
                <p class="muted">{{ t('newGame.seatsDescription') }}</p>
              </div>
              <div class="field seat-count-field">
                <Label for="seat-count">{{ t('newGame.seatCount') }}</Label>
                <select id="seat-count" v-model.number="seatCount">
                  <option v-for="count in 11" :key="count" :value="count + 4">{{ count + 4 }}</option>
                </select>
              </div>
            </div>
            <div class="seat-grid">
              <div v-for="index in activeSeats" :key="index" class="field seat-field" :class="{ 'missing-preset': isMissing(index) }">
                <Label :for="`seat-${index + 1}`">{{ t('newGame.seat', { seat: index + 1 }) }}</Label>
                <select
                  :id="`seat-${index + 1}`"
                  v-model="seatPresets[index]"
                  required
                  :aria-invalid="isMissing(index)"
                  :aria-describedby="isMissing(index) ? `seat-${index + 1}-error` : undefined"
                >
                  <option value="" disabled>{{ t('newGame.choosePreset') }}</option>
                  <option v-if="isMissing(index)" :value="seatPresets[index]" disabled>{{ t('newGame.deletedPreset', { name: deletedName(index) }) }}</option>
                  <option v-for="preset in presets" :key="preset.id" :value="preset.id">{{ preset.name }}</option>
                </select>
                <p v-if="isMissing(index)" :id="`seat-${index + 1}-error`" class="error">{{ t('newGame.repickPreset', { name: deletedName(index) }) }}</p>
              </div>
            </div>
          </section>

          <section class="panel pacing-panel" aria-labelledby="pacing-heading">
            <h2 id="pacing-heading">{{ t('newGame.pacingTitle') }}</h2>
            <div class="field">
              <Label for="game-language">{{ t('newGame.language') }}</Label>
              <select id="game-language" v-model="language">
                <option value="zh">{{ t('newGame.chinese') }}</option>
                <option value="en">{{ t('newGame.english') }}</option>
              </select>
              <p class="muted">{{ t('newGame.languageDescription') }}</p>
            </div>
            <div class="field">
              <Label for="max-speeches">{{ t('newGame.maxSpeeches') }}</Label>
              <Input id="max-speeches" :model-value="maxSpeeches" type="number" min="1" step="1" required @update:model-value="maxSpeeches = Number($event)" />
              <p class="muted">{{ t('newGame.maxSpeechesDescription') }}</p>
            </div>
            <div class="field">
              <Label for="whisper-rooms">{{ t('newGame.whisperRooms') }}</Label>
              <Input id="whisper-rooms" :model-value="whisperRooms" type="number" min="0" step="1" required @update:model-value="whisperRooms = Number($event)" />
              <p class="muted">{{ t('newGame.whisperRoomsDescription') }}</p>
            </div>
          </section>
        </div>

        <section class="panel discretion-panel" aria-labelledby="discretions-heading">
          <div class="section-heading">
            <div>
              <h2 id="discretions-heading">{{ t('newGame.discretionsTitle') }}</h2>
              <p class="muted">{{ t('newGame.discretionsDescription') }}</p>
            </div>
            <div class="bulk-actions" role="group" :aria-label="t('newGame.bulkLabel')">
              <Button v-for="source in sourceOptions" :key="source" type="button" variant="outline" size="sm" @click="setAllSources(source)">
                {{ t(`newGame.bulk.${source}`) }}
              </Button>
            </div>
          </div>
          <div class="discretion-grid">
            <div v-for="id in DISCRETION_IDS" :key="id" class="discretion-row">
              <div>
                <Label :for="`source-${id}`">{{ t(`newGame.discretions.${id}.label`) }}</Label>
                <p :id="`source-${id}-description`" class="muted">{{ t(`newGame.discretions.${id}.description`) }}</p>
              </div>
              <select :id="`source-${id}`" v-model="sources[id]" :aria-describedby="`source-${id}-description`">
                <option v-for="source in sourceOptions" :key="source" :value="source">{{ t(`newGame.sources.${source}`) }}</option>
              </select>
            </div>
          </div>
          <div v-if="needsStoryteller" class="field storyteller-field" :class="{ 'missing-preset': storytellerMissing }">
            <Label for="storyteller-preset">{{ t('newGame.storytellerPreset') }}</Label>
            <select id="storyteller-preset" v-model="storytellerPresetId" required :aria-invalid="storytellerMissing" aria-describedby="storyteller-description">
              <option value="" disabled>{{ t('newGame.choosePreset') }}</option>
              <option v-if="storytellerMissing" :value="storytellerPresetId" disabled>{{ t('newGame.deletedPreset', { name: storytellerSnapshot?.name ?? storytellerPresetId }) }}</option>
              <option v-for="preset in presets" :key="preset.id" :value="preset.id">{{ preset.name }}</option>
            </select>
            <p id="storyteller-description" :class="storytellerMissing ? 'error' : 'muted'">
              {{ storytellerMissing ? t('newGame.repickPreset', { name: storytellerSnapshot?.name ?? storytellerPresetId }) : t('newGame.storytellerDescription') }}
            </p>
          </div>
        </section>
      </fieldset>

      <section v-if="missingEnv.length" class="panel environment-error" role="alert">
        <h2>{{ t('newGame.missingEnvTitle') }}</h2>
        <p>{{ t('newGame.missingEnvDescription') }}</p>
        <ul><li v-for="variable in missingEnv" :key="variable"><code>{{ variable }}</code></li></ul>
      </section>
      <p v-if="createFailed" class="error" role="alert">{{ t('newGame.createError') }}</p>
      <footer class="create-footer">
        <p class="muted">{{ valid ? t('newGame.startDescription') : t('newGame.incomplete') }}</p>
        <Button type="submit" size="lg" :disabled="!valid || creating" :aria-busy="creating">{{ creating ? t('newGame.creating') : t('newGame.create') }}</Button>
      </footer>
    </form>
  </main>
</template>

<style scoped>
.new-game-page { max-width: 1240px; }
.configuration-form, .configuration-fields { display: grid; gap: 24px; }
.configuration-fields { min-width: 0; margin: 0; padding: 0; border: 0; }
.setup-columns { display: grid; grid-template-columns: minmax(0, 1.65fr) minmax(290px, 1fr); gap: 24px; align-items: start; }
h2 { margin: 0; font-size: 17px; font-weight: 650; }
.section-heading { display: flex; align-items: start; justify-content: space-between; gap: 24px; margin-bottom: 24px; }
.section-heading p, .pacing-panel p, .discretion-row p, .storyteller-field p { margin: 7px 0 0; font-size: 13px; line-height: 1.5; }
.seat-count-field { width: 100px; flex-shrink: 0; }
.seat-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 20px; }
.seat-field { min-width: 0; }
.seat-field .error { font-size: 12px; line-height: 1.5; margin: 0; }
.pacing-panel { display: grid; gap: 23px; }
select { width: 100%; min-width: 0; height: 38px; padding: 0 32px 0 11px; border: 1px solid #d8dee8; border-radius: 6px; background-color: white; color: #1e293b; font: inherit; font-size: 14px; }
select:focus-visible { outline: 2px solid #6366f1; outline-offset: 2px; }
select:disabled { opacity: .6; }
.missing-preset select { border-color: #dc2626; background-color: #fff7f7; color: #b91c1c; }
.bulk-actions { display: flex; gap: 8px; flex-wrap: wrap; justify-content: end; }
.discretion-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); column-gap: 32px; }
.discretion-row { display: grid; grid-template-columns: minmax(0, 1fr) 148px; gap: 20px; align-items: center; padding: 18px 0; border-top: 1px solid #e8ecf2; }
.storyteller-field { margin-top: 18px; padding-top: 24px; border-top: 1px solid #e8ecf2; max-width: 560px; }
.template-notice { margin: 0; padding: 14px 18px; border-left: 3px solid #6366f1; background: #eef2ff; color: #3730a3; font-size: 14px; }
.empty-presets { display: flex; align-items: center; justify-content: space-between; gap: 24px; }
.empty-presets p { margin-bottom: 0; }
.back-link { color: #4f46e5; font-size: 14px; white-space: nowrap; text-decoration: underline; text-underline-offset: 3px; }
.environment-error { border-color: #fecaca; color: #b91c1c; background: #fff7f7; }
.environment-error p { font-size: 14px; }
.environment-error ul { margin-bottom: 0; padding-left: 20px; }
.create-footer { display: flex; justify-content: space-between; align-items: center; gap: 24px; padding-bottom: 24px; }
.create-footer p { font-size: 14px; }
@media (max-width: 1050px) {
  .discretion-grid { grid-template-columns: 1fr; }
  .discretion-panel > .section-heading { flex-direction: column; gap: 16px; }
}
</style>
