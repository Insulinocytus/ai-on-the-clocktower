<script setup lang="ts">
import Button from '@/components/grimoire/Button.vue'
import Input from '@/components/grimoire/Input.vue'
import Select from '@/components/grimoire/Select.vue'
import SegmentedControl from '@/components/grimoire/SegmentedControl.vue'
import type { Preset } from '#shared/types/models'
import { createGame, getGame, listPresets } from '@/api'
import type { GameConfig, DiscretionSource, DiscretionId } from '#shared/types/game'
import { characterIconUrl } from '@/utils/character-icons'
import { DISCRETION_IDS } from '#shared/game/rules'

const { t, locale } = useI18n()
const presets = ref<Preset[]>([])
const error = ref('')
try {
  presets.value = await listPresets()
} catch (cause) {
  error.value = apiErrorMessage(cause)
}
const route = useRoute()
const templateId = typeof route.query.template === 'string' ? route.query.template : undefined
const templateError = ref('')
let templateConfig: GameConfig | undefined
if (templateId) {
  try {
    const game = await getGame(templateId)
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
const sources = ['random', 'storyteller', 'manual'] as const
const presetOptions = computed(() =>
  presets.value.map((preset) => ({ value: String(preset.id), label: preset.name })),
)
const sourceOptions = computed(() =>
  sources.map((value) => ({ value, label: t(`games.sources.${value}`) })),
)
const discretionIcons: Record<DiscretionId, string | undefined> = {
  D1: '/botc/editions/tb/logo.webp',
  seating: undefined,
  D2: characterIconUrl('drunk'),
  D3: characterIconUrl('fortuneteller'),
  D4: characterIconUrl('washerwoman'),
  D5: characterIconUrl('librarian'),
  D6: characterIconUrl('investigator'),
  D7: characterIconUrl('imp'),
  D8: characterIconUrl('poisoner'),
  D10: characterIconUrl('spy'),
  D11: characterIconUrl('recluse'),
  D12: characterIconUrl('mayor'),
  D13: characterIconUrl('soldier'),
  D14: characterIconUrl('scarletwoman'),
}
function setAll(source: DiscretionSource) {
  for (const id of DISCRETION_IDS) form.discretions[id] = source
}

async function create() {
  if (templateError.value || invalidPresets.value) return
  busy.value = true
  error.value = ''
  try {
    const game = await createGame({
      ...form,
      presets: form.presets.map(Number),
      storyteller: form.storyteller ? Number(form.storyteller) : null,
    })
    await navigateTo(`/games/${game.id}`)
  } catch (cause) {
    error.value = apiErrorMessage(cause)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <section class="new-game">
    <header class="new-game-header">
      <h1>{{ t('games.new') }}</h1>
      <p>{{ t('games.setupHelp') }}</p>
    </header>
    <p v-if="templateId" class="mb-6 text-sm text-muted">
      {{ t('games.templateFrom', { id: templateId.slice(0, 8) }) }}
    </p>
    <p v-if="templateError" role="alert" class="mb-6 text-accent">{{ templateError }}</p>
    <p v-if="!presets.length" class="mb-6">
      {{ t('presets.empty') }}
      <NuxtLink to="/models" class="underline">{{ t('nav.models') }}</NuxtLink>
    </p>
    <form @submit.prevent="create">
      <div class="new-game-columns">
        <div>
          <section aria-labelledby="seats-heading">
            <div class="seats-header">
              <h2 id="seats-heading">{{ t('games.seatsHeading') }}</h2>
              <label for="seat-count">{{ t('games.seatCount') }}</label>
              <Select
                id="seat-count"
                v-model="seatCount"
                :options="
                  Array.from({ length: 11 }, (_, index) => ({
                    value: String(index + 5),
                    label: String(index + 5),
                  }))
                "
              />
            </div>
            <div v-for="(choice, index) in form.presets" :key="index" class="seat-row">
              <label :for="`seat-${index + 1}`">{{ t('games.seat', { seat: index + 1 }) }}</label>
              <Select
                :id="`seat-${index + 1}`"
                v-model="form.presets[index]"
                :options="presetOptions"
                :placeholder="t('games.selectPreset')"
                :invalid="!choice || missingPreset(choice)"
                :aria-describedby="missingPreset(choice) ? `missing-seat-${index + 1}` : undefined"
              />
              <p
                v-if="missingPreset(choice)"
                :id="`missing-seat-${index + 1}`"
                role="alert"
                class="col-start-2 text-sm text-accent"
              >
                {{
                  t('games.deletedPreset', { name: templateConfig?.seats[index]?.name ?? choice })
                }}
              </p>
            </div>
          </section>
          <section class="game-settings" aria-labelledby="settings-heading">
            <h2 id="settings-heading">{{ t('games.settingsHeading') }}</h2>
            <div v-if="needsStoryteller" class="setting-row">
              <label for="storyteller">{{ t('games.storyteller') }}</label>
              <Select
                id="storyteller"
                v-model="form.storyteller"
                :options="presetOptions"
                :placeholder="t('games.selectPreset')"
                :invalid="missingPreset(form.storyteller)"
                :aria-describedby="
                  missingPreset(form.storyteller) ? 'missing-storyteller' : undefined
                "
              />
              <p
                v-if="missingPreset(form.storyteller)"
                id="missing-storyteller"
                role="alert"
                class="col-span-2 text-sm text-accent"
              >
                {{
                  t('games.deletedPreset', {
                    name: templateConfig?.storyteller?.name ?? form.storyteller,
                  })
                }}
              </p>
            </div>
            <div class="setting-row">
              <label for="game-language">{{ t('games.language') }}</label>
              <Select
                id="game-language"
                v-model="form.language"
                :options="[
                  { value: 'zh', label: '中文' },
                  { value: 'en', label: 'English' },
                ]"
              />
            </div>
            <div class="setting-row">
              <label for="speech-limit">{{ t('games.speechLimit') }}</label>
              <Input
                id="speech-limit"
                v-model.number="form.speechLimit"
                type="number"
                min="1"
                step="1"
                required
              />
            </div>
            <div class="setting-row">
              <label for="whisper-limit">{{ t('games.whisperLimit') }}</label>
              <Input
                id="whisper-limit"
                v-model.number="form.whisperLimit"
                type="number"
                min="0"
                step="1"
                required
              />
            </div>
          </section>
        </div>
        <section aria-labelledby="discretions-heading">
          <div class="discretions-header">
            <h2 id="discretions-heading">{{ t('games.discretions') }}</h2>
            <span id="batch-label">{{ t('games.setAll') }}</span>
            <div class="grimoire-segmented" role="group" aria-labelledby="batch-label">
              <button
                v-for="option in sourceOptions"
                :key="option.value"
                type="button"
                class="grimoire-segmented-option"
                @click="setAll(option.value)"
              >
                {{ option.label }}
              </button>
            </div>
          </div>
          <p class="discretions-help">{{ t('games.discretionsHelp') }}</p>
          <div v-for="id in DISCRETION_IDS" :key="id" class="discretion-row">
            <span
              class="discretion-icon round-token"
              :class="{ 'discretion-icon--empty': id === 'seating' }"
              aria-hidden="true"
            >
              <img v-if="discretionIcons[id]" :src="discretionIcons[id]" alt="" />
            </span>
            <div :id="`source-${id}-label`" class="discretion-name">
              <span>{{ t(`games.discretionNames.${id}`) }}</span>
              <span class="discretion-id">{{ id }}</span>
            </div>
            <SegmentedControl
              v-model="form.discretions[id]"
              :options="sourceOptions"
              :aria-labelledby="`source-${id}-label`"
            />
          </div>
        </section>
      </div>
      <footer class="new-game-footer">
        <Button :disabled="busy || !!templateError || invalidPresets" type="submit">
          {{ busy ? t('games.starting') : t('games.start') }}
        </Button>
        <p v-if="error" role="alert" class="text-sm text-accent">{{ error }}</p>
        <p v-else-if="form.presets.includes('')" class="text-sm text-accent">
          {{ t('games.unselectedPreset', { seat: form.presets.indexOf('') + 1 }) }}
        </p>
      </footer>
    </form>
  </section>
</template>

<style scoped>
.new-game-header {
  margin-bottom: calc(var(--space-10) + var(--space-3));
}

.new-game-header h1 {
  margin-bottom: var(--space-2);
}

.new-game-header p {
  color: var(--ink2);
  font-size: var(--font-size-body);
  line-height: var(--line-height-body);
}

.new-game-columns {
  display: grid;
  grid-template-columns: 400px 640px;
  gap: calc(var(--space-10) * 2);
}

.new-game h2 {
  font-size: var(--font-size-title);
  font-weight: var(--font-weight-medium);
  line-height: var(--line-height-heading);
}

.seats-header,
.discretions-header {
  display: grid;
  grid-template-columns: 1fr auto auto;
  align-items: center;
  gap: var(--space-3);
  min-height: var(--size-field);
}

.seats-header {
  padding-right: var(--space-4);
  margin-bottom: var(--space-6);
}

.seats-header label,
.discretions-header > span {
  color: var(--muted);
  font-size: var(--font-size-ui);
}

.seats-header :deep(.grimoire-select-trigger) {
  width: 88px;
  font-family: var(--font-family-serif);
}

.seat-row {
  display: grid;
  grid-template-columns: 64px 1fr;
  align-items: center;
  column-gap: var(--space-4);
  row-gap: var(--space-2);
  min-height: 64px;
  padding-block: var(--space-3);
  border-block-start: 1px solid var(--rule);
}

.seat-row:last-child {
  border-block-end: 1px solid var(--rule);
}

.seat-row label {
  font-family: var(--font-family-serif);
  font-size: var(--font-size-title-sm);
  white-space: nowrap;
}

.game-settings {
  margin-top: calc(var(--space-10) + var(--space-2));
}

.game-settings h2 {
  margin-bottom: var(--space-5);
}

.setting-row {
  display: grid;
  grid-template-columns: 1fr 168px;
  align-items: center;
  gap: var(--space-3);
  margin-top: var(--space-4);
  font-size: var(--font-size-ui);
  color: var(--ink2);
}

.discretions-help {
  margin-top: var(--space-1);
  margin-bottom: var(--space-4);
  color: var(--muted);
  font-size: var(--font-size-ui);
  line-height: var(--line-height-ui);
}

.discretion-row {
  display: grid;
  grid-template-columns: var(--size-discretion-icon) 1fr auto;
  align-items: center;
  gap: var(--space-4);
  min-height: 52px;
  border-block-start: 1px solid var(--rule);
}

.discretion-row:last-child {
  border-block-end: 1px solid var(--rule);
}

.discretion-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: var(--size-discretion-icon);
  height: var(--size-discretion-icon);
  overflow: hidden;
}

.discretion-icon img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.discretion-icon--empty {
  border-color: var(--rule);
  background: var(--paper3);
}

.discretion-name {
  display: grid;
  font-size: var(--font-size-ui);
  line-height: var(--line-height-ui);
}

.discretion-id {
  color: var(--muted);
  font-size: var(--font-size-caption);
}

.new-game-footer {
  position: relative;
  display: flex;
  align-items: center;
  gap: var(--space-5);
  margin-top: calc(var(--space-10) * 2 + var(--space-8));
  padding-block: var(--space-8);
}

.new-game-footer::before {
  position: absolute;
  inset-block-start: 0;
  inset-inline-start: calc(50% - 50vw);
  width: 100vw;
  border-top: 1px solid var(--rule);
  content: '';
}
</style>
