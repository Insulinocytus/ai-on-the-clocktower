import { applyGrimoire, applyPublic, initialGrimoire, initialPublic } from '../fold'
import { isFunctioning, registeredAlignment, registeredRole } from '../register'
import { ROLE_BY_ID, ROLES } from '../roles'
import { winner } from '../winner'
import type { AbilityInfo, ContestantAnswer, ContestantAsk, DeathCause, DiscretionContext, DiscretionId, DiscretionValue, EventBody, GameConfig, Ports, RoleId, Seat, SpeakContext, ToolName, ToolArgsByName } from '../types'
import { fakeInfo, firstInfo, roleIds, rolesOfType, sameInfo, triples } from './candidates'

export async function runGame(config: GameConfig, ports: Ports): Promise<void> {
  let g = initialGrimoire(config.seatCount)
  let p = initialPublic(config.seatCount)
  let ended = false
  let nightDeaths: Seat[] = []
  let executedToday: Seat | undefined
  const daySuccessors = new Set<Seat>()
  const seats = Array.from({ length: config.seatCount }, (_, i) => i + 1)

  function commit(event: EventBody): void {
    if (ended) return
    ports.commit(event)
    g = applyGrimoire(g, event)
    p = applyPublic(p, event)
    if (event.type === 'game.ended') ended = true
  }

  function checkWin(options?: { dayEndedWithoutExecution?: boolean; executed?: Seat }): void {
    if (ended) return
    const result = winner(g, options)
    if (result) commit({ type: 'game.ended', ...result })
  }

  async function decide(discretion: DiscretionId, values: DiscretionValue[], context: DiscretionContext): Promise<DiscretionValue> {
    if (!values.length) throw new Error(`No candidates for ${discretion}`)
    if (values.length === 1) return values[0]!
    return ports.discretion({ discretion, candidates: { kind: 'list', values }, context })
  }

  function args<K extends ToolName>(answer: ContestantAnswer, tool: K): ToolArgsByName[K] {
    if (answer.call.tool !== tool) throw new Error(`Expected ${tool}, got ${answer.call.tool}`)
    return answer.call.args as ToolArgsByName[K]
  }

  async function ask(asks: ContestantAsk[]): Promise<ContestantAnswer[]> {
    if (!asks.length || ended) return []
    try {
      return await ports.askContestants(asks)
    } catch (error) {
      if (ended) return []
      throw error
    }
  }

  async function choose(seat: Seat, as: RoleId): Promise<Seat[]> {
    const count = as === 'fortuneteller' ? 2 : 1
    const allowSelf = as !== 'monk' && as !== 'butler'
    const [answer] = await ask([{ seat, request: { kind: 'night_choice', as, count, allowSelf } }])
    if (!answer) return []
    const targets = args(answer, 'night_choice').targets
    commit({ type: 'night.choice', seat, as, targets, decisionSeq: answer.decisionSeq })
    return targets
  }

  async function clearPoison(source?: Seat): Promise<void> {
    for (const seat of g.seats) {
      if (seat.poisonedBy !== null && (source === undefined || seat.poisonedBy === source)) {
        commit({ type: 'status.changed', seat: seat.seat, status: 'poisoned', on: false, source: seat.poisonedBy })
      }
    }
  }

  async function becomeImp(seat: Seat): Promise<void> {
    const from = g.seats[seat - 1]!.role
    commit({ type: 'role.changed', seat, from, to: 'imp', alignment: 'evil' })
    if (from === 'poisoner') await clearPoison(seat)
    if (g.phase === 'night' || g.phase === 'first_night') commit({ type: 'told', seat, kind: 'became_imp' })
    else daySuccessors.add(seat)
  }

  async function kill(seat: Seat, cause: DeathCause, event: EventBody, starpass = false): Promise<void> {
    const before = g.seats[seat - 1]!
    const aliveBefore = g.seats.filter(player => player.alive).length
    commit(event)
    if (!before.alive) {
      checkWin()
      return
    }
    const atNight = g.phase === 'night' || g.phase === 'first_night'
    if (atNight) nightDeaths.push(seat)
    if (before.role === 'imp') {
      const scarlet = g.seats.find(player => player.alive && player.role === 'scarletwoman' && isFunctioning(g, player.seat))
      if (aliveBefore >= 5 && scarlet) await becomeImp(scarlet.seat)
      else if (starpass) {
        const minions = g.seats.filter(player => player.alive && ROLE_BY_ID[player.role].type === 'minion')
        if (minions.length) {
          const value = await decide('D14', minions.map(player => ({ seats: [player.seat] })), { subject: seat, fields: ['seats'] })
          await becomeImp(value.seats![0]!)
        }
      }
    }
    if (before.role === 'poisoner') await clearPoison(seat)
    if (atNight && (before.role === 'ravenkeeper' || before.role === 'drunk' && g.drunkBelieves === 'ravenkeeper')) await act(seat, 'ravenkeeper')
    checkWin(cause === 'execution' || cause === 'virgin' ? { executed: seat } : undefined)
  }

  function probe(seat: Seat, as: RoleId, targets: Seat[], registered: boolean): AbilityInfo {
    const role = (target: Seat) => registered ? registeredRole(g, target) : g.seats[target - 1]!.role
    const alignment = (target: Seat) => registered ? registeredAlignment(g, target) : g.seats[target - 1]!.alignment
    if (as === 'chef') return { number: seats.filter((target, i) => alignment(target) === 'evil' && alignment(seats[(i + 1) % seats.length]!) === 'evil').length }
    if (as === 'empath') {
      const nearest = [-1, 1].map(direction => {
        for (let distance = 1; distance < seats.length; distance++) {
          const target = ((seat - 1 + direction * distance) % seats.length + seats.length) % seats.length + 1
          if (g.seats[target - 1]!.alive) return target
        }
        return seat
      })
      return { number: nearest.filter(target => alignment(target) === 'evil').length }
    }
    if (as === 'fortuneteller') return { answer: targets.some(target => ROLE_BY_ID[role(target)].type === 'demon' || target === g.redHerring) }
    const target = as === 'undertaker' ? executedToday! : targets[0]!
    return { ...(as === 'ravenkeeper' ? { seats: [target] } : {}), roles: [role(target)] }
  }

  async function inform(seat: Seat, as: RoleId, targets: Seat[] = []): Promise<void> {
    const truth = g.seats[seat - 1]!
    const effective = isFunctioning(g, seat)
    let result: AbilityInfo
    let registered: AbilityInfo
    let value: AbilityInfo
    if (as === 'washerwoman' || as === 'librarian' || as === 'investigator') {
      const candidates = firstInfo(g, seat, as, true)
      registered = candidates[0]!
      if (effective) {
        value = await decide(as === 'washerwoman' ? 'D4' : as === 'librarian' ? 'D5' : 'D6', candidates, { subject: seat, ability: as, fields: ['seats', 'roles'] })
        registered = value
      } else {
        value = await decide('D8', fakeInfo(g, seat, as, targets), { subject: seat, ability: as, truth: registered, fields: ['seats', 'roles'] })
      }
      const physical = firstInfo(g, seat, as, false)
      result = physical.find(candidate => sameInfo(candidate, registered)) ?? physical.find(candidate => JSON.stringify(candidate.seats) === JSON.stringify(registered.seats)) ?? physical[0]!
    } else {
      registered = probe(seat, as, targets, true)
      result = probe(seat, as, targets, false)
      value = effective ? registered : await decide('D8', fakeInfo(g, seat, as, targets), { subject: seat, ability: as, truth: registered, fields: Object.keys(registered) as (keyof DiscretionValue)[] })
    }
    const deviates = !sameInfo(result, value)
    const reason = truth.role === 'drunk' ? 'drunk' : truth.poisonedBy !== null ? 'poisoned' : 'register'
    commit({ type: 'ability.resolved', seat, role: truth.role, as, effective, ...(targets.length ? { targets } : {}), result, told: { value, deviates, ...(deviates ? { reason } : {}) } })
    commit({ type: 'told', seat, kind: 'ability', ability: as, value })
  }

  async function demonAttack(target: Seat, self: Seat): Promise<void> {
    const victim = g.seats[target - 1]!
    if (!victim.alive || victim.protectedBy !== null || victim.role === 'soldier' && isFunctioning(g, target)) return
    if (victim.role === 'mayor' && isFunctioning(g, target)) {
      const bounce = await decide('D12', [{ answer: false }, { answer: true }], { subject: target, fields: ['answer'] })
      if (bounce.answer) {
        const value = await decide('D13', seats.map(seat => ({ seats: [seat] })), { subject: target, fields: ['seats'] })
        const substitute = value.seats![0]!
        const player = g.seats[substitute - 1]!
        if (!player.alive || player.protectedBy !== null || player.role === 'soldier' && isFunctioning(g, substitute)) return
        await kill(substitute, 'demon', { type: 'night.death', seat: substitute, cause: 'demon' })
        return
      }
    }
    await kill(target, 'demon', { type: 'night.death', seat: target, cause: 'demon' }, target === self)
  }

  async function act(seat: Seat, as: RoleId): Promise<void> {
    if (ended) return
    const truth = g.seats[seat - 1]!
    if (as === 'spy') {
      commit({ type: 'ability.resolved', seat, role: truth.role, as, effective: isFunctioning(g, seat) })
      commit({ type: 'told', seat, kind: 'spy_grimoire', grimoire: g })
      return
    }
    if (as === 'undertaker' && executedToday === undefined) return
    const choosing = ['poisoner', 'monk', 'imp', 'fortuneteller', 'butler', 'ravenkeeper'].includes(as)
    const targets = choosing ? await choose(seat, as) : []
    if (ended) return
    if (['washerwoman', 'librarian', 'investigator', 'chef', 'empath', 'fortuneteller', 'undertaker', 'ravenkeeper'].includes(as)) {
      await inform(seat, as, targets)
      return
    }
    const effective = isFunctioning(g, seat)
    commit({ type: 'ability.resolved', seat, role: truth.role, as, effective, targets })
    if (!effective) return
    const target = targets[0]!
    if (as === 'poisoner') commit({ type: 'status.changed', seat: target, status: 'poisoned', on: true, source: seat })
    if (as === 'monk') commit({ type: 'status.changed', seat: target, status: 'protected', on: true, source: seat })
    if (as === 'butler') {
      for (const player of g.seats) if (player.masterOf === seat) commit({ type: 'status.changed', seat: player.seat, status: 'master', on: false, source: seat })
      commit({ type: 'status.changed', seat: target, status: 'master', on: true, source: seat })
    }
    if (as === 'imp') await demonAttack(target, seat)
  }

  async function setup(): Promise<void> {
    const selection = await ports.discretion({ discretion: 'D1', candidates: { kind: 'setup', seatCount: config.seatCount }, context: { fields: ['roles'] } })
    let roles = selection.roles!
    if (config.sources.seating !== config.sources.D1) {
      roles = (await ports.discretion({ discretion: 'seating', candidates: { kind: 'seating', roles }, context: { fields: ['roles'] } })).roles!
    }
    commit({ type: 'grimoire.set', seats: roles.map((role, i) => ({ seat: i + 1, role, alignment: ROLE_BY_ID[role].alignment })) })
    if (roles.includes('drunk')) {
      const value = await decide('D2', rolesOfType('townsfolk').filter(role => !roles.includes(role)).map(role => ({ roles: [role] })), { subject: roles.indexOf('drunk') + 1, fields: ['roles'] })
      commit({ type: 'grimoire.set', drunkBelieves: value.roles![0]! })
    }
    if (roles.includes('fortuneteller')) {
      const value = await decide('D3', g.seats.filter(seat => seat.alignment === 'good').map(seat => ({ seats: [seat.seat] })), { subject: roles.indexOf('fortuneteller') + 1, fields: ['seats'] })
      commit({ type: 'grimoire.set', redHerring: value.seats![0]! })
    }
    if (config.seatCount >= 7) {
      const available = ROLES.filter(role => role.alignment === 'good' && !roles.includes(role.id) && role.id !== g.drunkBelieves).map(role => role.id)
      const value = await decide('D7', triples(available), { fields: ['roles'] })
      commit({ type: 'grimoire.set', bluffs: value.roles! })
    }
    for (const as of ['spy', 'recluse'] as const) {
      if (!roles.includes(as)) continue
      const registeredRoles = as === 'spy' ? [as, ...roleIds.filter(role => ROLE_BY_ID[role].alignment === 'good')] : [as, ...rolesOfType('minion'), 'imp' as const]
      const value = await decide(as === 'spy' ? 'D10' : 'D11', (['good', 'evil'] as const).flatMap(alignment => registeredRoles.map(role => ({ alignment, roles: [role] }))), { subject: roles.indexOf(as) + 1, fields: ['alignment', 'roles'] })
      commit({ type: 'grimoire.set', [as === 'spy' ? 'spyRegisters' : 'recluseRegisters']: { alignment: value.alignment!, role: value.roles![0]! } })
    }
    for (const player of g.seats) commit({ type: 'told', seat: player.seat, kind: 'role', role: player.role === 'drunk' ? g.drunkBelieves! : player.role })
  }

  async function night(first: boolean, day: number): Promise<void> {
    nightDeaths = []
    commit({ type: 'phase.started', day, phase: first ? 'first_night' : 'night' })
    await clearPoison()
    if (first && config.seatCount >= 7) {
      const demon = g.seats.find(player => player.role === 'imp')!.seat
      const minions = g.seats.filter(player => ROLE_BY_ID[player.role].type === 'minion').map(player => player.seat)
      for (const seat of minions) commit({ type: 'told', seat, kind: 'minion_info', demon, minions })
      commit({ type: 'told', seat: demon, kind: 'demon_info', minions, bluffs: g.bluffs })
    }
    const order = first ? 'firstNight' : 'otherNight'
    const roles = ROLES.filter(role => role[order] !== null).sort((a, b) => a[order]! - b[order]!)
    for (const role of roles) {
      if (ended) return
      if (role.id === 'scarletwoman') {
        for (const seat of daySuccessors) commit({ type: 'told', seat, kind: 'became_imp' })
        daySuccessors.clear()
        continue
      }
      if (role.id === 'ravenkeeper') continue
      const actors = g.seats.filter(player => player.alive && (player.role === role.id || player.role === 'drunk' && g.drunkBelieves === role.id)).map(player => player.seat)
      for (const seat of actors) {
        if (g.seats[seat - 1]!.alive) await act(seat, role.id)
        if (ended) return
      }
    }
  }

  async function slayer(seat: Seat, target: Seat): Promise<void> {
    const player = g.seats[seat - 1]!
    const victim = g.seats[target - 1]!
    const real = player.role === 'slayer' && player.alive && !player.abilityUsed
    const died = real && isFunctioning(g, seat) && victim.alive && registeredRole(g, target) === 'imp'
    if (player.role === 'slayer' && !player.abilityUsed) commit({ type: 'status.changed', seat, status: 'ability_used', on: true })
    const event = { type: 'slayer.resolved', seat, target, died } as const
    if (died) await kill(target, 'slayer', event)
    else commit(event)
  }

  async function speech(answer: ContestantAnswer, context: SpeakContext): Promise<void> {
    const value = args(answer, 'speak')
    if (value.speech === null || ended) return
    if (context.where === 'whisper') {
      commit({ type: 'whisper.speech', round: context.round, room: context.room, members: context.members, seat: answer.seat, text: value.speech, decisionSeq: answer.decisionSeq })
    } else {
      commit({ type: 'public.speech', seat: answer.seat, text: value.speech, kind: context.where === 'public' ? 'free' : context.where, ...(value.slayer_target !== null ? { slayerTarget: value.slayer_target } : {}), decisionSeq: answer.decisionSeq })
      if (context.where === 'public' && value.slayer_target !== null) await slayer(answer.seat, value.slayer_target)
    }
  }

  async function conversation(members: Seat[], context: SpeakContext): Promise<void> {
    const remaining = new Map(members.map(seat => [seat, config.maxSpeeches]))
    let last: Seat | undefined
    while (!ended) {
      const eligible = members.filter(seat => seat !== last && remaining.get(seat)! > 0)
      if (!eligible.length) return
      const answers = await ask(eligible.map(seat => ({ seat, request: { kind: 'speak', context, remaining: remaining.get(seat)! } })))
      const speaking = answers.filter(answer => args(answer, 'speak').speech !== null)
      if (!speaking.length || ended) return
      const most = Math.max(...speaking.map(answer => remaining.get(answer.seat)!))
      const chosen = ports.rng.pick(speaking.filter(answer => remaining.get(answer.seat) === most))
      remaining.set(chosen.seat, remaining.get(chosen.seat)! - 1)
      last = chosen.seat
      await speech(chosen, context)
    }
  }

  async function whispers(): Promise<void> {
    if (!config.whisperRooms) return
    commit({ type: 'phase.started', day: g.day, phase: 'whisper' })
    const remaining = new Map(seats.map(seat => [seat, config.whisperRooms]))
    for (let round = 1; !ended; round++) {
      const eligible = seats.filter(seat => remaining.get(seat)! > 0)
      if (eligible.length < 2) return
      const proposals = await ask(eligible.map(seat => ({ seat, request: { kind: 'propose_whisper', round, remaining: remaining.get(seat)!, eligible: eligible.filter(other => other !== seat) } })))
      const merged = new Map<string, { members: Seat[]; proposers: Seat[] }>()
      for (const answer of proposals) {
        const value = args(answer, 'propose_whisper')
        if (value.members === null) continue
        const members = [answer.seat, ...value.members].sort((a, b) => a - b)
        const key = members.join(',')
        const room = merged.get(key)
        if (room) room.proposers.push(answer.seat)
        else merged.set(key, { members, proposers: [answer.seat] })
      }
      const rooms = [...merged.values()].sort((a, b) => {
        for (let i = 0; i < Math.min(a.members.length, b.members.length); i++) if (a.members[i] !== b.members[i]) return a.members[i]! - b.members[i]!
        return a.members.length - b.members.length
      })
      commit({ type: 'whisper.proposed', round, rooms })
      const asks: ContestantAsk[] = []
      for (const seat of seats) {
        const candidates = rooms.flatMap((room, i) => room.members.includes(seat) ? [{ room: i + 1, members: room.members }] : [])
        commit({ type: 'whisper.candidates', round, seat, rooms: candidates })
        if (candidates.length) asks.push({ seat, request: { kind: 'rank_whispers', round, rooms: candidates } })
      }
      const answers = await ask(asks)
      const rankings = new Map(answers.map(answer => [answer.seat, args(answer, 'rank_whispers').ranking]))
      for (const answer of answers) commit({ type: 'whisper.ranked', round, seat: answer.seat, ranking: rankings.get(answer.seat)! })
      const available = rooms.flatMap((room, i) => {
        const ranks = room.members.map(seat => rankings.get(seat)?.indexOf(i + 1) ?? -1)
        return ranks.some(rank => rank < 0) ? [] : [{ ...room, number: i + 1, score: ranks.reduce((sum, rank) => sum + rank + 1, 0) }]
      })
      const sorted = ports.rng.shuffle(available).sort((a, b) => a.score - b.score)
      const allocated = new Set<Seat>()
      const opened = sorted.filter(room => {
        if (room.members.some(seat => allocated.has(seat))) return false
        for (const seat of room.members) allocated.add(seat)
        return true
      })
      if (!opened.length) return
      await Promise.all(opened.map(async room => {
        const id = `${g.day}:${round}:${room.number}`
        for (const seat of room.members) remaining.set(seat, remaining.get(seat)! - 1)
        commit({ type: 'whisper.room.opened', round, room: id, members: room.members })
        await conversation(room.members, { where: 'whisper', round, room: id, members: room.members })
        commit({ type: 'whisper.room.closed', round, room: id, members: room.members })
      }))
    }
  }

  async function execute(seat: Seat, virgin = false): Promise<void> {
    executedToday = seat
    await kill(seat, virgin ? 'virgin' : 'execution', { type: 'execution', seat })
  }

  async function nominations(): Promise<void> {
    commit({ type: 'phase.started', day: g.day, phase: 'nomination' })
    let highVotes = 0
    let aboutToDie: Seat | undefined
    while (!ended) {
      const eligible = seats.filter(seat => !p.nomineesToday.includes(seat))
      const nominators = g.seats.filter(player => player.alive && !p.nominatorsToday.includes(player.seat))
      const answers = eligible.length ? await ask(nominators.map(player => ({ seat: player.seat, request: { kind: 'nominate', eligible } }))) : []
      const proposed = answers.filter(answer => args(answer, 'nominate').nominee !== null)
      if (!proposed.length) break
      const chosen = ports.rng.pick(proposed)
      const nominator = chosen.seat
      const nominee = args(chosen, 'nominate').nominee!
      commit({ type: 'nomination', nominator, nominee })
      const virgin = g.seats[nominee - 1]!
      if ((virgin.role === 'virgin' || virgin.role === 'drunk' && g.drunkBelieves === 'virgin') && virgin.alive && !virgin.abilityUsed) {
        const triggered = isFunctioning(g, nominee) && ROLE_BY_ID[registeredRole(g, nominator)].type === 'townsfolk'
        commit({ type: 'status.changed', seat: nominee, status: 'ability_used', on: true })
        if (triggered) {
          commit({ type: 'virgin.triggered', nominator })
          await execute(nominator, true)
          return
        }
      }
      for (const [seat, context] of [[nominator, { where: 'nomination_reason', nominee }], [nominee, { where: 'defense', nominator }]] as const) {
        const [answer] = await ask([{ seat, request: { kind: 'speak', context, remaining: 1 } }])
        if (answer) await speech(answer, context)
      }
      const threshold = Math.ceil(g.seats.filter(player => player.alive).length / 2)
      const votes: { seat: Seat; raised: boolean }[] = []
      for (let offset = 1; offset <= seats.length; offset++) {
        const seat = (nominee - 1 + offset) % seats.length + 1
        const player = g.seats[seat - 1]!
        let raised = false
        let decisionSeq: number | null = null
        if (player.alive || !player.voteTokenUsed) {
          const [answer] = await ask([{ seat, request: { kind: 'vote', nominator, nominee, votes: [...votes], threshold: Math.max(threshold, highVotes + 1), dead: !player.alive } }])
          if (answer) {
            raised = args(answer, 'vote').raise_hand
            decisionSeq = answer.decisionSeq
          }
        }
        commit({ type: 'vote', seat, raised, tokenUsed: !player.alive && raised, decisionSeq })
        votes.push({ seat, raised })
      }
      const count = votes.filter(vote => vote.raised).length
      const leads = count >= threshold && count > highVotes
      if (leads) aboutToDie = nominee
      else if (count >= threshold && count === highVotes) aboutToDie = undefined
      if (count >= threshold) highVotes = Math.max(highVotes, count)
      commit({ type: 'vote.tallied', nominee, votes: count, threshold, aboutToDie: leads })
    }
    if (aboutToDie !== undefined && !ended) await execute(aboutToDie)
  }

  await setup()
  await night(true, 1)
  while (!ended) {
    commit({ type: 'phase.started', day: g.day, phase: 'dawn' })
    for (const player of g.seats) if (player.protectedBy !== null) commit({ type: 'status.changed', seat: player.seat, status: 'protected', on: false, source: player.protectedBy })
    commit({ type: 'dawn.announced', deaths: nightDeaths })
    executedToday = undefined
    await whispers()
    if (ended) return
    commit({ type: 'phase.started', day: g.day, phase: 'public' })
    await conversation(seats, { where: 'public' })
    if (ended) return
    await nominations()
    if (ended) return
    checkWin({ dayEndedWithoutExecution: executedToday === undefined })
    if (ended) return
    await night(false, g.day + 1)
  }
}
