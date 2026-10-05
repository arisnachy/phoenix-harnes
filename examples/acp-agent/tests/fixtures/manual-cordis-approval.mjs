/** Preserve the advanced replay corpus's explicit manual Cordis approval lifecycle. */
export const name = 'snapshot-manual-cordis-approval'
export const inject = ['dynamicCordisRunner']

/** Keep real definition and activation paths while selecting manual approval for this fixture. */
export function apply(ctx) {
  const runner = ctx.dynamicCordisRunner
  ctx.effect(() => {
    const define = runner.define
    runner.define = request => define.call(runner, { ...request, autoApprove: false })
    return () => { runner.define = define }
  })
}
