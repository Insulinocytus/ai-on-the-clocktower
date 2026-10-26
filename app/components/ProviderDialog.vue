<script setup lang="ts">
import Button from '@/components/grimoire/Button.vue'
import Input from '@/components/grimoire/Input.vue'
import Dialog from '@/components/grimoire/Dialog.vue'
import Select from '@/components/grimoire/Select.vue'
import { toast } from 'vue-sonner'
import { createProvider, updateProvider, type Provider } from '@/api'
import { API_FORMATS, type ApiFormat } from '#shared/types/models'

const props = defineProps<{ provider?: Provider }>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ saved: [] }>()
const { t } = useI18n()

const BASE_URL_PLACEHOLDERS: Record<ApiFormat, string> = {
  openai_completions: 'https://api.openai.com/v1',
  openai_responses: 'https://api.openai.com/v1',
  anthropic_messages: 'https://api.anthropic.com',
}

const form = reactive<Omit<Provider, 'id'>>({
  name: '',
  baseUrl: '',
  apiFormat: 'openai_completions',
  apiKey: '',
  timeoutSec: 300,
  maxConcurrency: 5,
})

watch(open, (isOpen) => {
  if (!isOpen) return
  const { name, baseUrl, apiFormat, apiKey, timeoutSec, maxConcurrency } = props.provider ?? {
    name: '',
    baseUrl: '',
    apiFormat: 'openai_completions',
    apiKey: '',
    timeoutSec: 300,
    maxConcurrency: 5,
  }
  Object.assign(form, { name, baseUrl, apiFormat, apiKey, timeoutSec, maxConcurrency })
})

async function save() {
  try {
    if (props.provider) await updateProvider(props.provider.id, form)
    else await createProvider(form)
    toast.success(t('common.saved'))
    open.value = false
    emit('saved')
  } catch (error) {
    toast.error(apiErrorMessage(error))
  }
}
</script>

<template>
  <Dialog v-model:open="open" :title="provider ? t('providers.edit') : t('providers.add')">
    <form id="provider-form" class="grid gap-5" @submit.prevent="save">
      <div class="grid gap-1">
        <label for="provider-name">{{ t('providers.name') }}</label>
        <Input id="provider-name" v-model="form.name" required />
      </div>
      <div class="grid gap-1">
        <label for="provider-base-url">{{ t('providers.baseUrl') }}</label>
        <Input
          id="provider-base-url"
          v-model="form.baseUrl"
          type="url"
          :placeholder="BASE_URL_PLACEHOLDERS[form.apiFormat]"
          required
        />
      </div>
      <div class="grid gap-1">
        <label for="provider-api-format">{{ t('providers.apiFormat') }}</label>
        <Select
          id="provider-api-format"
          v-model="form.apiFormat"
          :options="API_FORMATS.map((value) => ({ value, label: t(`providers.formats.${value}`) }))"
          required
        />
      </div>
      <div class="grid gap-1">
        <label for="provider-key">{{ t('providers.apiKey') }}</label>
        <Input
          id="provider-key"
          v-model="form.apiKey"
          type="password"
          autocomplete="new-password"
          required
        />
      </div>
      <div class="grid grid-cols-2 gap-3">
        <div class="grid gap-1">
          <label for="provider-timeout">{{ t('providers.timeoutSec') }}</label>
          <Input
            id="provider-timeout"
            v-model.number="form.timeoutSec"
            type="number"
            min="1"
            required
          />
        </div>
        <div class="grid gap-1">
          <label for="provider-concurrency">{{ t('providers.maxConcurrency') }}</label>
          <Input
            id="provider-concurrency"
            v-model.number="form.maxConcurrency"
            type="number"
            min="1"
            required
          />
        </div>
      </div>
    </form>
    <template #footer>
      <Button variant="secondary" @click="open = false">{{ t('common.cancel') }}</Button>
      <Button type="submit" form="provider-form">{{ t('common.save') }}</Button>
    </template>
  </Dialog>
</template>
