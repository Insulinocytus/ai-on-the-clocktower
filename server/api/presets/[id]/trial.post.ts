import { z } from 'zod'
import type { TrialResult } from '#shared/types/models'
import { chatCompletion, LlmCallError } from '../../../utils/llm'
import { getPreset, getProvider, idParam } from '../../../utils/models'
import { checkToolCall, contestantTools, type Lang } from '../../../utils/tools'

const TRIAL_SEATS = 5

const PROMPT: Record<Lang, { system: string; user: string }> = {
  zh: {
    system:
      '你是《血染钟楼》（暗流涌动剧本）中的一名玩家。这是开局前的连通性测试：只需按要求调用工具。',
    user: '请调用 speak：reasoning 填一句话说明你在做什么，speech 填一句打招呼的话，slayer_target 填 null。',
  },
  en: {
    system:
      'You are a player in a game of Blood on the Clocktower, using the Trouble Brewing script. This is a connectivity check before the game: just call the tool as asked.',
    user: 'Call speak: put one sentence on what you are doing in reasoning, a one-line greeting in speech, and null in slayer_target.',
  },
}

const trialBody = z.object({ lang: z.enum(['zh', 'en']) })

// One real request with the six game tools and a minimal prompt; nothing is stored.
export default defineEventHandler(async (event): Promise<TrialResult> => {
  const { id } = await getValidatedRouterParams(event, (params) => idParam.parse(params))
  const { lang } = await readValidatedBody(event, (body) => trialBody.parse(body))
  const preset = getPreset(id)
  const provider = getProvider(preset.providerId)
  if (!provider) throw createError({ statusCode: 404, statusMessage: 'Provider not found' })

  const tools = contestantTools(lang, TRIAL_SEATS)
  let raw: unknown
  try {
    raw = await chatCompletion(
      {
        ...provider,
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
    )
  } catch (error) {
    if (!(error instanceof LlmCallError)) throw error
    return { valid: false, error: error.message, raw: error.body ?? null }
  }
  const check = checkToolCall(raw, tools)
  return check.ok
    ? { valid: true, toolCall: { name: check.name, arguments: check.arguments }, raw }
    : { valid: false, error: check.error, raw }
})
