<script setup lang="ts">
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
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
  <Dialog v-model:open="open">
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{{ preset ? t('presets.edit') : t('presets.add') }}</DialogTitle>
      </DialogHeader>
      <form id="preset-form" class="grid gap-4" @submit.prevent="save">
        <div class="grid gap-2">
          <Label for="preset-name">{{ t('presets.name') }}</Label>
          <Input id="preset-name" v-model="form.name" required />
        </div>
        <div class="grid gap-2">
          <Label for="preset-provider">{{ t('presets.provider') }}</Label>
          <Select v-model="form.providerId" required>
            <SelectTrigger id="preset-provider" class="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem v-for="p in providers" :key="p.id" :value="p.id">{{ p.name }}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div class="grid gap-2">
          <Label for="preset-model">{{ t('presets.model') }}</Label>
          <Input id="preset-model" v-model="form.model" placeholder="deepseek-v4-pro" required />
        </div>
        <div class="flex items-center gap-2">
          <Checkbox id="preset-force" v-model="form.forceToolChoice" />
          <Label for="preset-force">{{ t('presets.forceToolChoice') }}</Label>
        </div>
        <div class="grid gap-2">
          <Label for="preset-extra-body">{{ t('presets.extraBody') }}</Label>
          <Textarea
            id="preset-extra-body"
            v-model="form.extraBody"
            class="font-mono text-xs"
            rows="6"
            :aria-invalid="!extraBodyValid"
          />
          <p v-if="!extraBodyValid" class="text-sm text-destructive">
            {{ t('presets.extraBodyInvalid') }}
          </p>
        </div>
      </form>
      <DialogFooter>
        <DialogClose as-child>
          <Button variant="outline">{{ t('common.cancel') }}</Button>
        </DialogClose>
        <Button type="submit" form="preset-form" :disabled="!extraBodyValid">
          {{ t('common.save') }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
