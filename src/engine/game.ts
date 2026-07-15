import { CARD_DEFS } from './cards'
import { nextRandom, shuffle } from './rng'
import type { GameState, PlayerIndex, PlayerState, RowKind, Target, Unit } from './types'
import { ROWS } from './types'

export const HAND_LIMIT = 10
export const INITIAL_DRAW = 10
export const ROUND_DRAW = 3
export const WINS_NEEDED = 2
export const FINAL_ROUND = 3

function makePlayer(deck: string[]): PlayerState {
  return {
    deck: deck.slice(),
    hand: [],
    graveyard: [],
    rows: { melee: [], ranged: [] },
    passed: false,
    roundWins: 0,
  }
}

function draw(state: GameState, player: PlayerIndex, count: number): void {
  const p = state.players[player]
  for (let i = 0; i < count; i++) {
    if (p.deck.length === 0 || p.hand.length >= HAND_LIMIT) return
    p.hand.push(p.deck.shift()!)
  }
}

export function createGame(deckA: string[], deckB: string[], seed: number): GameState {
  let rng = seed
  const a = shuffle(deckA, rng)
  rng = a.state
  const b = shuffle(deckB, rng)
  rng = b.state
  const coin = nextRandom(rng)
  rng = coin.state
  const first: PlayerIndex = coin.value < 0.5 ? 0 : 1

  const state: GameState = {
    players: [makePlayer(a.items), makePlayer(b.items)],
    current: first,
    leader: first,
    round: 1,
    nextUid: 1,
    rng,
    winner: null,
    log: [`Round 1 — Player ${first + 1} goes first.`],
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

function findUnit(state: GameState, target: Target): Unit | undefined {
  return state.players[target.player].rows[target.row].find((u) => u.uid === target.uid)
}

function removeDead(state: GameState, player: PlayerIndex, row: RowKind): void {
  const p = state.players[player]
  const dead = p.rows[row].filter((u) => u.power <= 0)
  if (dead.length === 0) return
  p.rows[row] = p.rows[row].filter((u) => u.power > 0)
  for (const u of dead) {
    p.graveyard.push(u.defId)
    state.log.push(`${u.name} is destroyed.`)
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
      state.log.push(`${played.name} deals ${deploy.amount} damage to ${unit.name}.`)
      removeDead(state, enemy, target.row)
      break
    }
    case 'boost': {
      if (!target) break
      if (target.player !== player) throw new Error('boost must target an allied unit')
      const unit = findUnit(state, target)
      if (!unit) throw new Error('target unit not found')
      unit.power += deploy.amount
      state.log.push(`${played.name} boosts ${unit.name} by ${deploy.amount}.`)
      break
    }
    case 'rowDamage': {
      if (!target) break
      if (target.player !== enemy) throw new Error('rowDamage must target an enemy row')
      const units = state.players[enemy].rows[target.row]
      if (units.length > 0) {
        for (const u of units) u.power -= deploy.amount
        state.log.push(`${played.name} deals ${deploy.amount} damage to the enemy ${target.row} row.`)
        removeDead(state, enemy, target.row)
      }
      break
    }
    case 'rowBoost': {
      const allies = state.players[player].rows[row].filter((u) => u.uid !== played.uid)
      for (const u of allies) u.power += deploy.amount
      if (allies.length > 0) {
        state.log.push(`${played.name} boosts ${allies.length} all${allies.length === 1 ? 'y' : 'ies'} by ${deploy.amount}.`)
      }
      break
    }
    case 'draw': {
      draw(state, player, 1)
      state.log.push(`${played.name} draws a card.`)
      break
    }
  }
}

function markPassed(state: GameState, player: PlayerIndex, reason: 'chose' | 'noCards'): void {
  state.players[player].passed = true
  state.log.push(reason === 'chose' ? `Player ${player + 1} passes.` : `Player ${player + 1} is out of cards and passes.`)
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

function resolveRound(state: GameState): void {
  const t0 = playerTotal(state.players[0])
  const t1 = playerTotal(state.players[1])
  let roundWinner: PlayerIndex | 'draw'
  if (t0 > t1) roundWinner = 0
  else if (t1 > t0) roundWinner = 1
  else roundWinner = 'draw'

  if (roundWinner === 'draw') {
    state.players[0].roundWins++
    state.players[1].roundWins++
    state.log.push(`Round ${state.round} is a draw (${t0}–${t1}). Both players gain a round win.`)
  } else {
    state.players[roundWinner].roundWins++
    state.log.push(`Player ${roundWinner + 1} wins round ${state.round} (${t0}–${t1}).`)
  }

  const [w0, w1] = [state.players[0].roundWins, state.players[1].roundWins]
  const gameOver = state.round >= FINAL_ROUND || w0 >= WINS_NEEDED || w1 >= WINS_NEEDED
  if (gameOver) {
    if (w0 === w1) state.winner = 'draw'
    else state.winner = w0 > w1 ? 0 : 1
    state.log.push(state.winner === 'draw' ? 'The game ends in a draw.' : `Player ${state.winner + 1} wins the game!`)
    return
  }

  // Set up next round: clear boards, reset passes, draw up to 3, round winner leads.
  for (const player of [0, 1] as const) {
    const p = state.players[player]
    for (const row of ROWS) {
      for (const u of p.rows[row]) p.graveyard.push(u.defId)
      p.rows[row] = []
    }
    p.passed = false
  }
  state.round++
  draw(state, 0, ROUND_DRAW)
  draw(state, 1, ROUND_DRAW)
  state.leader = roundWinner === 'draw' ? state.leader : roundWinner
  state.current = state.leader
  state.log.push(`Round ${state.round} — Player ${state.current + 1} goes first.`)

  // Handle players who start the round with no cards at all.
  for (const player of [state.current, opponentOf(state.current)]) {
    if (state.players[player].hand.length === 0) markPassed(state, player, 'noCards')
  }
  if (state.players[0].passed && state.players[1].passed) {
    resolveRound(state)
  } else if (state.players[state.current].passed) {
    state.current = opponentOf(state.current)
  }
}

function assertPlayable(state: GameState, player: PlayerIndex): void {
  if (state.winner !== null) throw new Error('game is over')
  if (state.current !== player) throw new Error('not your turn')
  if (state.players[player].passed) throw new Error('player has passed')
}

export function playCard(
  state: GameState,
  player: PlayerIndex,
  handIndex: number,
  row: RowKind,
  target?: Target,
): GameState {
  assertPlayable(state, player)
  const next = structuredClone(state)
  const p = next.players[player]
  const defId = p.hand[handIndex]
  if (defId === undefined) throw new Error('invalid hand index')
  const def = CARD_DEFS[defId]

  p.hand.splice(handIndex, 1)
  const unit: Unit = {
    uid: next.nextUid++,
    defId,
    name: def.name,
    basePower: def.power,
    power: def.power,
  }
  p.rows[row].push(unit)
  next.log.push(`Player ${player + 1} plays ${def.name} (${def.power}) to the ${row} row.`)

  resolveDeploy(next, player, unit, row, target)

  if (p.hand.length === 0 && !p.passed) {
    markPassed(next, player, 'noCards')
  }
  advanceAfterAction(next)
  return next
}

export function pass(state: GameState, player: PlayerIndex): GameState {
  assertPlayable(state, player)
  const next = structuredClone(state)
  markPassed(next, player, 'chose')
  advanceAfterAction(next)
  return next
}
