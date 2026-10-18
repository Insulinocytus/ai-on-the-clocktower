import { ROLES } from '../../shared/rules/roles'
import type { Lang } from '../../shared/rules/types'
import type { OpenAITool } from './types'

  export function contestantTools(n: number, lang: Lang): OpenAITool[] {
    const T = lang === 'zh' ? {
      reasoning: '你的内心推理。', memo: '可选。填写则用它整份替换你的备忘录；不填则备忘录不变。',
      speak: '说一句话或 pass。私聊、公聊、提名理由、辩护都用这个工具。', speech: '你要说出口的话；null 表示 pass。', slayer: '公开声称以猎手能力开枪的目标座位。只在公聊且 speech 不为空时可以填写，否则为 null。',
      propose: '提议本轮的私聊房间。', members: '你邀请的座位（不含你自己，你会自动加入）；null 表示本轮不私聊。',
      rank: '给包含你的候选私聊房间排序。', ranking: '按意愿从高到低排列的房间编号；没排进去的房间就是不去。',
      nominate: '提名一名玩家，或本轮不提名。', nominee: '被提名的座位；null 表示不提名。',
      vote: '对当前提名投票。', raise: 'true 表示举手（赞成处决），false 表示不举手。',
      night: '夜里被唤醒时选择目标。', targets: '选择的座位，数量按请求要求。',
    } : {
      reasoning: 'Your inner reasoning.', memo: 'Optional. If given, it replaces your whole memo; if left out, your memo stays the same.',
      speak: 'Say one line or pass. Used for whispers, public discussion, nomination reasons and defences.', speech: 'What you say out loud; null to pass.', slayer: 'Target seat for a public Slayer shot. Only allowed in public discussion with a non-null speech; otherwise null.',
      propose: 'Propose this round\'s whisper room.', members: 'Seats you invite (not yourself; you join automatically); null to not whisper this round.',
      rank: 'Rank the candidate whisper rooms that include you.', ranking: 'Room numbers from most to least wanted; rooms left out are rooms you won\'t join.',
      nominate: 'Nominate a player, or nominate nobody this round.', nominee: 'Seat to nominate; null for nobody.',
      vote: 'Vote on the current nomination.', raise: 'true to raise your hand (vote to execute), false not to.',
      night: 'Choose targets when woken at night.', targets: 'Chosen seats, as many as the request says.',
    };
    const seatE = { type: 'integer', enum: Array.from({ length: n }, (_, i) => i + 1) };
    const seatOrNull = { type: ['integer', 'null'], enum: [...Array.from({ length: n }, (_, i) => i + 1), null] };
    const base = { reasoning: { type: 'string', description: T.reasoning } };
    const memo = { memo: { type: 'string', maxLength: 2000, description: T.memo } };
    const tool = (name: string, description: string, props: Record<string, unknown>, required: string[]): OpenAITool => ({ type: 'function', function: { name, description, parameters: { type: 'object', properties: { ...base, ...props, ...memo }, required: ['reasoning', ...required], additionalProperties: false } } });
    return [
      tool('speak', T.speak, { speech: { type: ['string', 'null'], description: T.speech }, slayer_target: { ...seatOrNull, description: T.slayer } }, ['speech', 'slayer_target']),
      tool('propose_whisper', T.propose, { members: { type: ['array', 'null'], items: seatE, description: T.members } }, ['members']),
      tool('rank_whispers', T.rank, { ranking: { type: 'array', items: { type: 'integer' }, description: T.ranking } }, ['ranking']),
      tool('nominate', T.nominate, { nominee: { ...seatOrNull, description: T.nominee } }, ['nominee']),
      tool('vote', T.vote, { raise_hand: { type: 'boolean', description: T.raise } }, ['raise_hand']),
      tool('night_choice', T.night, { targets: { type: 'array', items: seatE, description: T.targets } }, ['targets']),
    ];
  }
  export function storytellerTools(n: number, lang: Lang): OpenAITool[] {
    const T = lang === 'zh'
      ? { d: '作出本次说书人裁量。只填写请求要求的字段。', r: '你的理由。', seats: '座位。', roles: '角色。', number: '数字。', answer: '是 / 否。', alignment: '阵营。' }
      : { d: 'Make this Storyteller decision. Fill only the fields the request asks for.', r: 'Your reasons.', seats: 'Seats.', roles: 'Characters.', number: 'A number.', answer: 'Yes / no.', alignment: 'Team.' };
    return [{ type: 'function', function: { name: 'decide', description: T.d, parameters: { type: 'object', properties: {
      reasoning: { type: 'string', description: T.r },
      seats: { type: 'array', items: { type: 'integer', enum: Array.from({ length: n }, (_, i) => i + 1) }, description: T.seats },
      roles: { type: 'array', items: { type: 'string', enum: ROLES.map(r => r.id) }, description: T.roles },
      number: { type: 'integer', minimum: 0, description: T.number },
      answer: { type: 'boolean', description: T.answer },
      alignment: { type: 'string', enum: ['good', 'evil'], description: T.alignment },
    }, required: ['reasoning'], additionalProperties: false } } }];
  }

