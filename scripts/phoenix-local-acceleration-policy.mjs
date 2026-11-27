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

/** Parse the pinned llama.cpp --list-devices format; reject unknown memory. */
export function parseDeviceMemory(output) {
  return [...output.matchAll(/^\s*([\w.-]+):\s+[^\r\n]*?\((\d+) MiB, (\d+) MiB free\)\s*$/gm)]
    .map(match => ({ name: match[1], totalMiB: Number(match[2]), freeMiB: Number(match[3]) }))
    .filter(device => device.totalMiB > 0 && device.freeMiB >= 0 && device.freeMiB <= device.totalMiB)
}

/** Conservative candidate admission, not a prediction of exact model allocations. */
export function candidateGpuLayers(freeMiB, modelBytes) {
  if (!Number.isFinite(freeMiB) || !Number.isFinite(modelBytes) || modelBytes <= 0) return []
  const weightMiB = Math.ceil(modelBytes / 1024 ** 2)
  const layers = []
  if (freeMiB >= Math.max(2048, Math.ceil(weightMiB / 2) + 1024)) layers.push(8)
  if (freeMiB >= Math.max(3072, Math.ceil(weightMiB * 0.75) + 1024)) layers.push(16)
  if (freeMiB >= weightMiB + 2048) layers.push(99)
  return layers
}
