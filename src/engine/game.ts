import { CARD_DEFS } from './cards'
import { nextRandom, shuffle } from './rng'
import type {
  CardInstance,
  GameEvent,
  GameState,
  Move,
  PlayerIndex,
  PlayerState,
  RowKind,
  Target,
  Unit,
} from './types'
import { ROWS } from './types'

export const HAND_LIMIT = 10
export const INITIAL_DRAW = 10
export const ROUND_DRAW = 3
export const WINS_NEEDED = 2
export const FINAL_ROUND = 3
/** Mulligan allowance each round: the round leader gets 3, the other player 2. */
export const MULLIGANS_LEADER = 3
export const MULLIGANS_FOLLOWER = 2

export function mulliganAllowance(state: GameState, player: PlayerIndex): number {
  return player === state.leader ? MULLIGANS_LEADER : MULLIGANS_FOLLOWER
}

function emit(state: GameState, e: GameEvent): void {
  state.events.push(e)
}

function makePlayer(deck: CardInstance[]): PlayerState {
  return {
    deck,
    hand: [],
    graveyard: [],
    rows: { melee: [], ranged: [] },
    passed: false,
    roundWins: 0,
    mulligansLeft: 0,
    mulliganDone: false,
    mulliganBlacklist: [],
  }
}

/** Reset both players' mulligan state for the (new) current round. */
function startMulliganPhase(state: GameState): void {
  state.phase = 'mulligan'
  state.current = state.leader
  for (const player of [0, 1] as const) {
    const p = state.players[player]
    p.mulligansLeft = mulliganAllowance(state, player)
    p.mulliganDone = false
    p.mulliganBlacklist = []
  }
}

function draw(state: GameState, player: PlayerIndex, count: number): void {
  const p = state.players[player]
  for (let i = 0; i < count; i++) {
    if (p.deck.length === 0 || p.hand.length >= HAND_LIMIT) return
    const card = p.deck.shift()!
    p.hand.push(card)
    emit(state, { type: 'drew', player, iid: card.iid, defId: card.defId })
  }
}

export function createGame(deckA: string[], deckB: string[], seed: number): GameState {
  let nextIid = 1
  const instantiate = (defIds: string[]): CardInstance[] => defIds.map((defId) => ({ iid: nextIid++, defId }))

  let rng = seed
  const a = shuffle(instantiate(deckA), rng)
  rng = a.state
  const b = shuffle(instantiate(deckB), rng)
  rng = b.state
  const coin = nextRandom(rng)
  rng = coin.state
  const first: PlayerIndex = coin.value < 0.5 ? 0 : 1

  const state: GameState = {
    players: [makePlayer(a.items), makePlayer(b.items)],
    current: first,
    leader: first,
    phase: 'mulligan',
    round: 1,
    nextIid,
    rng,
    winner: null,
    events: [
      { type: 'gameStarted', first },
      { type: 'roundStarted', round: 1, leader: first },
    ],
  }
  startMulliganPhase(state)
  draw(state, 0, INITIAL_DRAW)
  draw(state, 1, INITIAL_DRAW)
  return state
}

export function rowTotal(row: Unit[]): number {
  return row.reduce((sum, u) => sum + (u.type === 'unit' ? u.power : 0), 0)
}

export function playerTotal(p: PlayerState): number {
  return rowTotal(p.rows.melee) + rowTotal(p.rows.ranged)
}

export function opponentOf(player: PlayerIndex): PlayerIndex {
  return player === 0 ? 1 : 0
}

/** Units directly left and right of the given unit in its row. */
export function neighborsOf(row: Unit[], iid: number): Unit[] {
  const i = row.findIndex((u) => u.iid === iid)
  if (i < 0) return []
  return [row[i - 1], row[i + 1]].filter((u): u is Unit => u !== undefined)
}

function findUnit(state: GameState, target: Target): Unit | undefined {
  return state.players[target.player].rows[target.row].find((u) => u.iid === target.iid)
}

function removeDead(state: GameState, player: PlayerIndex, row: RowKind): void {
  const p = state.players[player]
  const dead = p.rows[row].filter((u) => u.type === 'unit' && u.power <= 0)
  if (dead.length === 0) return
  p.rows[row] = p.rows[row].filter((u) => u.type !== 'unit' || u.power > 0)
  for (const u of dead) {
    p.graveyard.push({ iid: u.iid, defId: u.defId })
    emit(state, { type: 'destroyed', player, iid: u.iid, defId: u.defId })
  }
}

/** Whether a deploy effect has at least one legal target right now. */
export function hasLegalTarget(state: GameState, player: PlayerIndex, defId: string): boolean {
  const deploy = CARD_DEFS[defId].deploy
  if (!deploy) return false
  const enemy = state.players[opponentOf(player)]
  const me = state.players[player]
  const hasUnit = (p: PlayerState) => ROWS.some((r) => p.rows[r].some((u) => u.type === 'unit'))
  switch (deploy.type) {
    case 'damage':
    case 'rowDamage':
      return hasUnit(enemy)
    case 'boost':
      return hasUnit(me)
    default:
      return false
  }
}

/** Resolve a deploy/spell effect. `row` is where the source landed (spells have none). */
function resolveEffect(
  state: GameState,
  player: PlayerIndex,
  source: CardInstance,
  row?: RowKind,
  target?: Target,
): void {
  const deploy = CARD_DEFS[source.defId].deploy
  if (!deploy) return
  const played = source
  const enemy = opponentOf(player)

  switch (deploy.type) {
    case 'damage': {
      if (!target) break
      if (target.player !== enemy) throw new Error('damage must target an enemy unit')
      const unit = findUnit(state, target)
      if (!unit) throw new Error('target unit not found')
      if (unit.type !== 'unit') throw new Error('only units can be damaged')
      unit.power -= deploy.amount
      emit(state, {
        type: 'damaged',
        player: enemy,
        iid: unit.iid,
        defId: unit.defId,
        amount: deploy.amount,
        power: unit.power,
        sourceDefId: played.defId,
      })
      removeDead(state, enemy, target.row)
      break
    }
    case 'boost': {
      if (!target) break
      if (target.player !== player) throw new Error('boost must target an allied unit')
      const unit = findUnit(state, target)
      if (!unit) throw new Error('target unit not found')
      if (unit.type !== 'unit') throw new Error('only units can be boosted')
      unit.power += deploy.amount
      emit(state, {
        type: 'boosted',
        player,
        iid: unit.iid,
        defId: unit.defId,
        amount: deploy.amount,
        power: unit.power,
        sourceDefId: played.defId,
      })
      break
    }
    case 'rowDamage': {
      if (!target) break
      if (target.player !== enemy) throw new Error('rowDamage must target an enemy row')
      for (const u of state.players[enemy].rows[target.row]) {
        if (u.type !== 'unit') continue // artifacts are immune
        u.power -= deploy.amount
        emit(state, {
          type: 'damaged',
          player: enemy,
          iid: u.iid,
          defId: u.defId,
          amount: deploy.amount,
          power: u.power,
          sourceDefId: played.defId,
        })
      }
      removeDead(state, enemy, target.row)
      break
    }
    case 'rowBoost': {
      if (!row) break // needs a board position; spells don't have one
      for (const u of state.players[player].rows[row]) {
        if (u.iid === played.iid || u.type !== 'unit') continue
        u.power += deploy.amount
        emit(state, {
          type: 'boosted',
          player,
          iid: u.iid,
          defId: u.defId,
          amount: deploy.amount,
          power: u.power,
          sourceDefId: played.defId,
        })
      }
      break
    }
    case 'draw': {
      const before = state.players[player].hand.length
      draw(state, player, 1)
      if (state.players[player].hand.length === before) {
        emit(state, { type: 'drawFailed', player, sourceDefId: played.defId })
      }
      break
    }
  }
}

/**
 * Fire the acting player's end-of-turn effects: front (melee) row
 * left-to-right, then back (ranged) row left-to-right.
 */
function resolveEndOfTurn(state: GameState, player: PlayerIndex): void {
  for (const row of ROWS) {
    // Snapshot: today's effects only change power, but future ones may not.
    for (const u of [...state.players[player].rows[row]]) {
      const effect = CARD_DEFS[u.defId].endOfTurn
      if (!effect || u.type !== 'unit') continue
      switch (effect.type) {
        case 'boostSelf': {
          u.power += effect.amount
          emit(state, {
            type: 'boosted',
            player,
            iid: u.iid,
            defId: u.defId,
            amount: effect.amount,
            power: u.power,
            sourceDefId: u.defId,
          })
          break
        }
        case 'boostRight': {
          const live = state.players[player].rows[row]
          const right = live[live.findIndex((x) => x.iid === u.iid) + 1]
          if (!right || right.type !== 'unit') break
          right.power += effect.amount
          emit(state, {
            type: 'boosted',
            player,
            iid: right.iid,
            defId: right.defId,
            amount: effect.amount,
            power: right.power,
            sourceDefId: u.defId,
          })
          break
        }
      }
    }
  }
}

function markPassed(state: GameState, player: PlayerIndex, reason: 'chose' | 'noCards'): void {
  state.players[player].passed = true
  emit(state, { type: 'passed', player, reason })
}

function advanceAfterAction(state: GameState): void {
  const [p0, p1] = state.players
  if (p0.passed && p1.passed) {
    resolveRound(state)
    return
  }
  const other = opponentOf(state.current)
  if (!state.players[other].passed) {
    state.current = other
  }
  // If the (possibly unchanged) current player has no cards, they auto-pass.
  if (!state.players[state.current].passed && state.players[state.current].hand.length === 0) {
    markPassed(state, state.current, 'noCards')
    advanceAfterAction(state)
  }
}

/** Transition from the mulligan phase into normal play. */
function beginPlayPhase(state: GameState): void {
  state.phase = 'play'
  state.current = state.leader
  for (const player of [state.leader, opponentOf(state.leader)]) {
    if (state.players[player].hand.length === 0) markPassed(state, player, 'noCards')
  }
  if (state.players[0].passed && state.players[1].passed) {
    resolveRound(state)
  } else if (state.players[state.current].passed) {
    state.current = opponentOf(state.current)
  }
}

function resolveRound(state: GameState): void {
  const totals: [number, number] = [playerTotal(state.players[0]), playerTotal(state.players[1])]
  let roundWinner: PlayerIndex | 'draw'
  if (totals[0] > totals[1]) roundWinner = 0
  else if (totals[1] > totals[0]) roundWinner = 1
  else roundWinner = 'draw'

  if (roundWinner === 'draw') {
    state.players[0].roundWins++
    state.players[1].roundWins++
  } else {
    state.players[roundWinner].roundWins++
  }
  emit(state, { type: 'roundEnded', round: state.round, totals, winner: roundWinner })

  const wins: [number, number] = [state.players[0].roundWins, state.players[1].roundWins]
  const gameOver = state.round >= FINAL_ROUND || wins[0] >= WINS_NEEDED || wins[1] >= WINS_NEEDED
  if (gameOver) {
    state.winner = wins[0] === wins[1] ? 'draw' : wins[0] > wins[1] ? 0 : 1
    emit(state, { type: 'gameEnded', winner: state.winner, roundWins: wins })
    return
  }

  // Set up the next round: clear boards, reset passes, draw, mulligan phase.
  state.round++
  for (const player of [0, 1] as const) {
    const p = state.players[player]
    for (const row of ROWS) {
      for (const u of p.rows[row]) p.graveyard.push({ iid: u.iid, defId: u.defId })
      p.rows[row] = []
    }
    p.passed = false
  }
  // The round winner leads the next round; on a tie, whoever went second.
  state.leader = roundWinner === 'draw' ? opponentOf(state.leader) : roundWinner
  startMulliganPhase(state)
  emit(state, { type: 'roundStarted', round: state.round, leader: state.leader })
  draw(state, 0, ROUND_DRAW)
  draw(state, 1, ROUND_DRAW)
}

/** Swap a single hand card: shuffle it back (blacklisted) and draw a fresh one. */
function doMulligan(state: GameState, move: Move & { kind: 'mulligan' }): void {
  if (state.phase !== 'mulligan') throw new Error('not in the mulligan phase')
  const p = state.players[move.player]
  if (p.mulliganDone) throw new Error('mulligan already finished')
  if (p.mulligansLeft <= 0) throw new Error('no mulligans left')
  const handIndex = p.hand.findIndex((c) => c.iid === move.iid)
  if (handIndex < 0) throw new Error('mulligan card not in hand')

  const [card] = p.hand.splice(handIndex, 1)
  p.mulliganBlacklist.push(card.iid)
  const r = shuffle([...p.deck, card], state.rng)
  p.deck = r.items
  state.rng = r.state
  emit(state, { type: 'mulliganed', player: move.player, iid: card.iid, defId: card.defId })

  // Draw the top-most card that wasn't swapped away this phase.
  const drawIndex = p.deck.findIndex((c) => !p.mulliganBlacklist.includes(c.iid))
  if (drawIndex >= 0 && p.hand.length < HAND_LIMIT) {
    const [drawn] = p.deck.splice(drawIndex, 1)
    p.hand.push(drawn)
    emit(state, { type: 'drew', player: move.player, iid: drawn.iid, defId: drawn.defId })
  }

  p.mulligansLeft--
  if (p.mulligansLeft === 0) finishMulligan(state, move.player)
}

function doEndMulligan(state: GameState, move: Move & { kind: 'endMulligan' }): void {
  if (state.phase !== 'mulligan') throw new Error('not in the mulligan phase')
  if (state.players[move.player].mulliganDone) throw new Error('mulligan already finished')
  finishMulligan(state, move.player)
}

function finishMulligan(state: GameState, player: PlayerIndex): void {
  const p = state.players[player]
  p.mulliganDone = true
  p.mulliganBlacklist = []
  emit(state, {
    type: 'mulliganEnded',
    player,
    swapped: mulliganAllowance(state, player) - p.mulligansLeft,
  })
  const other = opponentOf(player)
  if (!state.players[other].mulliganDone) state.current = other
  else beginPlayPhase(state)
}

function doPlay(state: GameState, move: Move & { kind: 'play' }): void {
  if (state.phase !== 'play') throw new Error('not in the play phase')
  const p = state.players[move.player]
  if (p.passed) throw new Error('player has passed')
  const handIndex = p.hand.findIndex((c) => c.iid === move.iid)
  if (handIndex < 0) throw new Error('card not in hand')
  const card = p.hand[handIndex]
  const def = CARD_DEFS[card.defId]

  if (def.type === 'spell') {
    // Spells never touch the board: resolve, then straight to the graveyard.
    p.hand.splice(handIndex, 1)
    emit(state, { type: 'played', player: move.player, iid: card.iid, defId: card.defId })
    resolveEffect(state, move.player, card, undefined, move.target)
    p.graveyard.push({ iid: card.iid, defId: card.defId })
  } else {
    if (!move.row) throw new Error('units and artifacts must be played to a row')
    const row = p.rows[move.row]
    const position = move.position ?? row.length
    if (position < 0 || position > row.length) throw new Error('invalid row position')

    p.hand.splice(handIndex, 1)
    const unit: Unit = {
      iid: card.iid,
      defId: card.defId,
      type: def.type,
      basePower: def.power ?? 0,
      power: def.power ?? 0,
    }
    row.splice(position, 0, unit)
    emit(state, { type: 'played', player: move.player, iid: unit.iid, defId: unit.defId, row: move.row, position })
    resolveEffect(state, move.player, card, move.row, move.target)
  }

  if (p.hand.length === 0 && !p.passed) {
    markPassed(state, move.player, 'noCards')
  }
  resolveEndOfTurn(state, move.player)
  advanceAfterAction(state)
}

function doPass(state: GameState, move: Move & { kind: 'pass' }): void {
  if (state.phase !== 'play') throw new Error('not in the play phase')
  if (state.players[move.player].passed) throw new Error('player has passed')
  markPassed(state, move.player, 'chose')
  // Passing still ends a turn: end-of-turn effects fire one final time.
  resolveEndOfTurn(state, move.player)
  advanceAfterAction(state)
}

/** The single entry point for all game input. Returns a new state. */
export function applyMove(state: GameState, move: Move): GameState {
  if (state.winner !== null) throw new Error('game is over')
  if (move.player !== state.current) throw new Error('not your turn')
  const next = structuredClone(state)
  switch (move.kind) {
    case 'mulligan':
      doMulligan(next, move)
      break
    case 'endMulligan':
      doEndMulligan(next, move)
      break
    case 'play':
      doPlay(next, move)
      break
    case 'pass':
      doPass(next, move)
      break
  }
  return next
}
