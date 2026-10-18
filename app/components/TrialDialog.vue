<script setup lang="ts">
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { Preset, TrialResult } from '#shared/types/models'

const props = defineProps<{ preset?: Preset }>()
const open = defineModel<boolean>('open', { required: true })
const { t, locale } = useI18n()

const result = ref<TrialResult>()
const error = ref<string>()
const running = ref(false)

async function run() {
  if (!props.preset) return
  running.value = true
  result.value = undefined
  error.value = undefined
  try {
    // Passing a plain string keeps Nitro's typed-route inference from exhausting the type checker here.
    const url = `/api/presets/${String(props.preset.id)}/trial`
    result.value = await $fetch<TrialResult>(url, {
      method: 'POST',
      body: { lang: locale.value },
    })
  } catch (e) {
    error.value = apiErrorMessage(e)
  } finally {
    running.value = false
  }
}

watch(open, (isOpen) => {
  if (isOpen) void run()
})

const pretty = (value: unknown) =>
  typeof value === 'string' ? value : JSON.stringify(value, null, 2)
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
      <DialogHeader>
        <DialogTitle>{{ t('trial.title', { name: preset?.name }) }}</DialogTitle>
        <DialogDescription>{{ t('trial.description') }}</DialogDescription>
      </DialogHeader>
      <p v-if="running" class="text-sm text-muted-foreground">{{ t('trial.running') }}</p>
      <p v-else-if="error" class="text-sm whitespace-pre-wrap text-destructive">{{ error }}</p>
      <div v-else-if="result" class="grid min-w-0 gap-4">
        <div class="flex flex-wrap items-center gap-2">
          <Badge :variant="result.valid ? 'default' : 'destructive'">
            {{ result.valid ? t('trial.valid') : t('trial.invalid') }}
          </Badge>
          <span v-if="result.error" class="text-sm text-destructive">{{ result.error }}</span>
        </div>
        <section v-if="result.toolCall" class="grid gap-1">
          <h3 class="text-sm font-medium">{{ t('trial.toolCall') }}: {{ result.toolCall.name }}</h3>
          <pre class="overflow-x-auto rounded-md bg-muted p-3 text-xs">{{
            pretty(result.toolCall.arguments)
          }}</pre>
        </section>
        <section class="grid gap-1">
          <h3 class="text-sm font-medium">{{ t('trial.raw') }}</h3>
          <pre class="max-h-96 overflow-auto rounded-md bg-muted p-3 text-xs">{{
            pretty(result.raw)
          }}</pre>
        </section>
      </div>
      <DialogFooter>
        <Button variant="outline" :disabled="running" @click="run">{{ t('trial.retry') }}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
