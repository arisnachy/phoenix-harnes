/** Rank equivalent local inference measurements without claiming unobserved acceleration. */
export function selectAccelerator(rows) {
  const valid = rows.filter(row =>
    Number.isFinite(row.promptTokensPerSecond) && row.promptTokensPerSecond > 0 &&
    Number.isFinite(row.generationTokensPerSecond) && row.generationTokensPerSecond > 0 &&
    (row.backend === 'cpu' || row.offloadConfirmed === true))
  const cost = row => 256 / row.promptTokensPerSecond + 64 / row.generationTokensPerSecond
  const baseline = valid.filter(row => row.backend === 'cpu').sort((a, b) => cost(a) - cost(b))[0]
  if (!baseline) return { state: 'no-cpu-baseline', selected: null }
  const ranked = valid.map(row => ({ ...row, estimatedSeconds: cost(row),
    speedup: cost(baseline) / cost(row) })).sort((a, b) => a.estimatedSeconds - b.estimatedSeconds)
  const winner = ranked.find(row => row.backend !== 'cpu' && row.speedup >= 1.10)
  return { state: 'measured', selected: winner ?? ranked.find(row => row.backend === 'cpu'), ranked }
}

/** Extract actual positive layer offload evidence from verbose llama.cpp diagnostics. */
export function confirmedOffload(log) {
  return [...log.matchAll(/offloaded\s+(\d+)\s*\/\s*\d+\s+layers\s+to\s+GPU/gi)]
    .some(match => Number(match[1]) > 0)
}
