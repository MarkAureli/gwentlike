export type RowKind = 'melee' | 'ranged'

export const ROWS: RowKind[] = ['melee', 'ranged']

export type Phase = 'mulligan' | 'play'

export type DeployEffect =
  | { type: 'damage'; amount: number } // damage one enemy unit
  | { type: 'boost'; amount: number } // boost one allied unit
  | { type: 'rowDamage'; amount: number } // damage every unit in one enemy row
  | { type: 'rowBoost'; amount: number } // boost every other ally in the row this unit is played to
  | { type: 'draw' } // draw a card

export interface CardDef {
  id: string
  name: string
  power: number
  provisions: number
  deploy?: DeployEffect
}

/**
 * A physical copy of a card. The iid is assigned once at game creation and
 * follows the card through deck, hand, board and graveyard.
 */
export interface CardInstance {
  iid: number
  defId: string
}

export interface Unit extends CardInstance {
  basePower: number
  power: number
}

export type PlayerIndex = 0 | 1

export interface PlayerState {
  deck: CardInstance[]
  hand: CardInstance[]
  graveyard: CardInstance[]
  rows: Record<RowKind, Unit[]>
  passed: boolean
  roundWins: number
  mulligansLeft: number
  mulliganDone: boolean
}

export interface Target {
  player: PlayerIndex
  row: RowKind
  /** iid of a unit for unit targets; omit for row targets */
  iid?: number
}

/**
 * The single unit of game input: a game is a seed plus a list of moves.
 * `position` is the insertion index within the row (append when omitted) —
 * rows are ordered and adjacency will matter for future mechanics.
 */
export type Move =
  | { kind: 'play'; player: PlayerIndex; iid: number; row: RowKind; position?: number; target?: Target }
  | { kind: 'pass'; player: PlayerIndex }
  | { kind: 'mulligan'; player: PlayerIndex; iids: number[] }

/**
 * Everything that happens is recorded as a typed event. The UI derives its
 * log text (and, later, animations) from these instead of parsing prose.
 */
export type GameEvent =
  | { type: 'gameStarted'; first: PlayerIndex }
  | { type: 'roundStarted'; round: number; leader: PlayerIndex }
  | { type: 'mulliganed'; player: PlayerIndex; count: number }
  | { type: 'played'; player: PlayerIndex; iid: number; defId: string; row: RowKind; position: number }
  | { type: 'drew'; player: PlayerIndex; iid: number; defId: string }
  | { type: 'drawFailed'; player: PlayerIndex; sourceDefId: string }
  | { type: 'damaged'; player: PlayerIndex; iid: number; defId: string; amount: number; power: number; sourceDefId: string }
  | { type: 'boosted'; player: PlayerIndex; iid: number; defId: string; amount: number; power: number; sourceDefId: string }
  | { type: 'destroyed'; player: PlayerIndex; iid: number; defId: string }
  | { type: 'passed'; player: PlayerIndex; reason: 'chose' | 'noCards' }
  | { type: 'roundEnded'; round: number; totals: [number, number]; winner: PlayerIndex | 'draw' }
  | { type: 'gameEnded'; winner: PlayerIndex | 'draw'; roundWins: [number, number] }

export interface GameState {
  players: [PlayerState, PlayerState]
  current: PlayerIndex
  /** player who leads (acts first in) the current round */
  leader: PlayerIndex
  phase: Phase
  round: number
  nextIid: number
  rng: number
  winner: PlayerIndex | 'draw' | null
  events: GameEvent[]
}
