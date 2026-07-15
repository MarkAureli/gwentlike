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
/** Mulligan allowance at the start of rounds 1, 2 and 3. */
export const MULLIGANS_PER_ROUND = [3, 1, 1]

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
    mulligansLeft: MULLIGANS_PER_ROUND[0],
    mulliganDone: false,
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
  draw(state, 0, INITIAL_DRAW)
  draw(state, 1, INITIAL_DRAW)
  return state
}

export function rowTotal(row: Unit[]): number {
  return row.reduce((sum, u) => sum + u.power, 0)
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
  const dead = p.rows[row].filter((u) => u.power <= 0)
  if (dead.length === 0) return
  p.rows[row] = p.rows[row].filter((u) => u.power > 0)
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
  switch (deploy.type) {
    case 'damage':
    case 'rowDamage':
      return enemy.rows.melee.length > 0 || enemy.rows.ranged.length > 0
    case 'boost':
      return me.rows.melee.length > 0 || me.rows.ranged.length > 0
    default:
      return false
  }
}

function resolveDeploy(state: GameState, player: PlayerIndex, played: Unit, row: RowKind, target?: Target): void {
  const deploy = CARD_DEFS[played.defId].deploy
  if (!deploy) return
  const enemy = opponentOf(player)

  switch (deploy.type) {
    case 'damage': {
      if (!target) break
      if (target.player !== enemy) throw new Error('damage must target an enemy unit')
      const unit = findUnit(state, target)
      if (!unit) throw new Error('target unit not found')
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
      for (const u of state.players[player].rows[row]) {
        if (u.iid === played.iid) continue
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
    p.mulliganDone = false
    p.mulligansLeft = MULLIGANS_PER_ROUND[state.round - 1]
  }
  state.leader = roundWinner === 'draw' ? state.leader : roundWinner
  state.current = state.leader
  state.phase = 'mulligan'
  emit(state, { type: 'roundStarted', round: state.round, leader: state.leader })
  draw(state, 0, ROUND_DRAW)
  draw(state, 1, ROUND_DRAW)
}

function doMulligan(state: GameState, move: Move & { kind: 'mulligan' }): void {
  if (state.phase !== 'mulligan') throw new Error('not in the mulligan phase')
  const p = state.players[move.player]
  if (new Set(move.iids).size !== move.iids.length) throw new Error('duplicate mulligan targets')
  if (move.iids.length > p.mulligansLeft) throw new Error('too many mulligans')
  const returned = move.iids.map((iid) => {
    const card = p.hand.find((c) => c.iid === iid)
    if (!card) throw new Error('mulligan card not in hand')
    return card
  })

  p.hand = p.hand.filter((c) => !move.iids.includes(c.iid))
  // Draw replacements before returning the swapped cards, so a swapped card
  // can never be drawn straight back.
  draw(state, move.player, returned.length)
  const r = shuffle([...p.deck, ...returned], state.rng)
  p.deck = r.items
  state.rng = r.state
  p.mulligansLeft -= move.iids.length
  p.mulliganDone = true
  emit(state, { type: 'mulliganed', player: move.player, count: move.iids.length })

  const other = opponentOf(move.player)
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
  const row = p.rows[move.row]
  const position = move.position ?? row.length
  if (position < 0 || position > row.length) throw new Error('invalid row position')

  p.hand.splice(handIndex, 1)
  const unit: Unit = { iid: card.iid, defId: card.defId, basePower: def.power, power: def.power }
  row.splice(position, 0, unit)
  emit(state, { type: 'played', player: move.player, iid: unit.iid, defId: unit.defId, row: move.row, position })

  resolveDeploy(state, move.player, unit, move.row, move.target)

  if (p.hand.length === 0 && !p.passed) {
    markPassed(state, move.player, 'noCards')
  }
  advanceAfterAction(state)
}

function doPass(state: GameState, move: Move & { kind: 'pass' }): void {
  if (state.phase !== 'play') throw new Error('not in the play phase')
  if (state.players[move.player].passed) throw new Error('player has passed')
  markPassed(state, move.player, 'chose')
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
    case 'play':
      doPlay(next, move)
      break
    case 'pass':
      doPass(next, move)
      break
  }
  return next
}
