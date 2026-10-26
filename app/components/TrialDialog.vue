<script setup lang="ts">
import Button from '@/components/grimoire/Button.vue'
import Badge from '@/components/grimoire/Badge.vue'
import Dialog from '@/components/grimoire/Dialog.vue'
import { trialPreset } from '@/api'
import type { Preset, TrialResult } from '#shared/types/models'

const props = defineProps<{ preset?: Preset }>()
const open = defineModel<boolean>('open', { required: true })
const { t, locale } = useI18n()

const result = ref<TrialResult>()
const error = ref<string>()
const running = ref(false)
let controller: AbortController | undefined

async function run() {
  if (!props.preset) return
  controller?.abort()
  const request = new AbortController()
  controller = request
  running.value = true
  result.value = undefined
  error.value = undefined
  try {
    const response = await trialPreset(props.preset.id, { lang: locale.value }, request.signal)
    if (!request.signal.aborted) result.value = response
  } catch (e) {
    if (!request.signal.aborted) error.value = apiErrorMessage(e)
  } finally {
    if (!request.signal.aborted) running.value = false
  }
}

watch(open, (isOpen) => {
  if (isOpen) void run()
  else controller?.abort()
})

onBeforeUnmount(() => controller?.abort())

const pretty = (value: unknown) =>
  typeof value === 'string' ? value : JSON.stringify(value, null, 2)
</script>

<template>
  <Dialog
    v-model:open="open"
    :title="t('trial.title', { name: preset?.name })"
    :description="t('trial.description')"
    size="wide"
  >
    <p v-if="running" class="text-sm text-muted-foreground">{{ t('trial.running') }}</p>
    <p v-else-if="error" role="alert" class="text-sm whitespace-pre-wrap text-accent">
      {{ error }}
    </p>
    <div v-else-if="result" class="grid min-w-0 gap-5">
      <div class="flex flex-wrap items-center gap-2">
        <Badge :class="{ 'trial-invalid': !result.valid }">
          {{ result.valid ? t('trial.valid') : t('trial.invalid') }}
        </Badge>
        <span v-if="result.error" class="text-sm text-accent">{{ result.error }}</span>
      </div>
      <section v-if="result.toolCall" class="grid gap-2">
        <h3 class="font-sans text-sm font-medium">
          {{ t('trial.toolCall') }}: {{ result.toolCall.name }}
        </h3>
        <pre class="trial-response">{{ pretty(result.toolCall.arguments) }}</pre>
      </section>
      <section class="grid gap-2">
        <h3 class="font-sans text-sm font-medium">{{ t('trial.raw') }}</h3>
        <pre class="trial-response max-h-[180px]">{{ pretty(result.raw) }}</pre>
      </section>
    </div>
    <template #footer>
      <Button variant="secondary" :disabled="running" @click="run">{{ t('trial.retry') }}</Button>
    </template>
  </Dialog>
</template>

<style scoped>
.trial-response {
  overflow: auto;
  border-radius: var(--radius-thought);
  background: var(--paper);
  padding: var(--space-4);
  color: var(--ink2);
  font-family: var(--font-family-sans);
  font-size: var(--font-size-small);
  line-height: var(--line-height-body);
}

.trial-invalid {
  border-color: var(--accent);
  color: var(--accent);
}
</style>
