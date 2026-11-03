import { browserBatchExpression, browserInteractionExpression } from '../src/browser-interactions.ts'

console.log(JSON.stringify({
  inspect: browserInteractionExpression({ operation: 'inspect' }),
  fill: browserInteractionExpression({ operation: 'fill', name: 'message', value: 'Phoenix' }),
  wait: browserInteractionExpression({ operation: 'wait', expectedText: 'Received!' }),
  batch: browserBatchExpression([
    { operation: 'fill', name: 'message', value: 'Batch Phoenix' },
    { operation: 'wait', expectedText: 'Received!' },
  ]),
}))
