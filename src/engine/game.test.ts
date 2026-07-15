import { describe, expect, it } from 'vitest'
import { chooseMove } from './ai'
import { STARTER_DECK } from './cards'
import { createGame, HAND_LIMIT, pass, playCard, playerTotal } from './game'
import type { GameState, PlayerIndex } from './types'

/** Build a game with known hands: shuffle is bypassed by using uniform decks. */
function gameWith(hand0: string[], hand1: string[], first: PlayerIndex = 0): GameState {
  const state = createGame(STARTER_DECK, STARTER_DECK, 42)
  state.players[0].hand = hand0.slice()
  state.players[1].hand = hand1.slice()
  state.current = first
  state.leader = first
  return state
}

describe('createGame', () => {
  it('deals 10 cards to each player from a 25-card deck', () => {
    const g = createGame(STARTER_DECK, STARTER_DECK, 1)
    for (const p of g.players) {
      expect(p.hand).toHaveLength(10)
      expect(p.deck).toHaveLength(15)
      expect(p.roundWins).toBe(0)
      expect(p.passed).toBe(false)
    }
    expect(g.round).toBe(1)
    expect(g.winner).toBeNull()
  })

  it('is deterministic for a given seed', () => {
    const a = createGame(STARTER_DECK, STARTER_DECK, 7)
    const b = createGame(STARTER_DECK, STARTER_DECK, 7)
    expect(a.players[0].hand).toEqual(b.players[0].hand)
    expect(a.current).toBe(b.current)
  })
})

describe('playCard', () => {
  it('places a unit and alternates turns', () => {
    let g = gameWith(['militia', 'pikeman'], ['shieldbearer'])
    g = playCard(g, 0, 0, 'melee')
    expect(g.players[0].rows.melee).toHaveLength(1)
    expect(g.players[0].rows.melee[0].power).toBe(4)
    expect(g.players[0].hand).toEqual(['pikeman'])
    expect(g.current).toBe(1)
  })

  it('rejects out-of-turn and post-pass plays', () => {
    const g = gameWith(['militia'], ['militia'])
    expect(() => playCard(g, 1, 0, 'melee')).toThrow('not your turn')
    const passed = pass(g, 0)
    expect(() => playCard(passed, 0, 0, 'melee')).toThrow()
  })

  it('damage deploy hurts and can destroy enemy units', () => {
    let g = gameWith(['militia', 'militia'], ['assassin', 'scout'])
    g = playCard(g, 0, 0, 'melee') // 4-power militia
    const militiaUid = g.players[0].rows.melee[0].uid
    // Assassin deals 5: kills the 4-power militia.
    g = playCard(g, 1, 0, 'ranged', { player: 0, row: 'melee', uid: militiaUid })
    expect(g.players[0].rows.melee).toHaveLength(0)
    expect(g.players[0].graveyard).toContain('militia')
  })

  it('boost deploy raises an allied unit', () => {
    let g = gameWith(['militia', 'medic'], ['militia', 'militia'])
    g = playCard(g, 0, 0, 'melee')
    g = playCard(g, 1, 0, 'melee')
    const allyUid = g.players[0].rows.melee[0].uid
    g = playCard(g, 0, 0, 'ranged', { player: 0, row: 'melee', uid: allyUid })
    expect(g.players[0].rows.melee[0].power).toBe(7)
  })

  it('rowBoost boosts other allies in the row it lands in', () => {
    let g = gameWith(['militia', 'drummer'], ['militia', 'militia'])
    g = playCard(g, 0, 0, 'melee')
    g = playCard(g, 1, 0, 'melee')
    g = playCard(g, 0, 0, 'melee') // drummer into same row
    const row = g.players[0].rows.melee
    expect(row.find((u) => u.defId === 'militia')!.power).toBe(5)
    expect(row.find((u) => u.defId === 'drummer')!.power).toBe(2)
  })

  it('draw deploy draws a card', () => {
    let g = gameWith(['scholar', 'militia'], ['militia'])
    const deckBefore = g.players[0].deck.length
    g = playCard(g, 0, 0, 'ranged')
    expect(g.players[0].deck).toHaveLength(deckBefore - 1)
    expect(g.players[0].hand).toHaveLength(2) // militia + drawn card
  })
})

describe('rounds and game end', () => {
  it('resolves a round when both players pass and starts the next', () => {
    let g = gameWith(['pikeman', 'militia'], ['militia', 'militia'])
    g = playCard(g, 0, 0, 'melee') // P1: 6
    g = playCard(g, 1, 0, 'melee') // P2: 4
    g = pass(g, 0)
    g = pass(g, 1)
    expect(g.round).toBe(2)
    expect(g.players[0].roundWins).toBe(1)
    expect(g.players[1].roundWins).toBe(0)
    // Board cleared into graveyards, passes reset, 3 cards drawn.
    expect(g.players[0].rows.melee).toHaveLength(0)
    expect(g.players[0].graveyard).toContain('pikeman')
    expect(g.players[0].passed).toBe(false)
    // Round winner leads the next round.
    expect(g.current).toBe(0)
  })

  it('a drawn round gives both players a round win', () => {
    let g = gameWith(['militia', 'militia'], ['militia', 'militia'])
    g = playCard(g, 0, 0, 'melee')
    g = playCard(g, 1, 0, 'ranged')
    g = pass(g, 0)
    g = pass(g, 1)
    expect(g.players[0].roundWins).toBe(1)
    expect(g.players[1].roundWins).toBe(1)
  })

  it('first to two round wins takes the game', () => {
    let g = gameWith(['pikeman', 'pikeman', 'militia'], ['militia', 'militia', 'militia'])
    // Round 1: P1 wins 6-4.
    g = playCard(g, 0, 0, 'melee')
    g = playCard(g, 1, 0, 'melee')
    g = pass(g, 0)
    g = pass(g, 1)
    // Round 2: P1 wins again.
    g = playCard(g, 0, 0, 'melee')
    g = playCard(g, 1, 0, 'melee')
    g = pass(g, 0)
    g = pass(g, 1)
    expect(g.winner).toBe(0)
    expect(() => playCard(g, 0, 0, 'melee')).toThrow('game is over')
  })

  it('a passed opponent lets the other player act repeatedly', () => {
    let g = gameWith(['militia', 'militia', 'militia'], ['militia'])
    g = playCard(g, 0, 0, 'melee')
    g = pass(g, 1)
    expect(g.current).toBe(0)
    g = playCard(g, 0, 0, 'melee')
    expect(g.current).toBe(0)
  })

  it('never draws above the hand limit', () => {
    let g = gameWith(
      ['militia', 'militia', 'militia', 'militia', 'militia', 'militia', 'militia', 'militia', 'militia', 'pikeman'],
      ['militia'],
    )
    // P1 plays one card (9 left), P2 passes, P1 wins the round, draws 3 → capped at 10.
    g = playCard(g, 0, 9, 'melee') // play the pikeman: P1 leads 6-0
    g = pass(g, 1)
    g = pass(g, 0)
    expect(g.round).toBe(2)
    expect(g.players[0].hand.length).toBeLessThanOrEqual(HAND_LIMIT)
  })
})

describe('AI', () => {
  it('passes when opponent passed and it is ahead', () => {
    let g = gameWith(['pikeman', 'militia'], ['militia', 'militia'], 1)
    g = playCard(g, 1, 0, 'melee') // AI-side setup: P2 plays 4
    g = playCard(g, 0, 0, 'melee') // P1 plays 6
    g = pass(g, 1)
    // Now P1 (me=0) is ahead 6-4 with opponent passed.
    expect(playerTotal(g.players[0])).toBeGreaterThan(playerTotal(g.players[1]))
    expect(chooseMove(g, 0)).toEqual({ kind: 'pass' })
  })

  it('concedes an unwinnable round to save cards', () => {
    let g = gameWith(['champion', 'champion', 'militia'], ['militia', 'militia', 'militia'], 0)
    g = playCard(g, 0, 0, 'melee') // P1: 10
    g = playCard(g, 1, 0, 'melee') // P2: 4
    g = playCard(g, 0, 0, 'melee') // P1: 20
    g = playCard(g, 1, 0, 'melee') // P2: 8
    g = pass(g, 0)
    // P2 is at 8 vs 20 with one militia (4) left: 12 < 20, so concede.
    expect(chooseMove(g, 1)).toEqual({ kind: 'pass' })
  })

  it('produces a legal move that the engine accepts', () => {
    let g = createGame(STARTER_DECK, STARTER_DECK, 99)
    for (let i = 0; i < 200 && g.winner === null; i++) {
      const me = g.current
      const move = chooseMove(g, me)
      g = move.kind === 'pass' ? pass(g, me) : playCard(g, me, move.handIndex, move.row, move.target)
    }
    expect(g.winner).not.toBeNull()
  })
})
