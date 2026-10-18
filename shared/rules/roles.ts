import type { Alignment, RoleId, RoleType } from './types'

export interface RoleMeta {
  id: RoleId
  type: RoleType
  alignment: Alignment
  firstNight: number | null
  otherNight: number | null
  reminders: string[]
  name: { zh: string; en: string }
  ability: { zh: string; en: string }
}

export const ROLES: readonly RoleMeta[] = [
  {
    id: 'washerwoman', type: 'townsfolk', alignment: 'good', firstNight: 2, otherNight: null,
    reminders: ['Townsfolk', 'Wrong'],
    name: { zh: '洗衣妇', en: 'Washerwoman' },
    ability: {
      zh: '在你的首个夜晚，你会得知两名玩家和一个镇民角色：这两名玩家之一是该角色。',
      en: 'You start knowing that 1 of 2 players is a particular Townsfolk.',
    },
  },
  {
    id: 'librarian', type: 'townsfolk', alignment: 'good', firstNight: 3, otherNight: null,
    reminders: ['Outsider', 'Wrong'],
    name: { zh: '图书管理员', en: 'Librarian' },
    ability: {
      zh: '在你的首个夜晚，你会得知两名玩家和一个外来者角色：这两名玩家之一是该角色（或者你会得知没有外来者在场）。',
      en: 'You start knowing that 1 of 2 players is a particular Outsider. (Or that zero are in play.)',
    },
  },
  {
    id: 'investigator', type: 'townsfolk', alignment: 'good', firstNight: 4, otherNight: null,
    reminders: ['Minion', 'Wrong'],
    name: { zh: '调查员', en: 'Investigator' },
    ability: {
      zh: '在你的首个夜晚，你会得知两名玩家和一个爪牙角色：这两名玩家之一是该角色（或者你会得知没有爪牙在场）。',
      en: 'You start knowing that 1 of 2 players is a particular Minion.',
    },
  },
  {
    id: 'chef', type: 'townsfolk', alignment: 'good', firstNight: 5, otherNight: null,
    reminders: [],
    name: { zh: '厨师', en: 'Chef' },
    ability: {
      zh: '在你的首个夜晚，你会得知场上邻座的邪恶玩家有多少对。',
      en: 'You start knowing how many pairs of evil players there are.',
    },
  },
  {
    id: 'empath', type: 'townsfolk', alignment: 'good', firstNight: 6, otherNight: 6,
    reminders: [],
    name: { zh: '共情者', en: 'Empath' },
    ability: {
      zh: '每个夜晚，你会得知与你邻近的两名存活的玩家中邪恶玩家的数量。',
      en: 'Each night, you learn how many of your 2 alive neighbors are evil.',
    },
  },
  {
    id: 'fortuneteller', type: 'townsfolk', alignment: 'good', firstNight: 7, otherNight: 7,
    reminders: ['Red Herring'],
    name: { zh: '占卜师', en: 'Fortune Teller' },
    ability: {
      zh: '每个夜晚，你要选择两名玩家：你会得知他们之中是否有恶魔。会有一名善良玩家始终被你的能力当作恶魔。',
      en: 'Each night, choose 2 players: you learn if either is a Demon. There is a good player that registers as a Demon to you.',
    },
  },
  {
    id: 'undertaker', type: 'townsfolk', alignment: 'good', firstNight: null, otherNight: 8,
    reminders: ['Died Today'],
    name: { zh: '送葬者', en: 'Undertaker' },
    ability: {
      zh: '每个夜晚*，你会得知今天白天死于处决的玩家的角色。',
      en: 'Each night*, you learn which character died by execution today.',
    },
  },
  {
    id: 'monk', type: 'townsfolk', alignment: 'good', firstNight: null, otherNight: 2,
    reminders: ['Safe'],
    name: { zh: '僧侣', en: 'Monk' },
    ability: {
      zh: '每个夜晚*，你要选择除你以外的一名玩家：当晚恶魔的负面能力对他无效。',
      en: 'Each night*, choose a player (not yourself): they are safe from the Demon tonight.',
    },
  },
  {
    id: 'ravenkeeper', type: 'townsfolk', alignment: 'good', firstNight: null, otherNight: 5,
    reminders: [],
    name: { zh: '守鸦人', en: 'Ravenkeeper' },
    ability: {
      zh: '如果你在夜晚死亡，你会被唤醒，然后你要选择一名玩家：你会得知他的角色。',
      en: 'If you die at night, you are woken to choose a player: you learn their character.',
    },
  },
  {
    id: 'virgin', type: 'townsfolk', alignment: 'good', firstNight: null, otherNight: null,
    reminders: ['No Ability'],
    name: { zh: '贞洁者', en: 'Virgin' },
    ability: {
      zh: '当你首次被提名时，如果提名你的玩家是镇民，他立刻被处决。',
      en: 'The 1st time you are nominated, if the nominator is a Townsfolk, they are executed immediately.',
    },
  },
  {
    id: 'slayer', type: 'townsfolk', alignment: 'good', firstNight: null, otherNight: null,
    reminders: ['No Ability'],
    name: { zh: '猎手', en: 'Slayer' },
    ability: {
      zh: '每局游戏限一次，你可以在白天时公开选择一名玩家：如果他是恶魔，他死亡。',
      en: 'Once per game, during the day, publicly choose a player: if they are the Demon, they die.',
    },
  },
  {
    id: 'soldier', type: 'townsfolk', alignment: 'good', firstNight: null, otherNight: null,
    reminders: [],
    name: { zh: '士兵', en: 'Soldier' },
    ability: { zh: '恶魔的负面能力对你无效。', en: 'You are safe from the Demon.' },
  },
  {
    id: 'mayor', type: 'townsfolk', alignment: 'good', firstNight: null, otherNight: null,
    reminders: [],
    name: { zh: '镇长', en: 'Mayor' },
    ability: {
      zh: '如果只有三名玩家存活且白天没有人被处决，你的阵营获胜。如果你在夜晚即将死亡，可能会有一名其他玩家代替你死亡。',
      en: 'If only 3 players live & no execution occurs, your team wins. If you die at night, another player might die instead.',
    },
  },
  {
    id: 'butler', type: 'outsider', alignment: 'good', firstNight: 8, otherNight: 9,
    reminders: ['Master'],
    name: { zh: '管家', en: 'Butler' },
    ability: {
      zh: '每个夜晚，你要选择除你以外的一名玩家：明天白天，只有他投票时你才能投票。',
      en: 'Each night, choose a player (not yourself): tomorrow, you may only vote if they are voting too.',
    },
  },
  {
    id: 'drunk', type: 'outsider', alignment: 'good', firstNight: null, otherNight: null,
    reminders: [],
    name: { zh: '酒鬼', en: 'Drunk' },
    ability: {
      zh: '你不知道你是酒鬼。你以为你是一个镇民角色，但其实你不是。',
      en: 'You do not know you are the Drunk. You think you are a Townsfolk character, but you are not.',
    },
  },
  {
    id: 'recluse', type: 'outsider', alignment: 'good', firstNight: null, otherNight: null,
    reminders: [],
    name: { zh: '陌客', en: 'Recluse' },
    ability: {
      zh: '你可能会被当作邪恶阵营、爪牙角色或恶魔角色，即使你已死亡。',
      en: 'You might register as evil & as a Minion or Demon, even if dead.',
    },
  },
  {
    id: 'saint', type: 'outsider', alignment: 'good', firstNight: null, otherNight: null,
    reminders: [],
    name: { zh: '圣徒', en: 'Saint' },
    ability: { zh: '如果你死于处决，你的阵营落败。', en: 'If you die by execution, your team loses.' },
  },
  {
    id: 'poisoner', type: 'minion', alignment: 'evil', firstNight: 1, otherNight: 1,
    reminders: ['Poisoned'],
    name: { zh: '投毒者', en: 'Poisoner' },
    ability: {
      zh: '每个夜晚，你要选择一名玩家：他在当晚和明天白天中毒。',
      en: 'Each night, choose a player: they are poisoned tonight and tomorrow day.',
    },
  },
  {
    id: 'spy', type: 'minion', alignment: 'evil', firstNight: 9, otherNight: 10,
    reminders: [],
    name: { zh: '间谍', en: 'Spy' },
    ability: {
      zh: '每个夜晚，你能查看魔典。你可能会被当作善良阵营、镇民角色或外来者角色，即使你已死亡。',
      en: 'Each night, you see the Grimoire. You might register as good & as a Townsfolk or Outsider, even if dead.',
    },
  },
  {
    id: 'scarletwoman', type: 'minion', alignment: 'evil', firstNight: null, otherNight: 3,
    reminders: ['Is The Demon'],
    name: { zh: '红唇女郎', en: 'Scarlet Woman' },
    ability: {
      zh: '如果大于等于五名玩家存活时（旅行者不计算在内）恶魔死亡，你变成那个恶魔。',
      en: "If there are 5 or more players alive & the Demon dies, you become the Demon. (Travellers don't count.)",
    },
  },
  {
    id: 'baron', type: 'minion', alignment: 'evil', firstNight: null, otherNight: null,
    reminders: [],
    name: { zh: '男爵', en: 'Baron' },
    ability: {
      zh: '会有额外的外来者在场。[+2 外来者]',
      en: 'There are extra Outsiders in play. [+2 Outsiders]',
    },
  },
  {
    id: 'imp', type: 'demon', alignment: 'evil', firstNight: null, otherNight: 4,
    reminders: ['Dead'],
    name: { zh: '小恶魔', en: 'Imp' },
    ability: {
      zh: '每个夜晚*，你要选择一名玩家：他死亡。如果你以这种方式自杀，一名爪牙会变成小恶魔。',
      en: 'Each night*, choose a player: they die. If you kill yourself this way, a Minion becomes the Imp.',
    },
  },
]

export const ROLE_BY_ID: Readonly<Record<RoleId, RoleMeta>> = Object.fromEntries(ROLES.map((r) => [r.id, r])) as Record<RoleId, RoleMeta>

export const SETUP_COUNTS: Readonly<Record<number, readonly [number, number, number, number]>> = {
  5: [3, 0, 1, 1], 6: [3, 1, 1, 1], 7: [5, 0, 1, 1], 8: [5, 1, 1, 1], 9: [5, 2, 1, 1],
  10: [7, 0, 2, 1], 11: [7, 1, 2, 1], 12: [7, 2, 2, 1], 13: [9, 0, 3, 1], 14: [9, 1, 3, 1], 15: [9, 2, 3, 1],
}
