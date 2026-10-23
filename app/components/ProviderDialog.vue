<script setup lang="ts">
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { toast } from 'vue-sonner'
import { createProvider, updateProvider, type Provider } from '@/api'

const props = defineProps<{ provider?: Provider }>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ saved: [] }>()
const { t } = useI18n()

const form = reactive({ name: '', baseUrl: '', apiKey: '', timeoutSec: 300, maxConcurrency: 5 })

watch(open, (isOpen) => {
  if (!isOpen) return
  const { name, baseUrl, apiKey, timeoutSec, maxConcurrency } = props.provider ?? {
    name: '',
    baseUrl: '',
    apiKey: '',
    timeoutSec: 300,
    maxConcurrency: 5,
  }
  Object.assign(form, { name, baseUrl, apiKey, timeoutSec, maxConcurrency })
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
  <Dialog v-model:open="open">
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{{ provider ? t('providers.edit') : t('providers.add') }}</DialogTitle>
      </DialogHeader>
      <form id="provider-form" class="grid gap-4" @submit.prevent="save">
        <div class="grid gap-2">
          <Label for="provider-name">{{ t('providers.name') }}</Label>
          <Input id="provider-name" v-model="form.name" required />
        </div>
        <div class="grid gap-2">
          <Label for="provider-base-url">{{ t('providers.baseUrl') }}</Label>
          <Input
            id="provider-base-url"
            v-model="form.baseUrl"
            type="url"
            placeholder="https://openrouter.ai/api/v1"
            required
          />
        </div>
        <div class="grid gap-2">
          <Label for="provider-key">{{ t('providers.apiKey') }}</Label>
          <Input
            id="provider-key"
            v-model="form.apiKey"
            type="password"
            autocomplete="new-password"
            required
          />
        </div>
        <div class="grid grid-cols-2 gap-4">
          <div class="grid gap-2">
            <Label for="provider-timeout">{{ t('providers.timeoutSec') }}</Label>
            <Input
              id="provider-timeout"
              v-model.number="form.timeoutSec"
              type="number"
              min="1"
              required
            />
          </div>
          <div class="grid gap-2">
            <Label for="provider-concurrency">{{ t('providers.maxConcurrency') }}</Label>
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
      <DialogFooter>
        <DialogClose as-child>
          <Button variant="outline">{{ t('common.cancel') }}</Button>
        </DialogClose>
        <Button type="submit" form="provider-form">{{ t('common.save') }}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
