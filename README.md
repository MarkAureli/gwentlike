# Gwentlike

A card game in the style of standalone Gwent (GWENT: The Witcher Card Game): two players, two rows (melee and ranged), best of three rounds, highest total power wins the round. Original cards and abilities — only the core mechanics follow Gwent.

**Play it:** https://markaureli.github.io/gwentlike/

## Play locally

```sh
npm install
npm run dev
```

You play against a simple greedy AI. Each round starts with a mulligan; after that, click a card, click one of your rows to place it, then pick a target if the card's deploy ability needs one. Pass to end your participation in the round.

## Rules (current)

- Both players draw 10 from a 25-card deck; 3 more at the start of rounds 2 and 3 (hand cap 10).
- Each round opens with a mulligan: swap up to 3 cards in round 1, 1 card in rounds 2 and 3. Swapped cards are shuffled back after replacements are drawn, so they can't come straight back.
- On your turn: play one card to your melee or ranged row, or pass. Passing locks you out for the rest of the round.
- When both players have passed, the higher total power wins the round; a tie gives both players a round win. First to 2 round wins takes the game.
- The round winner leads the next round.
- Deploy abilities resolve when a unit is played: single-target damage/boost, row damage/boost, and card draw.
- Cards have provision costs in their definitions for future deckbuilding; both players currently use the same starter deck.

## Architecture

- `src/engine/` — pure, framework-free rules engine. Fully covered by `game.test.ts`.
  - **One entry point:** a game is a seed plus a list of `Move`s; `applyMove(state, move)` handles play, pass, and mulligan. This is the seam for replays, search-based AI, and multiplayer.
  - **Typed events:** everything that happens is appended to `state.events` as structured `GameEvent`s. Log text is derived via `events.ts`; the UI can also drive animations from them.
  - **Card instance identity:** every physical card gets an `iid` at game creation and keeps it through deck → hand → board → graveyard, so cards can be referenced anywhere.
  - **Row positioning:** rows are ordered; the play move carries an optional insertion `position` (defaults to append), and `neighborsOf` exposes adjacency for future mechanics. The UI doesn't offer placement yet — when a mechanic needs it, only the UI changes.
- `src/App.tsx` — React UI on top of the engine.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the dev server |
| `npm test` | Run engine tests (Vitest) |
| `npm run build` | Type-check and build for production |

Pushes to `main` deploy to GitHub Pages automatically (tests must pass).

## Roadmap

- More ability types (orders, timers, shields, spies/card advantage, adjacency effects)
- Deckbuilding with provision limits and factions
- Placement UI for positional play
- Local hotseat mode, online multiplayer later
- Smarter AI (search-based instead of greedy)
