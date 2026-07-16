import { describe, expect, it } from 'vitest'
import { chooseMove } from './ai'
import { STARTER_DECK } from './cards'
import {
  applyMove,
  createGame,
  HAND_LIMIT,
  MULLIGANS_FOLLOWER,
  MULLIGANS_LEADER,
  neighborsOf,
  opponentOf,
  playerTotal,
} from './game'
import type { CardInstance, GameState, PlayerIndex, RowKind, Target } from './types'

let testIid = 1000
function instances(defIds: string[]): CardInstance[] {
  return defIds.map((defId) => ({ iid: testIid++, defId }))
}

/** Game in the play phase with known hands (mulligans already skipped). */
function gameWith(hand0: string[], hand1: string[], first: PlayerIndex = 0): GameState {
  const state = createGame(STARTER_DECK, STARTER_DECK, 42)
  state.players[0].hand = instances(hand0)
  state.players[1].hand = instances(hand1)
  state.players[0].mulliganDone = true
  state.players[1].mulliganDone = true
  state.phase = 'play'
  state.current = first
  state.leader = first
  return state
}

/** Play the card at a hand index (helper mirroring the old API). */
function play(g: GameState, player: PlayerIndex, handIndex: number, row: RowKind, target?: Target): GameState {
  return applyMove(g, { kind: 'play', player, iid: g.players[player].hand[handIndex].iid, row, target })
}

function pass(g: GameState, player: PlayerIndex): GameState {
  return applyMove(g, { kind: 'pass', player })
}

function skipMulligans(g: GameState): GameState {
  while (g.phase === 'mulligan' && g.winner === null) {
    g = applyMove(g, { kind: 'endMulligan', player: g.current })
  }
  return g
}

describe('createGame', () => {
  it('deals 10 cards each and starts in the mulligan phase', () => {
    const g = createGame(STARTER_DECK, STARTER_DECK, 1)
    for (const p of g.players) {
      expect(p.hand).toHaveLength(10)
      expect(p.deck).toHaveLength(15)
      expect(p.mulliganDone).toBe(false)
    }
    expect(g.players[g.leader].mulligansLeft).toBe(MULLIGANS_LEADER)
    expect(g.players[opponentOf(g.leader)].mulligansLeft).toBe(MULLIGANS_FOLLOWER)
    expect(g.phase).toBe('mulligan')
    expect(g.round).toBe(1)
    expect(g.winner).toBeNull()
  })

  it('assigns a unique instance id to every card', () => {
    const g = createGame(STARTER_DECK, STARTER_DECK, 1)
    const iids = g.players.flatMap((p) => [...p.deck, ...p.hand].map((c) => c.iid))
    expect(new Set(iids).size).toBe(50)
  })

  it('is deterministic for a given seed', () => {
    const a = createGame(STARTER_DECK, STARTER_DECK, 7)
    const b = createGame(STARTER_DECK, STARTER_DECK, 7)
    expect(a.players[0].hand).toEqual(b.players[0].hand)
    expect(a.current).toBe(b.current)
  })
})

describe('mulligan', () => {
  it('swaps one card at a time and keeps control until finished', () => {
    const g0 = createGame(STARTER_DECK, STARTER_DECK, 3)
    const me = g0.current
    const swapped = g0.players[me].hand[0]
    const g = applyMove(g0, { kind: 'mulligan', player: me, iid: swapped.iid })
    const p = g.players[me]
    expect(p.hand).toHaveLength(10) // one out, one replacement in
    expect(p.deck).toHaveLength(15)
    expect(p.hand.some((c) => c.iid === swapped.iid)).toBe(false)
    expect(p.deck.some((c) => c.iid === swapped.iid)).toBe(true)
    expect(p.mulligansLeft).toBe(MULLIGANS_LEADER - 1)
    expect(p.mulliganDone).toBe(false)
    expect(g.current).toBe(me) // still this player's mulligan
  })

  it('never redraws a card swapped away in the same mulligan phase', () => {
    let g = createGame(STARTER_DECK, STARTER_DECK, 3)
    const me = g.current
    // Rig the deck to a single card X so draws are fully predictable.
    const x: CardInstance = { iid: 900, defId: 'champion' }
    g.players[me].deck = [x]
    const a = g.players[me].hand[0]
    g = applyMove(g, { kind: 'mulligan', player: me, iid: a.iid })
    let p = g.players[me]
    // The replacement must be X; A sits in the deck but is blacklisted.
    expect(p.hand.at(-1)!.iid).toBe(x.iid)
    expect(p.deck.map((c) => c.iid)).toEqual([a.iid])
    // Swap X — a card drawn during this very mulligan — right back out.
    // The deck now holds only blacklisted cards, so nothing is drawn.
    g = applyMove(g, { kind: 'mulligan', player: me, iid: x.iid })
    p = g.players[me]
    expect(p.hand).toHaveLength(9)
    expect(p.hand.some((c) => c.iid === a.iid || c.iid === x.iid)).toBe(false)
    expect(p.deck).toHaveLength(2)
  })

  it('finishes automatically after the last allowed swap', () => {
    let g = createGame(STARTER_DECK, STARTER_DECK, 3)
    const me = g.current // the leader: 3 swaps
    for (let i = 0; i < MULLIGANS_LEADER; i++) {
      expect(g.current).toBe(me)
      g = applyMove(g, { kind: 'mulligan', player: me, iid: g.players[me].hand[0].iid })
    }
    expect(g.players[me].mulliganDone).toBe(true)
    expect(g.players[me].mulliganBlacklist).toEqual([]) // cleared when done
    expect(g.current).toBe(opponentOf(me))
    expect(g.players[opponentOf(me)].mulligansLeft).toBe(MULLIGANS_FOLLOWER)
  })

  it('moves to the play phase once both players finish, leader first', () => {
    let g = createGame(STARTER_DECK, STARTER_DECK, 3)
    const leader = g.leader
    g = applyMove(g, { kind: 'endMulligan', player: g.current })
    expect(g.phase).toBe('mulligan')
    expect(g.current).toBe(opponentOf(leader))
    g = applyMove(g, { kind: 'endMulligan', player: g.current })
    expect(g.phase).toBe('play')
    expect(g.current).toBe(leader)
  })

  it('rejects plays and passes during the mulligan phase', () => {
    const g = createGame(STARTER_DECK, STARTER_DECK, 3)
    const me = g.current
    const iid = g.players[me].hand[0].iid
    expect(() => applyMove(g, { kind: 'play', player: me, iid, row: 'melee' })).toThrow('not in the play phase')
    expect(() => applyMove(g, { kind: 'pass', player: me })).toThrow('not in the play phase')
  })

  it('rejects mulligan moves during the play phase', () => {
    const g = gameWith(['militia'], ['militia'])
    expect(() =>
      applyMove(g, { kind: 'mulligan', player: 0, iid: g.players[0].hand[0].iid }),
    ).toThrow('not in the mulligan phase')
    expect(() => applyMove(g, { kind: 'endMulligan', player: 0 })).toThrow('not in the mulligan phase')
  })
})

describe('playing cards', () => {
  it('places a unit and alternates turns', () => {
    let g = gameWith(['militia', 'pikeman'], ['shieldbearer'])
    g = play(g, 0, 0, 'melee')
    expect(g.players[0].rows.melee).toHaveLength(1)
    expect(g.players[0].rows.melee[0].power).toBe(4)
    expect(g.players[0].hand.map((c) => c.defId)).toEqual(['pikeman'])
    expect(g.current).toBe(1)
  })

  it('keeps a card’s instance id from hand to board', () => {
    let g = gameWith(['militia'], ['militia'])
    const iid = g.players[0].hand[0].iid
    g = play(g, 0, 0, 'melee')
    expect(g.players[0].rows.melee[0].iid).toBe(iid)
  })

  it('inserts at an explicit position within the row', () => {
    // The spare champion keeps the hand non-empty so the round doesn't end.
    let g = gameWith(['militia', 'pikeman', 'shieldbearer', 'champion'], ['militia'], 0)
    g = play(g, 0, 0, 'melee')
    g = pass(g, 1)
    g = play(g, 0, 0, 'melee') // append: [militia, pikeman]
    g = applyMove(g, {
      kind: 'play',
      player: 0,
      iid: g.players[0].hand[0].iid,
      row: 'melee',
      position: 1, // insert between the two
    })
    expect(g.players[0].rows.melee.map((u) => u.defId)).toEqual(['militia', 'shieldbearer', 'pikeman'])
  })

  it('rejects an out-of-bounds position', () => {
    const g = gameWith(['militia'], ['militia'])
    const iid = g.players[0].hand[0].iid
    expect(() => applyMove(g, { kind: 'play', player: 0, iid, row: 'melee', position: 5 })).toThrow(
      'invalid row position',
    )
  })

  it('rejects out-of-turn and post-pass plays', () => {
    const g = gameWith(['militia'], ['militia'])
    expect(() => play(g, 1, 0, 'melee')).toThrow('not your turn')
    const passed = pass(g, 0)
    expect(() => play(passed, 0, 0, 'melee')).toThrow()
  })

  it('damage deploy hurts and can destroy enemy units', () => {
    let g = gameWith(['militia', 'militia'], ['assassin', 'scout'])
    g = play(g, 0, 0, 'melee') // 4-power militia
    const militiaIid = g.players[0].rows.melee[0].iid
    // Assassin deals 5: kills the 4-power militia.
    g = play(g, 1, 0, 'ranged', { player: 0, row: 'melee', iid: militiaIid })
    expect(g.players[0].rows.melee).toHaveLength(0)
    expect(g.players[0].graveyard.some((c) => c.iid === militiaIid)).toBe(true)
    expect(g.events.some((e) => e.type === 'destroyed' && e.iid === militiaIid)).toBe(true)
  })

  it('boost deploy raises an allied unit', () => {
    let g = gameWith(['militia', 'medic'], ['militia', 'militia'])
    g = play(g, 0, 0, 'melee')
    g = play(g, 1, 0, 'melee')
    const allyIid = g.players[0].rows.melee[0].iid
    g = play(g, 0, 0, 'ranged', { player: 0, row: 'melee', iid: allyIid })
    expect(g.players[0].rows.melee[0].power).toBe(7)
  })

  it('rowBoost boosts other allies in the row it lands in', () => {
    let g = gameWith(['militia', 'drummer'], ['militia', 'militia'])
    g = play(g, 0, 0, 'melee')
    g = play(g, 1, 0, 'melee')
    g = play(g, 0, 0, 'melee') // drummer into same row
    const row = g.players[0].rows.melee
    expect(row.find((u) => u.defId === 'militia')!.power).toBe(5)
    expect(row.find((u) => u.defId === 'drummer')!.power).toBe(2)
  })

  it('draw deploy draws a card and emits a drew event', () => {
    let g = gameWith(['scholar', 'militia'], ['militia'])
    const deckBefore = g.players[0].deck.length
    const expected = g.players[0].deck[0]
    g = play(g, 0, 0, 'ranged')
    expect(g.players[0].deck).toHaveLength(deckBefore - 1)
    expect(g.players[0].hand).toHaveLength(2) // militia + drawn card
    expect(g.events.at(-1)).toEqual({ type: 'drew', player: 0, iid: expected.iid, defId: expected.defId })
  })

  it('scholar draws even from a full 10-card opening hand', () => {
    const g0 = createGame(STARTER_DECK, STARTER_DECK, 5)
    g0.players[0].hand = instances(['scholar', ...Array(9).fill('militia')])
    g0.players[0].mulliganDone = true
    g0.players[1].mulliganDone = true
    g0.phase = 'play'
    g0.current = 0
    g0.leader = 0
    const expectedDraw = g0.players[0].deck[0]
    const g = play(g0, 0, 0, 'ranged')
    // Played one, drew one: hand stays at 10, deck shrinks, drawn card is last.
    expect(g.players[0].hand).toHaveLength(10)
    expect(g.players[0].deck).toHaveLength(14)
    expect(g.players[0].hand[9].iid).toBe(expectedDraw.iid)
  })
})

describe('spells', () => {
  it('resolve their effect and go straight to the graveyard', () => {
    let g = gameWith(['militia', 'militia'], ['fireball', 'militia'])
    g = play(g, 0, 0, 'melee') // 4-power militia
    const targetIid = g.players[0].rows.melee[0].iid
    const fireballIid = g.players[1].hand[0].iid
    // Fireball needs no row.
    g = applyMove(g, { kind: 'play', player: 1, iid: fireballIid, target: { player: 0, row: 'melee', iid: targetIid } })
    // Fireball (4 damage) kills the militia and is never on the board.
    expect(g.players[0].rows.melee).toHaveLength(0)
    expect(g.players[1].rows.melee).toHaveLength(0)
    expect(g.players[1].rows.ranged).toHaveLength(0)
    expect(g.players[1].graveyard.some((c) => c.iid === fireballIid)).toBe(true)
    expect(g.players[1].hand.map((c) => c.defId)).toEqual(['militia'])
  })

  it('contribute nothing to the row totals', () => {
    let g = gameWith(['militia', 'blessing'], ['militia', 'militia'])
    g = play(g, 0, 0, 'melee')
    g = play(g, 1, 0, 'melee')
    const allyIid = g.players[0].rows.melee[0].iid
    g = applyMove(g, {
      kind: 'play',
      player: 0,
      iid: g.players[0].hand[0].iid,
      target: { player: 0, row: 'melee', iid: allyIid },
    })
    expect(playerTotal(g.players[0])).toBe(8) // 4 militia + 4 blessing boost
  })
})

describe('artifacts', () => {
  it('occupy a row with zero power and stay after their deploy resolves', () => {
    let g = gameWith(['militia', 'watchtower', 'militia'], ['militia', 'militia'])
    g = play(g, 0, 0, 'melee')
    g = play(g, 1, 0, 'melee')
    const enemyIid = g.players[1].rows.melee[0].iid
    g = play(g, 0, 0, 'ranged', { player: 1, row: 'melee', iid: enemyIid })
    // Watchtower dealt 2 damage and sits on the board contributing nothing.
    expect(g.players[1].rows.melee[0].power).toBe(2)
    expect(g.players[0].rows.ranged).toHaveLength(1)
    expect(g.players[0].rows.ranged[0].type).toBe('artifact')
    expect(playerTotal(g.players[0])).toBe(4) // militia only
  })

  it('cannot be damaged directly and are immune to row damage', () => {
    let g = gameWith(['watchtower', 'militia', 'militia'], ['assassin', 'saboteur', 'militia'])
    g = play(g, 0, 0, 'melee') // watchtower (no enemy units yet: deploy fizzles)
    const towerIid = g.players[0].rows.melee[0].iid
    // Direct damage at the artifact is rejected.
    expect(() =>
      play(g, 1, 0, 'ranged', { player: 0, row: 'melee', iid: towerIid }),
    ).toThrow('only units can be damaged')
    // Row damage sweeps past it.
    g = play(g, 1, 1, 'ranged', { player: 0, row: 'melee' }) // saboteur rowDamage 1
    expect(g.players[0].rows.melee).toHaveLength(1)
    expect(g.players[0].rows.melee[0].iid).toBe(towerIid)
  })

  it('go to the graveyard when the round ends', () => {
    let g = gameWith(['watchtower', 'militia'], ['militia', 'militia'])
    g = play(g, 0, 0, 'melee')
    g = play(g, 1, 0, 'melee')
    const towerIid = g.players[0].rows.melee[0].iid
    g = pass(g, 0)
    g = pass(g, 1)
    expect(g.round).toBe(2)
    expect(g.players[0].rows.melee).toHaveLength(0)
    expect(g.players[0].graveyard.some((c) => c.iid === towerIid)).toBe(true)
  })
})

describe('row positioning helpers', () => {
  it('neighborsOf returns adjacent units only', () => {
    // The spare champion keeps the hand non-empty so the round doesn't end.
    let g = gameWith(['militia', 'pikeman', 'shieldbearer', 'champion'], ['militia'], 0)
    g = play(g, 0, 0, 'melee')
    g = pass(g, 1)
    g = play(g, 0, 0, 'melee')
    g = play(g, 0, 0, 'melee')
    const row = g.players[0].rows.melee // [militia, pikeman, shieldbearer]
    expect(neighborsOf(row, row[0].iid).map((u) => u.defId)).toEqual(['pikeman'])
    expect(neighborsOf(row, row[1].iid).map((u) => u.defId)).toEqual(['militia', 'shieldbearer'])
    expect(neighborsOf(row, -1)).toEqual([])
  })
})

describe('rounds and game end', () => {
  it('resolves a round when both players pass and starts the next with a mulligan', () => {
    let g = gameWith(['pikeman', 'militia'], ['militia', 'militia'])
    g = play(g, 0, 0, 'melee') // P1: 6
    g = play(g, 1, 0, 'melee') // P2: 4
    g = pass(g, 0)
    g = pass(g, 1)
    expect(g.round).toBe(2)
    expect(g.players[0].roundWins).toBe(1)
    expect(g.players[1].roundWins).toBe(0)
    // Board cleared into graveyards, passes reset, 3 cards drawn.
    expect(g.players[0].rows.melee).toHaveLength(0)
    expect(g.players[0].graveyard.some((c) => c.defId === 'pikeman')).toBe(true)
    expect(g.players[0].passed).toBe(false)
    // Round winner leads the next round and gets the leader's 3 mulligans.
    expect(g.phase).toBe('mulligan')
    expect(g.current).toBe(0)
    expect(g.players[0].mulligansLeft).toBe(MULLIGANS_LEADER)
    expect(g.players[1].mulligansLeft).toBe(MULLIGANS_FOLLOWER)
  })

  it('a drawn round gives both players a round win', () => {
    let g = gameWith(['militia', 'militia'], ['militia', 'militia'])
    g = play(g, 0, 0, 'melee')
    g = play(g, 1, 0, 'ranged')
    g = pass(g, 0)
    g = pass(g, 1)
    expect(g.players[0].roundWins).toBe(1)
    expect(g.players[1].roundWins).toBe(1)
  })

  it('after a drawn round, the player who went second leads the next', () => {
    // Player 0 leads round 1; the round ties 4–4.
    let g = gameWith(['militia', 'militia'], ['militia', 'militia'], 0)
    g = play(g, 0, 0, 'melee')
    g = play(g, 1, 0, 'ranged')
    g = pass(g, 0)
    g = pass(g, 1)
    expect(g.round).toBe(2)
    expect(g.leader).toBe(1)
    expect(g.current).toBe(1) // player 1 mulligans (and later acts) first
  })

  it('the round winner leads the next round', () => {
    // Player 1 leads round 1 but loses it 4–6.
    let g = gameWith(['pikeman', 'militia'], ['militia', 'militia'], 1)
    g = play(g, 1, 0, 'melee')
    g = play(g, 0, 0, 'melee')
    g = pass(g, 1)
    g = pass(g, 0)
    expect(g.round).toBe(2)
    expect(g.leader).toBe(0)
    expect(g.current).toBe(0)
  })

  it('first to two round wins takes the game', () => {
    let g = gameWith(['pikeman', 'pikeman', 'militia'], ['militia', 'militia', 'militia'])
    // Round 1: P1 wins 6-4.
    g = play(g, 0, 0, 'melee')
    g = play(g, 1, 0, 'melee')
    g = pass(g, 0)
    g = pass(g, 1)
    // Round 2: mulligans, then P1 wins again.
    g = skipMulligans(g)
    g = play(g, 0, 0, 'melee')
    g = play(g, 1, 0, 'melee')
    g = pass(g, 0)
    g = pass(g, 1)
    expect(g.winner).toBe(0)
    expect(() => play(g, 0, 0, 'melee')).toThrow('game is over')
  })

  it('a passed opponent lets the other player act repeatedly', () => {
    let g = gameWith(['militia', 'militia', 'militia'], ['militia'])
    g = play(g, 0, 0, 'melee')
    g = pass(g, 1)
    expect(g.current).toBe(0)
    g = play(g, 0, 0, 'melee')
    expect(g.current).toBe(0)
  })

  it('never draws above the hand limit', () => {
    let g = gameWith(
      ['militia', 'militia', 'militia', 'militia', 'militia', 'militia', 'militia', 'militia', 'militia', 'pikeman'],
      ['militia'],
    )
    // P1 plays one card (9 left), P2 passes, P1 wins the round, draws 3 → capped at 10.
    g = play(g, 0, 9, 'melee') // play the pikeman: P1 leads 6-0
    g = pass(g, 1)
    g = pass(g, 0)
    expect(g.round).toBe(2)
    expect(g.players[0].hand.length).toBeLessThanOrEqual(HAND_LIMIT)
  })
})

describe('AI', () => {
  it('passes when opponent passed and it is ahead', () => {
    let g = gameWith(['pikeman', 'militia'], ['militia', 'militia'], 1)
    g = play(g, 1, 0, 'melee') // P2 plays 4
    g = play(g, 0, 0, 'melee') // P1 plays 6
    g = pass(g, 1)
    // Now P1 (me=0) is ahead 6-4 with opponent passed.
    expect(playerTotal(g.players[0])).toBeGreaterThan(playerTotal(g.players[1]))
    expect(chooseMove(g, 0)).toEqual({ kind: 'pass', player: 0 })
  })

  it('concedes an unwinnable round to save cards', () => {
    let g = gameWith(['champion', 'champion', 'militia'], ['militia', 'militia', 'militia'], 0)
    g = play(g, 0, 0, 'melee') // P1: 10
    g = play(g, 1, 0, 'melee') // P2: 4
    g = play(g, 0, 0, 'melee') // P1: 20
    g = play(g, 1, 0, 'melee') // P2: 8
    g = pass(g, 0)
    // P2 is at 8 vs 20 with one militia (4) left: 12 < 20, so concede.
    expect(chooseMove(g, 1)).toEqual({ kind: 'pass', player: 1 })
  })

  it('makes legal mulligan moves and always reaches the play phase', () => {
    for (const seed of [3, 8, 21]) {
      let g = createGame(STARTER_DECK, STARTER_DECK, seed)
      let steps = 0
      while (g.phase === 'mulligan' && steps++ < 20) {
        const move = chooseMove(g, g.current)
        expect(['mulligan', 'endMulligan']).toContain(move.kind)
        g = applyMove(g, move)
      }
      expect(g.phase).toBe('play')
    }
  })

  it('plays full games to completion via chooseMove/applyMove', () => {
    for (const seed of [11, 99, 2024]) {
      let g = createGame(STARTER_DECK, STARTER_DECK, seed)
      for (let i = 0; i < 300 && g.winner === null; i++) {
        g = applyMove(g, chooseMove(g, g.current))
      }
      expect(g.winner).not.toBeNull()
    }
  })

  it('every scholar play in AI self-play draws exactly one card', () => {
    let scholarPlays = 0
    for (let seed = 1; seed <= 20; seed++) {
      let g = createGame(STARTER_DECK, STARTER_DECK, seed)
      for (let i = 0; i < 300 && g.winner === null; i++) {
        const me = g.current
        const move = chooseMove(g, me)
        if (move.kind === 'play') {
          const isScholar = g.players[me].hand.find((c) => c.iid === move.iid)?.defId === 'scholar'
          const handBefore = g.players[me].hand.length
          const deckBefore = g.players[me].deck.length
          const roundBefore = g.round
          g = applyMove(g, move)
          if (isScholar && g.round === roundBefore) {
            scholarPlays++
            expect(g.players[me].deck).toHaveLength(deckBefore - 1)
            expect(g.players[me].hand).toHaveLength(handBefore) // -1 played, +1 drawn
          }
        } else {
          g = applyMove(g, move)
        }
      }
    }
    expect(scholarPlays).toBeGreaterThan(0)
  })
})
