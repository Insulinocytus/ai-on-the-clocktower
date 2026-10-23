import { z } from 'zod'
import { checkToolCall, contestantTools, type Lang } from '../../shared/game/tools'
import type { Preset, TrialResult } from '../../shared/types/models'
import type { Provider } from './index'
import { chatCompletion, LlmCallError } from './llm'
import { inTransaction, requestResult } from './storage'

const PROMPT: Record<Lang, { system: string; user: string }> = {
  zh: {
    system:
      '你是《血染钟楼》（暗流涌动剧本）中的一名玩家。这是开局前的连通性测试：只需按要求调用工具。',
    user: '请调用 speak：reasoning_summary 填一句话说明你在做什么，speech 填一句打招呼的话，slayer_target 填 null。',
  },
  en: {
    system:
      'You are a player in a game of Blood on the Clocktower, using the Trouble Brewing script. This is a connectivity check before the game: just call the tool as asked.',
    user: 'Call speak: put one sentence on what you are doing in reasoning_summary, a one-line greeting in speech, and null in slayer_target.',
  },
}

const trialInput = z.object({ lang: z.enum(['zh', 'en']) })

export async function trialPreset(
  id: number,
  input: unknown,
  signal?: AbortSignal,
): Promise<TrialResult> {
  z.object({ id: z.int() }).parse({ id })
  const { lang } = trialInput.parse(input)
  const { preset, provider } = await inTransaction(
    ['presets', 'providers'],
    'readonly',
    async (transaction) => {
      const preset = await requestResult(
        transaction.objectStore('presets').get(id) as IDBRequest<Preset | undefined>,
      )
      if (!preset) throw new Error('Not found')
      const provider = await requestResult(
        transaction.objectStore('providers').get(preset.providerId) as IDBRequest<
          Provider | undefined
        >,
      )
      if (!provider) throw new Error('Provider not found')
      return { preset, provider }
    },
  )
  const tools = contestantTools(lang, 5)
  let raw: unknown
  try {
    raw = await chatCompletion(
      {
        ...provider,
        providerId: provider.id,
        model: preset.model,
        forceToolChoice: preset.forceToolChoice,
        extraBody: JSON.parse(preset.extraBody) as Record<string, unknown>,
      },
      {
        messages: [
          { role: 'system', content: PROMPT[lang].system },
          { role: 'user', content: PROMPT[lang].user },
        ],
        tools,
        tool: 'speak',
      },
      signal,
    )
  } catch (error) {
    if (!(error instanceof LlmCallError)) throw error
    return { valid: false, error: error.message, raw: error.body ?? null }
  }
  const check = checkToolCall(raw, tools, 'speak')
  return check.ok
    ? { valid: true, toolCall: { name: check.name, arguments: check.arguments }, raw }
    : { valid: false, error: check.error, raw }
}
