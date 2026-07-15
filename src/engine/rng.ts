/**
 * Deterministic PRNG (mulberry32) threaded through the game state as a plain
 * number, so identical seeds replay identical games.
 */
export function nextRandom(state: number): { value: number; state: number } {
  let t = (state + 0x6d2b79f5) | 0
  let x = t
  x = Math.imul(x ^ (x >>> 15), x | 1)
  x ^= x + Math.imul(x ^ (x >>> 7), x | 61)
  const value = ((x ^ (x >>> 14)) >>> 0) / 4294967296
  return { value, state: t }
}

export function shuffle<T>(items: T[], state: number): { items: T[]; state: number } {
  const out = items.slice()
  let s = state
  for (let i = out.length - 1; i > 0; i--) {
    const r = nextRandom(s)
    s = r.state
    const j = Math.floor(r.value * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return { items: out, state: s }
}
