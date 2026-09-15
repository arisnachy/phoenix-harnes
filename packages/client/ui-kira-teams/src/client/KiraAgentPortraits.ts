/** Standalone public portrait assets for the 20 approved KIRA identities. */
export const KIRA_AGENT_PORTRAITS = {
  vortice: '/assets/kira-agents/portraits/vortice.svg',
  aurora: '/assets/kira-agents/portraits/aurora.svg',
  atlas: '/assets/kira-agents/portraits/atlas.svg',
  nova: '/assets/kira-agents/portraits/nova.svg',
  lumen: '/assets/kira-agents/portraits/lumen.svg',
  helix: '/assets/kira-agents/portraits/helix.svg',
  prisma: '/assets/kira-agents/portraits/prisma.svg',
  orion: '/assets/kira-agents/portraits/orion.svg',
  vega: '/assets/kira-agents/portraits/vega.svg',
  eclipse: '/assets/kira-agents/portraits/eclipse.svg',
  argo: '/assets/kira-agents/portraits/argo.svg',
  solaria: '/assets/kira-agents/portraits/solaria.svg',
  nexo: '/assets/kira-agents/portraits/nexo.svg',
  astra: '/assets/kira-agents/portraits/astra.svg',
  lyra: '/assets/kira-agents/portraits/lyra.svg',
  zenith: '/assets/kira-agents/portraits/zenith.svg',
  cobalto: '/assets/kira-agents/portraits/cobalto.svg',
  quasar: '/assets/kira-agents/portraits/quasar.svg',
  senda: '/assets/kira-agents/portraits/senda.svg',
  orbita: '/assets/kira-agents/portraits/orbita.svg',
} as const

export type KiraPortraitKey = keyof typeof KIRA_AGENT_PORTRAITS
