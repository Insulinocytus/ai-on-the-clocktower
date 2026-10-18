<script setup lang="ts">
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { toast } from 'vue-sonner'
import type { Preset, Provider } from '#shared/types/models'

const { t } = useI18n()

const { data: providers, refresh: refreshProviders } = await useFetch<Provider[]>(
  '/api/providers',
  {
    default: () => [],
  },
)
const { data: presets, refresh: refreshPresets } = await useFetch<Preset[]>('/api/presets', {
  default: () => [],
})
const providerName = (id: number) => providers.value.find((p) => p.id === id)?.name ?? '—'

const providerDialog = reactive({ open: false, provider: undefined as Provider | undefined })
const presetDialog = reactive({ open: false, preset: undefined as Preset | undefined })
const trialDialog = reactive({ open: false, preset: undefined as Preset | undefined })

async function remove(path: string, confirmText: string) {
  if (!window.confirm(confirmText)) return
  try {
    await $fetch(path, { method: 'DELETE' })
    toast.success(t('common.deleted'))
  } catch (error) {
    toast.error(apiErrorMessage(error))
  }
  // Deleting a provider cascades to its presets.
  await Promise.all([refreshProviders(), refreshPresets()])
}
</script>

<template>
  <div class="grid gap-10">
    <section class="grid gap-4">
      <div class="flex items-center justify-between">
        <h2 class="text-lg font-semibold">{{ t('providers.title') }}</h2>
        <Button @click="Object.assign(providerDialog, { open: true, provider: undefined })">
          {{ t('providers.add') }}
        </Button>
      </div>
      <p v-if="!providers.length" class="text-sm text-muted-foreground">
        {{ t('providers.empty') }}
      </p>
      <Table v-else>
        <TableHeader>
          <TableRow>
            <TableHead>{{ t('providers.name') }}</TableHead>
            <TableHead>{{ t('providers.baseUrl') }}</TableHead>
            <TableHead>{{ t('providers.apiKeyEnv') }}</TableHead>
            <TableHead>{{ t('providers.timeoutSec') }}</TableHead>
            <TableHead>{{ t('providers.maxConcurrency') }}</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-for="p in providers" :key="p.id">
            <TableCell class="font-medium">{{ p.name }}</TableCell>
            <TableCell class="font-mono text-xs">{{ p.baseUrl }}</TableCell>
            <TableCell>
              <span class="font-mono text-xs">{{ p.apiKeyEnv }}</span>
              <Badge :variant="p.apiKeySet ? 'secondary' : 'destructive'" class="ml-2">
                {{ p.apiKeySet ? t('providers.keySet') : t('providers.keyUnset') }}
              </Badge>
            </TableCell>
            <TableCell>{{ p.timeoutSec }}</TableCell>
            <TableCell>{{ p.maxConcurrency }}</TableCell>
            <TableCell class="text-right">
              <Button
                variant="ghost"
                size="sm"
                @click="Object.assign(providerDialog, { open: true, provider: p })"
              >
                {{ t('common.edit') }}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                @click="
                  remove(`/api/providers/${p.id}`, t('providers.confirmDelete', { name: p.name }))
                "
              >
                {{ t('common.delete') }}
              </Button>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </section>

    <section class="grid gap-4">
      <div class="flex items-center justify-between">
        <h2 class="text-lg font-semibold">{{ t('presets.title') }}</h2>
        <Button
          :disabled="!providers.length"
          @click="Object.assign(presetDialog, { open: true, preset: undefined })"
        >
          {{ t('presets.add') }}
        </Button>
      </div>
      <p v-if="!presets.length" class="text-sm text-muted-foreground">
        {{ providers.length ? t('presets.empty') : t('presets.needProvider') }}
      </p>
      <Table v-else>
        <TableHeader>
          <TableRow>
            <TableHead>{{ t('presets.name') }}</TableHead>
            <TableHead>{{ t('presets.provider') }}</TableHead>
            <TableHead>{{ t('presets.model') }}</TableHead>
            <TableHead>{{ t('presets.forceToolChoice') }}</TableHead>
            <TableHead>{{ t('presets.extraBody') }}</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-for="p in presets" :key="p.id">
            <TableCell class="font-medium">{{ p.name }}</TableCell>
            <TableCell>{{ providerName(p.providerId) }}</TableCell>
            <TableCell class="font-mono text-xs">{{ p.model }}</TableCell>
            <TableCell>{{ p.forceToolChoice ? t('common.yes') : t('common.no') }}</TableCell>
            <TableCell class="max-w-64 truncate font-mono text-xs" :title="p.extraBody">
              {{ p.extraBody }}
            </TableCell>
            <TableCell class="text-right">
              <Button
                variant="outline"
                size="sm"
                @click="Object.assign(trialDialog, { open: true, preset: p })"
              >
                {{ t('presets.trial') }}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                @click="Object.assign(presetDialog, { open: true, preset: p })"
              >
                {{ t('common.edit') }}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                @click="
                  remove(`/api/presets/${p.id}`, t('presets.confirmDelete', { name: p.name }))
                "
              >
                {{ t('common.delete') }}
              </Button>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </section>

    <ProviderDialog
      v-model:open="providerDialog.open"
      :provider="providerDialog.provider"
      @saved="refreshProviders()"
    />
    <PresetDialog
      v-model:open="presetDialog.open"
      :preset="presetDialog.preset"
      :providers="providers"
      @saved="refreshPresets()"
    />
    <TrialDialog v-model:open="trialDialog.open" :preset="trialDialog.preset" />
  </div>
</template>
