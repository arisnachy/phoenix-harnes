import { KIRA_PORTRAIT_GROUP_1 } from './KiraPortraitGroup1.ts'
import { KIRA_PORTRAIT_GROUP_2 } from './KiraPortraitGroup2.ts'
import { KIRA_PORTRAIT_GROUP_3 } from './KiraPortraitGroup3.ts'
import { KIRA_PORTRAIT_GROUP_4 } from './KiraPortraitGroup4.ts'

/** Bundled standalone portraits for the 20 approved KIRA identities. */
export const KIRA_AGENT_PORTRAITS = {
  ...KIRA_PORTRAIT_GROUP_1,
  ...KIRA_PORTRAIT_GROUP_2,
  ...KIRA_PORTRAIT_GROUP_3,
  ...KIRA_PORTRAIT_GROUP_4,
} as const

export type KiraPortraitKey = keyof typeof KIRA_AGENT_PORTRAITS
