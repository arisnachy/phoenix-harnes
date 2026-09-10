/** UI-4 details-panel action added to every chat-node owner. */
import type { SelectionTarget } from './views.ts'

declare module './slots.ts' {
  interface ChatNodeOwnerProps {
    /** Select this step/call and open the existing right-side details panel. */
    openDetails: (target: SelectionTarget) => void
  }
}

export {}
