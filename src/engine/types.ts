export type RowKind = 'melee' | 'ranged'

export const ROWS: RowKind[] = ['melee', 'ranged']

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

export interface Unit {
  uid: number
  defId: string
  name: string
  basePower: number
  power: number
}

export type PlayerIndex = 0 | 1

export interface PlayerState {
  deck: string[]
  hand: string[]
  graveyard: string[]
  rows: Record<RowKind, Unit[]>
  passed: boolean
  roundWins: number
}

export interface Target {
  player: PlayerIndex
  row: RowKind
  /** uid of a unit for unit targets; omit for row targets */
  uid?: number
}

export interface GameState {
  players: [PlayerState, PlayerState]
  current: PlayerIndex
  /** player who led (played first in) the current round */
  leader: PlayerIndex
  round: number
  nextUid: number
  rng: number
  winner: PlayerIndex | 'draw' | null
  log: string[]
}
