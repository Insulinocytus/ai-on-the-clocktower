<script setup lang="ts">
import Button from '@/components/grimoire/Button.vue'
import Checkbox from '@/components/grimoire/Checkbox.vue'
import Input from '@/components/grimoire/Input.vue'
import Textarea from '@/components/grimoire/Textarea.vue'
import Dialog from '@/components/grimoire/Dialog.vue'
import Select from '@/components/grimoire/Select.vue'
import { toast } from 'vue-sonner'
import { createPreset, updatePreset, type Provider } from '@/api'
import type { Preset } from '#shared/types/models'

const props = defineProps<{ preset?: Preset; providers: Provider[] }>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ saved: [] }>()
const { t } = useI18n()

const form = reactive({
  name: '',
  providerId: undefined as number | undefined,
  model: '',
  forceToolChoice: false,
  extraBody: '{}',
})

watch(open, (isOpen) => {
  if (!isOpen) return
  const { name, providerId, model, forceToolChoice, extraBody } = props.preset ?? {
    name: '',
    providerId: props.providers[0]?.id,
    model: '',
    forceToolChoice: false,
    extraBody: '{}',
  }
  Object.assign(form, { name, providerId, model, forceToolChoice, extraBody })
})

const extraBodyValid = computed(() => {
  try {
    const value: unknown = JSON.parse(form.extraBody)
    return typeof value === 'object' && value !== null && !Array.isArray(value)
  } catch {
    return false
  }
})

async function save() {
  try {
    if (props.preset) await updatePreset(props.preset.id, form)
    else await createPreset(form)
    toast.success(t('common.saved'))
    open.value = false
    emit('saved')
  } catch (error) {
    toast.error(apiErrorMessage(error))
  }
}
</script>

<template>
  <Dialog v-model:open="open" :title="preset ? t('presets.edit') : t('presets.add')">
    <form id="preset-form" class="grid gap-5" @submit.prevent="save">
      <div class="grid gap-1">
        <label for="preset-name">{{ t('presets.name') }}</label>
        <Input id="preset-name" v-model="form.name" required />
      </div>
      <div class="grid gap-1">
        <label for="preset-provider">{{ t('presets.provider') }}</label>
        <Select
          id="preset-provider"
          v-model="form.providerId"
          :options="providers.map((p) => ({ value: p.id, label: p.name }))"
          required
        />
      </div>
      <div class="grid gap-1">
        <label for="preset-model">{{ t('presets.model') }}</label>
        <Input id="preset-model" v-model="form.model" placeholder="deepseek-v4-pro" required />
      </div>
      <div class="flex items-center gap-3">
        <Checkbox id="preset-force" v-model="form.forceToolChoice" />
        <label for="preset-force">{{ t('presets.forceToolChoice') }}</label>
      </div>
      <div class="grid gap-1">
        <label for="preset-extra-body">{{ t('presets.extraBody') }}</label>
        <Textarea
          id="preset-extra-body"
          v-model="form.extraBody"
          rows="3"
          :aria-invalid="!extraBodyValid"
          :aria-describedby="!extraBodyValid ? 'preset-extra-body-error' : undefined"
        />
        <p
          v-if="!extraBodyValid"
          id="preset-extra-body-error"
          role="alert"
          class="mt-1 text-sm text-accent"
        >
          {{ t('presets.extraBodyInvalid') }}
        </p>
      </div>
    </form>
    <template #footer>
      <Button variant="secondary" @click="open = false">{{ t('common.cancel') }}</Button>
      <Button type="submit" form="preset-form" :disabled="!extraBodyValid">{{
        t('common.save')
      }}</Button>
    </template>
  </Dialog>
</template>
