<script setup lang="ts">
import Button from '@/components/grimoire/Button.vue'
import { toast } from 'vue-sonner'
import { deletePreset, deleteProvider, listPresets, listProviders, type Provider } from '@/api'
import type { Preset } from '#shared/types/models'

const { t } = useI18n()

const { data: providers, refresh: refreshProviders } = await useAsyncData(
  'providers',
  listProviders,
  { default: () => [] },
)
const { data: presets, refresh: refreshPresets } = await useAsyncData('presets', listPresets, {
  default: () => [],
})
const providerName = (id: number) => providers.value.find((p) => p.id === id)?.name ?? '—'

const providerDialog = reactive({ open: false, provider: undefined as Provider | undefined })
const presetDialog = reactive({ open: false, preset: undefined as Preset | undefined })
const trialDialog = reactive({ open: false, preset: undefined as Preset | undefined })

async function remove(deleteItem: () => Promise<void>, confirmText: string) {
  if (!window.confirm(confirmText)) return
  try {
    await deleteItem()
    toast.success(t('common.deleted'))
  } catch (error) {
    toast.error(apiErrorMessage(error))
  }
  // Deleting a provider cascades to its presets.
  await Promise.all([refreshProviders(), refreshPresets()])
}
</script>

<template>
  <div class="models-page">
    <header class="models-heading">
      <h1>{{ t('nav.models') }}</h1>
      <p>{{ t('models.subtitle') }}</p>
    </header>

    <section class="models-section">
      <div class="models-section-heading">
        <h2>{{ t('providers.title') }}</h2>
        <Button
          variant="secondary"
          @click="Object.assign(providerDialog, { open: true, provider: undefined })"
        >
          {{ t('providers.add') }}
        </Button>
      </div>
      <p v-if="!providers.length" class="text-sm text-muted">
        {{ t('providers.empty') }}
      </p>
      <table v-else class="models-table providers-table">
        <caption class="sr-only">
          {{
            t('providers.title')
          }}
        </caption>
        <colgroup>
          <col class="w-[200px]" />
          <col class="w-[280px]" />
          <col class="w-[200px]" />
          <col class="w-[160px]" />
          <col class="w-[120px]" />
          <col />
        </colgroup>
        <thead>
          <tr>
            <th scope="col">{{ t('providers.name') }}</th>
            <th scope="col">{{ t('providers.baseUrl') }}</th>
            <th scope="col">{{ t('providers.apiFormat') }}</th>
            <th scope="col">{{ t('providers.timeoutSec') }}</th>
            <th scope="col">{{ t('providers.maxConcurrency') }}</th>
            <th scope="col">
              <span class="sr-only">{{ t('common.edit') }} / {{ t('common.delete') }}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in providers" :key="p.id">
            <th scope="row" class="record-name">{{ p.name }}</th>
            <td class="truncate" :title="p.baseUrl">{{ p.baseUrl }}</td>
            <td>{{ t(`providers.formats.${p.apiFormat}`) }}</td>
            <td class="record-number">{{ p.timeoutSec }}</td>
            <td class="record-number">{{ p.maxConcurrency }}</td>
            <td>
              <div class="record-actions">
                <button
                  type="button"
                  @click="Object.assign(providerDialog, { open: true, provider: p })"
                >
                  {{ t('common.edit') }}
                </button>
                <button
                  type="button"
                  class="text-muted"
                  @click="
                    remove(
                      () => deleteProvider(p.id),
                      t('providers.confirmDelete', { name: p.name }),
                    )
                  "
                >
                  {{ t('common.delete') }}
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </section>

    <section class="models-section">
      <div class="models-section-heading">
        <h2>{{ t('presets.title') }}</h2>
        <Button
          variant="secondary"
          :disabled="!providers.length"
          @click="Object.assign(presetDialog, { open: true, preset: undefined })"
        >
          {{ t('presets.add') }}
        </Button>
      </div>
      <p v-if="!presets.length" class="text-sm text-muted">
        {{ providers.length ? t('presets.empty') : t('presets.needProvider') }}
      </p>
      <table v-else class="models-table presets-table">
        <caption class="sr-only">
          {{
            t('presets.title')
          }}
        </caption>
        <colgroup>
          <col class="w-[200px]" />
          <col class="w-[180px]" />
          <col class="w-[220px]" />
          <col class="w-[160px]" />
          <col class="w-[200px]" />
          <col />
        </colgroup>
        <thead>
          <tr>
            <th scope="col">{{ t('presets.name') }}</th>
            <th scope="col">{{ t('presets.provider') }}</th>
            <th scope="col">{{ t('presets.model') }}</th>
            <th scope="col">{{ t('presets.forceToolChoice') }}</th>
            <th scope="col">{{ t('presets.extraBody') }}</th>
            <th scope="col">
              <span class="sr-only"
                >{{ t('presets.trial') }} / {{ t('common.edit') }} / {{ t('common.delete') }}</span
              >
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in presets" :key="p.id">
            <th scope="row" class="record-name">{{ p.name }}</th>
            <td>{{ providerName(p.providerId) }}</td>
            <td class="truncate" :title="p.model">{{ p.model }}</td>
            <td>{{ p.forceToolChoice ? t('common.yes') : t('common.no') }}</td>
            <td class="truncate" :title="p.extraBody">{{ p.extraBody }}</td>
            <td>
              <div class="record-actions">
                <button
                  type="button"
                  @click="Object.assign(trialDialog, { open: true, preset: p })"
                >
                  {{ t('presets.trial') }}
                </button>
                <button
                  type="button"
                  @click="Object.assign(presetDialog, { open: true, preset: p })"
                >
                  {{ t('common.edit') }}
                </button>
                <button
                  type="button"
                  class="text-muted"
                  @click="
                    remove(() => deletePreset(p.id), t('presets.confirmDelete', { name: p.name }))
                  "
                >
                  {{ t('common.delete') }}
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
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

<style scoped>
.models-page {
  width: var(--layout-content-width);
  margin-inline: calc((100% - var(--layout-content-width)) / 2);
  padding-top: var(--space-8);
  padding-bottom: var(--space-10);
}

.models-heading {
  margin-bottom: 48px;
}

.models-heading h1 {
  font-size: var(--font-size-page);
  font-weight: var(--font-weight-semibold);
  line-height: var(--line-height-heading);
}

.models-heading p {
  margin-top: var(--space-2);
  color: var(--ink2);
  font-size: var(--font-size-speech);
  line-height: var(--line-height-body);
}

.models-section + .models-section {
  margin-top: 60px;
}

.models-section-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--space-3);
}

.models-section-heading h2 {
  font-size: var(--font-size-title);
  font-weight: var(--font-weight-semibold);
  line-height: var(--line-height-heading);
}

.models-table {
  width: 100%;
  table-layout: fixed;
  border-collapse: collapse;
  text-align: left;
  font-size: var(--font-size-ui);
}

.models-table tr {
  border-bottom: 1px solid var(--rule);
}

.models-table thead th {
  height: 30px;
  color: var(--muted);
  font-size: var(--font-size-small);
  font-weight: var(--font-weight-regular);
  vertical-align: top;
}

.models-table tbody th,
.models-table tbody td {
  height: 60px;
  padding-right: var(--space-4);
  color: var(--ink2);
  font-weight: var(--font-weight-regular);
}

.models-table .record-name {
  color: var(--ink);
  font-family: var(--font-family-serif);
  font-size: var(--font-size-wordmark);
}

.record-number {
  font-family: var(--font-family-serif);
}

.models-table tbody td:last-child {
  padding-right: 0;
}

.record-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-6);
  white-space: nowrap;
}

.record-actions button {
  padding-block: var(--space-2);
  font-size: var(--font-size-ui);
  cursor: pointer;
}

.record-actions button:hover {
  text-decoration: underline;
  text-underline-offset: 4px;
}
</style>
