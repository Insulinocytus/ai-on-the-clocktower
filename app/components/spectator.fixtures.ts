import { channelBlocks, type ChannelBlock } from '#shared/game/channels'
import { ROLES } from '#shared/game/roles'
import { DISCRETION_IDS, fold, foldPublic, project, sample } from '#shared/game/rules'
import { seatFootprint, spectatorRows } from '#shared/game/spectator'
import { ENGINE_VERSION } from '#shared/game/version'
import type { GameConfig, GameEvent, Observer, RoleId, SeatState } from '#shared/types/game'
import type { GameSummary } from '#shared/types/game-view'
import type { Preset } from '#shared/types/models'

type DiscretionRequest = Extract<GameEvent, { type: 'discretion.requested' }>

const models = ['deepseek-chat', 'claude-haiku', 'gpt-mini', 'qwen-plus', 'glm-air']
const seats: Preset[] = models.map((model, index) => ({
  id: index + 1,
  name: model,
  providerId: 1,
  model,
  forceToolChoice: true,
  extraBody: '{}',
}))
const storyteller: Preset = {
  id: 6,
  name: 'claude-sonnet',
  providerId: 1,
  model: 'claude-sonnet',
  forceToolChoice: true,
  extraBody: '{}',
}
export const presets = [...seats, storyteller]

export const config: GameConfig = {
  seatCount: 5,
  seats,
  storyteller,
  discretions: Object.fromEntries(
    DISCRETION_IDS.map((id) => [id, id === 'D8' ? 'manual' : 'random']),
  ) as GameConfig['discretions'],
  speechLimit: 3,
  whisperLimit: 0,
  language: 'zh',
  seed: 7,
  engineVersion: ENGINE_VERSION,
}

export function gameSummary(
  id: string,
  status: GameSummary['status'],
  reason?: GameSummary['reason'],
): GameSummary {
  return { id, createdAt: '2026-10-26T12:00:00Z', status, reason, compatible: true, config }
}

function seatsFor(roles: RoleId[]): SeatState[] {
  return roles.map((role, index) => ({
    seat: index + 1,
    role,
    alignment: ROLES[role].alignment,
    alive: true,
    poisoned: false,
    protected: false,
    abilityUsed: false,
    voteUsed: false,
    master: null,
  }))
}

function toolCallDecision(name: string, args: object) {
  return {
    usage: {},
    durationMs: 1840,
    attempt: 1,
    validation: { ok: true },
    raw: {
      choices: [
        { message: { tool_calls: [{ function: { name, arguments: JSON.stringify(args) } }] } },
      ],
    },
  }
}

export const events: GameEvent[] = [
  { seq: 1, type: 'game.created', ...config },
  {
    seq: 2,
    type: 'grimoire.set',
    seats: seatsFor(['soldier', 'chef', 'empath', 'poisoner', 'imp']),
  },
  { seq: 3, type: 'phase.started', day: 1, phase: 'first-night' },
  { seq: 4, type: 'told', seat: 4, kind: 'minion-info', content: { seats: [5] } },
  {
    seq: 5,
    type: 'told',
    seat: 5,
    kind: 'demon-info',
    content: { seats: [4], bluffs: ['saint', 'virgin', 'slayer'] },
  },
  { seq: 6, type: 'told', seat: 3, kind: 'role', content: { role: 'empath' } },
  { seq: 7, type: 'night.choice', seat: 4, role: 'poisoner', targets: [2] },
  { seq: 8, type: 'status.changed', seat: 2, status: 'poisoned', value: true },
  {
    seq: 9,
    type: 'discretion.requested',
    discretion: 'D8',
    source: 'manual',
    candidates: [0, 1, 2],
    context: { seat: 2, role: 'chef', truth: [1], reason: 'poisoned' },
  },
  { seq: 10, type: 'discretion.resolved', discretion: 'D8', choice: 0, source: 'manual' },
  {
    seq: 11,
    type: 'ability.resolved',
    seat: 2,
    role: 'chef',
    result: 1,
    deviated: true,
    reason: 'poisoned',
  },
  { seq: 12, type: 'told', seat: 2, kind: 'ability', content: { role: 'chef', result: 0 } },
  { seq: 13, type: 'phase.started', day: 1, phase: 'dawn' },
  { seq: 14, type: 'dawn.announced', day: 1, deaths: [] },
  { seq: 15, type: 'phase.started', day: 1, phase: 'public' },
  {
    seq: 16,
    type: 'contestant.decision',
    seat: 1,
    request: { tool: 'speak', seat: 1, day: 1, kind: 'free', remaining: 3 },
    model: 'deepseek-chat',
    ...toolCallDecision('speak', {
      reasoning_summary: '我是士兵，先公开身份，让好人知道谁不会被恶魔杀死。',
      speech: '我是士兵，今晚恶魔杀不了我。',
      slayer_target: null,
    }),
  },
  {
    seq: 17,
    type: 'public.speech',
    seat: 1,
    speech: '我是士兵，今晚恶魔杀不了我。',
    kind: 'free',
    decision: 16,
  },
  {
    seq: 18,
    type: 'contestant.decision',
    seat: 3,
    request: { tool: 'speak', seat: 3, day: 1, kind: 'free', remaining: 3 },
    model: 'gpt-mini',
    ...toolCallDecision('speak', {
      reasoning_summary: '先观察，不急着暴露共情者身份。',
      speech: '我暂时没有信息可分享。',
      slayer_target: null,
    }),
  },
  { seq: 19, type: 'phase.started', day: 2, phase: 'night' },
  { seq: 20, type: 'night.choice', seat: 5, role: 'imp', targets: [3] },
  {
    seq: 21,
    type: 'storyteller.decision',
    discretion: 'D13',
    request: {},
    model: 'claude-sonnet',
    ...toolCallDecision('discretion', {
      reasoning_summary: '共情者未被保护，击杀成立。',
      choice: 0,
    }),
  },
  { seq: 22, type: 'night.death', seat: 3, cause: 'imp' },
  { seq: 23, type: 'phase.started', day: 2, phase: 'dawn' },
  { seq: 24, type: 'dawn.announced', day: 2, deaths: [3] },
  { seq: 25, type: 'phase.started', day: 2, phase: 'nomination' },
  {
    seq: 26,
    type: 'contestant.decision',
    seat: 2,
    request: { tool: 'nominate', seat: 2, day: 2, nominees: [1, 4, 5] },
    model: 'claude-haiku',
    ...toolCallDecision('nominate', {
      reasoning_summary: '5 号的发言前后矛盾，提名他。',
      nominee: 5,
    }),
  },
  {
    seq: 27,
    type: 'contestant.decision',
    seat: 4,
    request: { tool: 'nominate', seat: 4, day: 2, nominees: [1, 2, 5] },
    model: 'qwen-plus',
    ...toolCallDecision('nominate', {
      reasoning_summary: '提名队友太明显，选择放弃。',
      nominee: null,
    }),
  },
  { seq: 28, type: 'nomination', nominator: 2, nominee: 5 },
  { seq: 29, type: 'vote', seat: 1, raiseHand: true, voteUsed: false },
  { seq: 30, type: 'vote', seat: 3, raiseHand: true, voteUsed: true },
  {
    seq: 31,
    type: 'vote.tallied',
    nominee: 5,
    votes: 2,
    threshold: 2,
    aboutToBeExecuted: true,
  },
  { seq: 32, type: 'execution', seat: 5 },
  { seq: 33, type: 'game.ended', winner: 'good', reason: 'all_demons_dead' },
]

const manual = events.find(
  (event): event is DiscretionRequest =>
    event.type === 'discretion.requested' && event.source === 'manual',
)
if (!manual) throw new Error('Fixture log has no manual discretion request')
export const manualRequest = manual

export const setupSample = sample(() => 0.25, config.seatCount)

export function firstNight(seatCount: number, crowded = false) {
  const gameConfig: GameConfig = {
    ...config,
    seatCount,
    seats: Array.from({ length: Math.ceil(seatCount / seats.length) }, () => seats)
      .flat()
      .slice(0, seatCount),
  }
  const gameEvents: GameEvent[] = [
    { seq: 1, type: 'game.created', ...gameConfig },
    { seq: 2, type: 'grimoire.set', seats: seatsFor(sample(() => 0.25, seatCount)) },
    { seq: 3, type: 'phase.started', day: 1, phase: 'first-night' },
  ]
  const grimoire = fold(gameEvents)
  return {
    config: gameConfig,
    events: gameEvents,
    grimoire: crowded
      ? {
          ...grimoire,
          seats: grimoire.seats.map((seat) => ({
            ...seat,
            poisoned: true,
            protected: true,
            abilityUsed: true,
            master: (seat.seat % seatCount) + 1,
            registeredRole: 'chef' as const,
          })),
        }
      : grimoire,
    publicState: foldPublic(gameEvents, seatCount),
    title: 'spectator.blocks.first-night',
  }
}

export const setupRequest: DiscretionRequest = {
  seq: 2,
  type: 'discretion.requested',
  discretion: 'D1',
  source: 'manual',
  candidates: { type: 'setup', sample: setupSample },
}

interface PerspectiveOptions {
  observer?: Observer
  through?: number
  kind?: ChannelBlock['kind']
  losing?: boolean
  focusedSeat?: number
}

export function perspective({
  observer = 'spectator',
  through = Infinity,
  kind,
  losing = false,
  focusedSeat,
}: PerspectiveOptions = {}) {
  const visible = project(events, observer).filter((event) => event.seq <= through)
  // Titles are i18n keys; stories translate them with t() in render setup so they follow the locale.
  const blocks = channelBlocks(visible).map((block) => ({
    ...block,
    title: `spectator.blocks.${block.kind}`,
  }))
  const latest = blocks.reduce((last, block) => (block.end > last.end ? block : last))
  const selected = blocks.find((block) => block.kind === kind) ?? latest
  const prefix = visible.filter((event) => event.seq <= selected.end)
  const rows = new Map(spectatorRows(prefix, losing).map((row) => [row.event.seq, row]))
  const shown =
    focusedSeat === undefined
      ? [selected]
      : seatFootprint(blocks.slice(0, blocks.indexOf(selected) + 1), focusedSeat, selected.end)
  return {
    observer,
    blocks,
    selected,
    events: prefix,
    grimoire: fold(prefix),
    publicState: foldPublic(prefix, config.seatCount),
    groups: shown.map((block) => ({
      key: block.key,
      title: block.title,
      rows: block.events.flatMap((event) => {
        const row = rows.get(event.seq)
        return row ? [row] : []
      }),
    })),
  }
}

export function eventProps(seq: number, observer: Observer = 'spectator', losing = false) {
  const row = spectatorRows(project(events, observer), losing).find(
    (entry) => entry.event.seq === seq,
  )
  if (!row) throw new Error(`No row at seq ${String(seq)} for ${observer}`)
  return { row, observer }
}
