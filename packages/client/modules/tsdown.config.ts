import { clientBundle } from '../tsdown.client.ts'

export default clientBundle(
  '@phoenix-ai/dsh-client-modules',
  ['lib/types/index.js', 'lib/types/invariant.js'],
)
