<script setup lang="ts">
import type { Preset, PresetInput, PresetTestResult, Provider, ProviderInput } from '#shared/api'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Checkbox } from '~/components/ui/checkbox'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'

const { t, locale } = useI18n()
const providers = ref<Provider[]>([])
const presets = ref<Preset[]>([])
const providerLoading = ref(true)
const presetLoading = ref(true)
const providerLoadError = ref('')
const presetLoadError = ref('')
const providerActionError = ref('')
const presetActionError = ref('')
const providerBusy = ref(false)
const presetBusy = ref(false)
const testingId = ref<string | null>(null)
const busy = computed(() => providerBusy.value || presetBusy.value || testingId.value !== null)
const providerEditId = ref<string | null>(null)
const presetEditId = ref<string | null>(null)
const testResults = ref<Record<string, PresetTestResult>>({})
const providerForm = reactive({ name: '', baseUrl: '', apiKeyEnv: '', timeoutSec: 300, maxConcurrency: 5 })
const presetForm = reactive({ name: '', providerId: '', model: '', forceToolChoice: true, extraBody: '{}' })

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function errorMessage(error: unknown): string {
  if (isObject(error) && isObject(error.data)) {
    if (typeof error.data.message === 'string') return error.data.message
    if (typeof error.data.error === 'string') return error.data.error
  }
  return t('models.requestFailed')
}

const extraBody = computed(() => {
  try {
    const value: unknown = JSON.parse(presetForm.extraBody)
    return isObject(value)
      ? { value, error: null }
      : { value: null, error: 'models.objectRequired' }
  } catch {
    return { value: null, error: 'models.invalidJson' }
  }
})
const selectedProviderMissing = computed(() => presetForm.providerId !== '' && !providers.value.some(provider => provider.id === presetForm.providerId))

async function loadProviders() {
  providerLoading.value = true
  providerLoadError.value = ''
  try {
    providers.value = await $fetch<Provider[]>('/api/providers')
    if (!presetForm.providerId && !presetEditId.value) presetForm.providerId = providers.value[0]?.id ?? ''
  } catch (error: unknown) {
    providerLoadError.value = errorMessage(error)
  } finally {
    providerLoading.value = false
  }
}

async function loadPresets() {
  presetLoading.value = true
  presetLoadError.value = ''
  try {
    presets.value = await $fetch<Preset[]>('/api/presets')
  } catch (error: unknown) {
    presetLoadError.value = errorMessage(error)
  } finally {
    presetLoading.value = false
  }
}

function editProvider(provider?: Provider) {
  providerEditId.value = provider?.id ?? null
  Object.assign(providerForm, provider
    ? { name: provider.name, baseUrl: provider.baseUrl, apiKeyEnv: provider.apiKeyEnv, timeoutSec: provider.timeoutSec, maxConcurrency: provider.maxConcurrency }
    : { name: '', baseUrl: '', apiKeyEnv: '', timeoutSec: 300, maxConcurrency: 5 })
  providerActionError.value = ''
}

function editPreset(preset?: Preset) {
  presetEditId.value = preset?.id ?? null
  Object.assign(presetForm, preset
    ? { name: preset.name, providerId: preset.providerId, model: preset.model, forceToolChoice: preset.forceToolChoice, extraBody: JSON.stringify(preset.extraBody, null, 2) }
    : { name: '', providerId: providers.value[0]?.id ?? '', model: '', forceToolChoice: true, extraBody: '{}' })
  presetActionError.value = ''
}

async function saveProvider() {
  if (busy.value) return
  providerBusy.value = true
  providerActionError.value = ''
  const body: ProviderInput = {
    name: providerForm.name.trim(),
    baseUrl: providerForm.baseUrl.trim(),
    apiKeyEnv: providerForm.apiKeyEnv.trim(),
    timeoutSec: Number(providerForm.timeoutSec),
    maxConcurrency: Number(providerForm.maxConcurrency),
  }
  try {
    if (providerEditId.value) {
      await $fetch(`/api/providers/${encodeURIComponent(providerEditId.value)}`, { method: 'PUT', body })
    } else {
      await $fetch('/api/providers', { method: 'POST', body })
    }
    editProvider()
    await loadProviders()
  } catch (error: unknown) {
    providerActionError.value = errorMessage(error)
  } finally {
    providerBusy.value = false
  }
}

async function deleteProvider(provider: Provider) {
  if (busy.value || !window.confirm(t('models.confirmDeleteProvider', { name: provider.name }))) return
  providerBusy.value = true
  providerActionError.value = ''
  try {
    await $fetch(`/api/providers/${encodeURIComponent(provider.id)}`, { method: 'DELETE' })
    if (providerEditId.value === provider.id) editProvider()
    await Promise.all([loadProviders(), loadPresets()])
    if (!presetEditId.value && !providers.value.some(item => item.id === presetForm.providerId)) {
      presetForm.providerId = providers.value[0]?.id ?? ''
    }
  } catch (error: unknown) {
    providerActionError.value = errorMessage(error)
  } finally {
    providerBusy.value = false
  }
}

async function savePreset() {
  if (busy.value || !extraBody.value.value || selectedProviderMissing.value) return
  presetBusy.value = true
  presetActionError.value = ''
  const body: PresetInput = {
    name: presetForm.name.trim(),
    providerId: presetForm.providerId,
    model: presetForm.model.trim(),
    forceToolChoice: presetForm.forceToolChoice,
    extraBody: extraBody.value.value,
  }
  try {
    if (presetEditId.value) {
      await $fetch(`/api/presets/${encodeURIComponent(presetEditId.value)}`, { method: 'PUT', body })
      delete testResults.value[presetEditId.value]
    } else {
      await $fetch('/api/presets', { method: 'POST', body })
    }
    editPreset()
    await loadPresets()
  } catch (error: unknown) {
    presetActionError.value = errorMessage(error)
  } finally {
    presetBusy.value = false
  }
}

async function deletePreset(preset: Preset) {
  if (busy.value || !window.confirm(t('models.confirmDeletePreset', { name: preset.name }))) return
  presetBusy.value = true
  presetActionError.value = ''
  try {
    await $fetch(`/api/presets/${encodeURIComponent(preset.id)}`, { method: 'DELETE' })
    delete testResults.value[preset.id]
    if (presetEditId.value === preset.id) editPreset()
    await loadPresets()
  } catch (error: unknown) {
    presetActionError.value = errorMessage(error)
  } finally {
    presetBusy.value = false
  }
}

async function testPreset(preset: Preset) {
  if (busy.value) return
  testingId.value = preset.id
  presetActionError.value = ''
  delete testResults.value[preset.id]
  try {
    testResults.value[preset.id] = await $fetch<PresetTestResult>(`/api/presets/${encodeURIComponent(preset.id)}/test`, {
      method: 'POST',
      body: { language: locale.value },
    })
  } catch (error: unknown) {
    presetActionError.value = errorMessage(error)
  } finally {
    testingId.value = null
  }
}

function providerName(id: string): string {
  return providers.value.find(provider => provider.id === id)?.name ?? t('models.missingProvider')
}

function formatJson(value: unknown): string {
  return JSON.stringify(value, null, 2) ?? t('models.noResponse')
}

onMounted(() => Promise.all([loadProviders(), loadPresets()]))
</script>

<template>
  <main class="page models-page">
    <header class="page-heading">
      <div>
        <h1>{{ t('models.title') }}</h1>
        <p class="muted">{{ t('models.description') }}</p>
      </div>
    </header>

    <section aria-labelledby="providers-heading" class="management-section">
      <div class="section-heading">
        <div>
          <h2 id="providers-heading">{{ t('models.providers') }}</h2>
          <p class="muted">{{ t('models.providerDescription') }}</p>
        </div>
        <Badge variant="secondary">{{ providers.length }}</Badge>
      </div>
      <div class="management-grid">
        <div class="panel record-list" :aria-busy="providerLoading">
          <div v-if="providerLoadError" role="alert" class="load-error">
            <p class="error">{{ providerLoadError }}</p>
            <Button variant="outline" size="sm" :disabled="providerLoading || busy" @click="loadProviders">{{ t('models.retry') }}</Button>
          </div>
          <p v-if="providerLoading" role="status" class="muted empty-state">{{ t('models.loadingProviders') }}</p>
          <p v-else-if="!providers.length && !providerLoadError" class="muted empty-state">{{ t('models.noProviders') }}</p>
          <ul v-if="providers.length" class="records">
            <li v-for="provider in providers" :key="provider.id" class="record" :class="{ 'is-editing': providerEditId === provider.id }">
              <div class="record-heading">
                <h3>{{ provider.name }}</h3>
                <Badge :variant="provider.keySet ? 'secondary' : 'outline'" :class="{ 'key-missing': !provider.keySet }">{{ t(provider.keySet ? 'models.keySet' : 'models.keyMissing') }}</Badge>
              </div>
              <p class="endpoint">{{ provider.baseUrl }}</p>
              <dl class="record-meta">
                <div><dt>{{ t('models.apiKeyEnv') }}</dt><dd><code>{{ provider.apiKeyEnv }}</code></dd></div>
                <div><dt>{{ t('models.timeout') }}</dt><dd>{{ t('models.seconds', { count: provider.timeoutSec }) }}</dd></div>
                <div><dt>{{ t('models.maxConcurrency') }}</dt><dd>{{ provider.maxConcurrency }}</dd></div>
              </dl>
              <div class="actions">
                <Button variant="outline" size="sm" :disabled="busy || providerLoading" :aria-label="t('models.editNamed', { name: provider.name })" @click="editProvider(provider)">{{ t('models.edit') }}</Button>
                <Button variant="ghost" size="sm" class="delete-button" :disabled="busy || providerLoading" :aria-label="t('models.deleteNamed', { name: provider.name })" @click="deleteProvider(provider)">{{ t('models.delete') }}</Button>
              </div>
            </li>
          </ul>
        </div>

        <form class="panel editor" @submit.prevent="saveProvider">
          <h3>{{ t(providerEditId ? 'models.editProvider' : 'models.addProvider') }}</h3>
          <fieldset :disabled="busy || providerLoading" class="editor-fields">
            <div class="field">
              <Label for="provider-name">{{ t('models.name') }}</Label>
              <Input id="provider-name" v-model="providerForm.name" required :placeholder="t('models.providerNamePlaceholder')" />
            </div>
            <div class="field">
              <Label for="provider-url">{{ t('models.baseUrl') }}</Label>
              <Input id="provider-url" v-model="providerForm.baseUrl" type="url" pattern="https?://.*" required :placeholder="t('models.baseUrlPlaceholder')" />
            </div>
            <div class="field">
              <Label for="provider-env">{{ t('models.apiKeyEnv') }}</Label>
              <Input id="provider-env" v-model="providerForm.apiKeyEnv" required pattern="[A-Za-z_][A-Za-z0-9_]*" autocomplete="off" autocapitalize="off" spellcheck="false" :placeholder="t('models.envPlaceholder')" aria-describedby="provider-env-hint" />
              <p id="provider-env-hint" class="muted field-hint">{{ t('models.envHint') }}</p>
            </div>
            <div class="form-grid">
              <div class="field">
                <Label for="provider-timeout">{{ t('models.timeoutSeconds') }}</Label>
                <Input id="provider-timeout" v-model.number="providerForm.timeoutSec" type="number" required min="1" step="1" />
              </div>
              <div class="field">
                <Label for="provider-concurrency">{{ t('models.maxConcurrency') }}</Label>
                <Input id="provider-concurrency" v-model.number="providerForm.maxConcurrency" type="number" required min="1" step="1" />
              </div>
            </div>
            <div class="actions editor-actions">
              <Button type="submit">{{ t(providerBusy ? 'models.saving' : providerEditId ? 'models.saveChanges' : 'models.createProvider') }}</Button>
              <Button v-if="providerEditId" type="button" variant="outline" @click="editProvider()">{{ t('models.cancel') }}</Button>
            </div>
          </fieldset>
          <p v-if="providerActionError" role="alert" class="error">{{ providerActionError }}</p>
        </form>
      </div>
    </section>

    <section aria-labelledby="presets-heading" class="management-section">
      <div class="section-heading">
        <div>
          <h2 id="presets-heading">{{ t('models.presets') }}</h2>
          <p class="muted">{{ t('models.presetDescription') }}</p>
        </div>
        <Badge variant="secondary">{{ presets.length }}</Badge>
      </div>
      <div class="management-grid">
        <div class="panel record-list" :aria-busy="presetLoading">
          <div v-if="presetLoadError" role="alert" class="load-error">
            <p class="error">{{ presetLoadError }}</p>
            <Button variant="outline" size="sm" :disabled="presetLoading || busy" @click="loadPresets">{{ t('models.retry') }}</Button>
          </div>
          <p v-if="presetLoading" role="status" class="muted empty-state">{{ t('models.loadingPresets') }}</p>
          <p v-else-if="!presets.length && !presetLoadError" class="muted empty-state">{{ t('models.noPresets') }}</p>
          <ul v-if="presets.length" class="records">
            <li v-for="preset in presets" :key="preset.id" class="record" :class="{ 'is-editing': presetEditId === preset.id }">
              <div class="record-heading">
                <h3>{{ preset.name }}</h3>
                <Badge variant="outline">{{ providerName(preset.providerId) }}</Badge>
              </div>
              <p class="endpoint">{{ preset.model }}</p>
              <p class="muted field-hint">{{ t(preset.forceToolChoice ? 'models.forceEnabled' : 'models.forceDisabled') }}</p>
              <details class="saved-parameters">
                <summary>{{ t('models.extraBody') }}</summary>
                <pre>{{ formatJson(preset.extraBody) }}</pre>
              </details>
              <div class="actions">
                <Button variant="outline" size="sm" :disabled="busy || presetLoading" :aria-label="t('models.editNamed', { name: preset.name })" @click="editPreset(preset)">{{ t('models.edit') }}</Button>
                <Button variant="outline" size="sm" :disabled="busy || presetLoading" :aria-label="t('models.testNamed', { name: preset.name })" @click="testPreset(preset)">{{ t(testingId === preset.id ? 'models.testing' : 'models.test') }}</Button>
                <Button variant="ghost" size="sm" class="delete-button" :disabled="busy || presetLoading" :aria-label="t('models.deleteNamed', { name: preset.name })" @click="deletePreset(preset)">{{ t('models.delete') }}</Button>
              </div>
              <p v-if="testingId === preset.id" role="status" class="muted test-pending">{{ t('models.testPending') }}</p>
              <div v-if="testResults[preset.id]" class="test-result" aria-live="polite">
                <div class="record-heading">
                  <Badge :variant="testResults[preset.id]!.ok ? 'secondary' : 'destructive'">{{ t(testResults[preset.id]!.ok ? 'models.testPassed' : 'models.testFailed') }}</Badge>
                  <span class="muted">{{ t('models.duration', { ms: testResults[preset.id]!.durationMs }) }}</span>
                </div>
                <h4>{{ t('models.toolCall') }}</h4>
                <pre v-if="testResults[preset.id]!.toolCall">{{ formatJson(testResults[preset.id]!.toolCall) }}</pre>
                <p v-else class="muted">{{ t('models.noToolCall') }}</p>
                <h4>{{ t('models.testError') }}</h4>
                <p :class="testResults[preset.id]!.error ? 'error' : 'muted'">{{ testResults[preset.id]!.error || t('models.noTestError') }}</p>
                <details>
                  <summary>{{ t('models.rawResponse') }}</summary>
                  <pre>{{ formatJson(testResults[preset.id]!.raw) }}</pre>
                </details>
              </div>
            </li>
          </ul>
        </div>

        <form class="panel editor" @submit.prevent="savePreset">
          <h3>{{ t(presetEditId ? 'models.editPreset' : 'models.addPreset') }}</h3>
          <p v-if="!providers.length && !providerLoading" class="muted">{{ t('models.providerRequired') }}</p>
          <fieldset :disabled="busy || presetLoading || providerLoading || !providers.length" class="editor-fields">
            <div class="field">
              <Label for="preset-name">{{ t('models.name') }}</Label>
              <Input id="preset-name" v-model="presetForm.name" required :placeholder="t('models.presetNamePlaceholder')" />
            </div>
            <div class="form-grid">
              <div class="field">
                <Label for="preset-provider">{{ t('models.provider') }}</Label>
                <select id="preset-provider" v-model="presetForm.providerId" required class="native-select" :aria-invalid="selectedProviderMissing">
                  <option value="" disabled>{{ t('models.chooseProvider') }}</option>
                  <option v-if="selectedProviderMissing" :value="presetForm.providerId" disabled>{{ t('models.missingProvider') }}</option>
                  <option v-for="provider in providers" :key="provider.id" :value="provider.id">{{ provider.name }}</option>
                </select>
              </div>
              <div class="field">
                <Label for="preset-model">{{ t('models.model') }}</Label>
                <Input id="preset-model" v-model="presetForm.model" required :placeholder="t('models.modelPlaceholder')" />
              </div>
            </div>
            <div class="checkbox-field">
              <Checkbox id="preset-force-tool" :model-value="presetForm.forceToolChoice" @update:model-value="presetForm.forceToolChoice = $event === true" />
              <div>
                <Label for="preset-force-tool">{{ t('models.forceToolChoice') }}</Label>
                <p class="muted field-hint">{{ t('models.forceToolHint') }}</p>
              </div>
            </div>
            <div class="field">
              <Label for="preset-extra-body">{{ t('models.extraBody') }}</Label>
              <textarea id="preset-extra-body" v-model="presetForm.extraBody" class="json-editor" rows="8" spellcheck="false" :aria-invalid="Boolean(extraBody.error)" aria-describedby="extra-body-hint extra-body-error" />
              <p id="extra-body-hint" class="muted field-hint">{{ t('models.extraBodyHint') }}</p>
              <p v-if="extraBody.error" id="extra-body-error" role="alert" class="error">{{ t(extraBody.error) }}</p>
            </div>
            <div class="actions editor-actions">
              <Button type="submit" :disabled="Boolean(extraBody.error) || selectedProviderMissing">{{ t(presetBusy ? 'models.saving' : presetEditId ? 'models.saveChanges' : 'models.createPreset') }}</Button>
              <Button v-if="presetEditId" type="button" variant="outline" @click="editPreset()">{{ t('models.cancel') }}</Button>
            </div>
          </fieldset>
          <p v-if="presetActionError" role="alert" class="error">{{ presetActionError }}</p>
        </form>
      </div>
    </section>
  </main>
</template>

<style scoped>
.models-page { max-width: 1320px; }
.management-section + .management-section { margin-top: 2.5rem; }
.section-heading, .record-heading { display: flex; align-items: center; justify-content: space-between; gap: 1rem; }
.section-heading { margin-bottom: 1rem; }
h2 { font-size: 1.25rem; font-weight: 650; }
h3 { font-size: 1rem; font-weight: 600; overflow-wrap: anywhere; }
h4 { margin: .85rem 0 .35rem; font-size: .8rem; font-weight: 600; }
.management-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 1.25rem; align-items: start; }
.record-list { padding: 0; overflow: hidden; }
.records { list-style: none; margin: 0; padding: 0; }
.record { padding: 1.25rem; border-bottom: 1px solid #e2e8f0; }
.record:last-child { border-bottom: 0; }
.record.is-editing { background: #eef2ff; box-shadow: inset 3px 0 #6366f1; }
.endpoint { margin: .4rem 0 .75rem; color: #475569; font-size: .875rem; overflow-wrap: anywhere; }
.record-meta { display: flex; flex-wrap: wrap; gap: .75rem 1.5rem; margin: 0 0 1rem; font-size: .8rem; }
.record-meta dt { color: #64748b; margin-bottom: .2rem; }
.record-meta dd { margin: 0; overflow-wrap: anywhere; }
.editor { padding: 1.5rem; }
.editor h3 { margin-bottom: 1.25rem; }
.editor-fields { display: grid; gap: 1.1rem; border: 0; padding: 0; margin: 0; min-width: 0; }
.editor-fields:disabled { opacity: .65; }
.field-hint { font-size: .8rem; line-height: 1.5; margin: .3rem 0 0; }
.editor-actions { margin-top: .25rem; }
.checkbox-field { display: flex; align-items: flex-start; gap: .65rem; }
.checkbox-field > :first-child { margin-top: .1rem; flex-shrink: 0; }
.native-select, .json-editor { width: 100%; border: 1px solid #cbd5e1; border-radius: .375rem; background: white; color: #0f172a; padding: .5rem .75rem; font-size: .875rem; }
.native-select { min-height: 2.25rem; }
.json-editor { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; line-height: 1.5; resize: vertical; }
.native-select:focus-visible, .json-editor:focus-visible { outline: 2px solid #6366f1; outline-offset: 2px; }
.json-editor[aria-invalid='true'] { border-color: #dc2626; }
.delete-button, .key-missing { color: #b91c1c; }
.empty-state, .load-error { padding: 1.5rem; }
.load-error .error { margin: 0 0 .75rem; }
.saved-parameters { margin: .75rem 0 1rem; }
summary { cursor: pointer; color: #475569; font-size: .8rem; }
pre { white-space: pre-wrap; overflow-wrap: anywhere; max-height: 24rem; overflow: auto; margin: .5rem 0 0; padding: .75rem; border-radius: .375rem; background: #f1f5f9; font-size: .75rem; line-height: 1.6; }
.test-result { margin-top: 1rem; padding-top: 1rem; border-top: 1px solid #cbd5e1; font-size: .8rem; }
.test-result details { margin-top: 1rem; }
.test-pending { margin-top: 1rem; font-size: .8rem; }
.error { overflow-wrap: anywhere; }
</style>
