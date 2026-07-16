import { CARD_DEFS } from './cards'
import { opponentOf, playerTotal } from './game'
import type { CardInstance, GameState, Move, PlayerIndex, RowKind, Target, Unit } from './types'
import { ROWS } from './types'

const KILL_BONUS = 2
const DRAW_VALUE = 4
/** Cards valued below this are mulliganed away. */
const MULLIGAN_THRESHOLD = 6

interface ScoredMove {
  move: Move
  score: number
}

/** Damage/boost-targetable units (artifacts are immune). */
function allUnits(state: GameState, player: PlayerIndex): { unit: Unit; row: RowKind }[] {
  return ROWS.flatMap((row) =>
    state.players[player].rows[row].filter((u) => u.type === 'unit').map((unit) => ({ unit, row })),
  )
}

/** Row with fewer of my units, to spread out against rowDamage. */
function placementRow(state: GameState, me: PlayerIndex): RowKind {
  const rows = state.players[me].rows
  return rows.melee.length <= rows.ranged.length ? 'melee' : 'ranged'
}

/** Expected extra points an end-of-turn effect earns over a round (~3 turns). */
const END_OF_TURN_TURNS = 3

function endOfTurnValue(card: CardInstance): number {
  const effect = CARD_DEFS[card.defId].endOfTurn
  return effect ? effect.amount * END_OF_TURN_TURNS : 0
}

/** Rough standalone value of holding this card. */
function cardValue(card: CardInstance): number {
  const def = CARD_DEFS[card.defId]
  if (def.type === 'unit') return def.power! + (def.deploy ? 3 : 0) + endOfTurnValue(card)
  // Spells and artifacts: judge by their effect size.
  const amount = def.deploy && 'amount' in def.deploy ? def.deploy.amount : 2
  return 4 + amount
}

function chooseMulligan(state: GameState, me: PlayerIndex): Move {
  const p = state.players[me]
  const canDraw = p.deck.some((c) => !p.mulliganBlacklist.includes(c.iid))
  if (p.mulligansLeft > 0 && canDraw) {
    const worst = [...p.hand].sort((a, b) => cardValue(a) - cardValue(b))[0]
    if (worst && cardValue(worst) < MULLIGAN_THRESHOLD) {
      return { kind: 'mulligan', player: me, iid: worst.iid }
    }
  }
  return { kind: 'endMulligan', player: me }
}

function scoreCard(state: GameState, me: PlayerIndex, card: CardInstance): ScoredMove {
  const def = CARD_DEFS[card.defId]
  const deploy = def.deploy
  const enemy = opponentOf(me)
  let row = placementRow(state, me)
  let effectValue = 0
  let target: Target | undefined

  if (deploy) {
    switch (deploy.type) {
      case 'damage': {
        let best = 0
        for (const { unit, row: r } of allUnits(state, enemy)) {
          const value = Math.min(deploy.amount, unit.power) + (unit.power <= deploy.amount ? KILL_BONUS : 0)
          if (value > best) {
            best = value
            target = { player: enemy, row: r, iid: unit.iid }
          }
        }
        effectValue = best
        break
      }
      case 'boost': {
        const candidates = allUnits(state, me)
        if (candidates.length > 0) {
          const pick = candidates[0]
          target = { player: me, row: pick.row, iid: pick.unit.iid }
          effectValue = deploy.amount
        }
        break
      }
      case 'rowDamage': {
        let best = 0
        for (const r of ROWS) {
          const units = state.players[enemy].rows[r].filter((u) => u.type === 'unit')
          const value = units.reduce(
            (sum, u) => sum + Math.min(deploy.amount, u.power) + (u.power <= deploy.amount ? KILL_BONUS : 0),
            0,
          )
          if (value > best) {
            best = value
            target = { player: enemy, row: r }
          }
        }
        effectValue = best
        break
      }
      case 'rowBoost': {
        // Play into whichever of my rows has the most boostable allies.
        const rows = state.players[me].rows
        const boostable = (r: RowKind) => rows[r].filter((u) => u.type === 'unit').length
        row = boostable('melee') >= boostable('ranged') ? 'melee' : 'ranged'
        effectValue = deploy.amount * boostable(row)
        break
      }
      case 'draw': {
        effectValue = state.players[me].deck.length > 0 ? DRAW_VALUE : 0
        break
      }
    }
  }

  effectValue += endOfTurnValue(card)
  // A boostRight unit wants a unit on its right: insert at the left end of
  // whichever row has the most units.
  let position: number | undefined
  if (def.endOfTurn?.type === 'boostRight') {
    const rows = state.players[me].rows
    row = rows.melee.length >= rows.ranged.length ? 'melee' : 'ranged'
    position = 0
  }

  const move: Move =
    def.type === 'spell'
      ? { kind: 'play', player: me, iid: card.iid, target }
      : { kind: 'play', player: me, iid: card.iid, row, position, target }
  return { move, score: (def.type === 'unit' ? def.power! : 0) + effectValue }
}

/** Optimistic estimate of how many points the rest of the hand could add. */
function handPotential(state: GameState, me: PlayerIndex): number {
  return state.players[me].hand.reduce((sum, card) => {
    const def = CARD_DEFS[card.defId]
    const effect = def.deploy && def.deploy.type !== 'draw' && 'amount' in def.deploy ? def.deploy.amount : 0
    return sum + (def.power ?? 0) + effect
  }, 0)
}

export function chooseMove(state: GameState, me: PlayerIndex): Move {
  if (state.phase === 'mulligan') return chooseMulligan(state, me)

  const enemy = opponentOf(me)
  const myTotal = playerTotal(state.players[me])
  const enemyTotal = playerTotal(state.players[enemy])
  const enemyPassed = state.players[enemy].passed
  const hand = state.players[me].hand

  if (hand.length === 0) return { kind: 'pass', player: me }

  if (enemyPassed) {
    // Already winning: lock in the round without spending more cards.
    if (myTotal > enemyTotal) return { kind: 'pass', player: me }
    // Can't catch up even by playing everything: concede the round, save cards.
    if (myTotal + handPotential(state, me) <= enemyTotal) return { kind: 'pass', player: me }
  } else if (state.round === 1 && myTotal - enemyTotal > 20) {
    // Bank a huge lead in round 1 rather than overcommitting.
    return { kind: 'pass', player: me }
  }

  let best: ScoredMove | null = null
  for (const card of hand) {
    const scored = scoreCard(state, me, card)
    if (!best || scored.score > best.score) best = scored
  }
  return best!.move
}
