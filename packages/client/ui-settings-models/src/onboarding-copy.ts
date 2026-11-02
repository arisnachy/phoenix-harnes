/** Durable settings namespace for product-wide GUI onboarding facts. */
export const WELCOME_NOTICE_SETTINGS_NAMESPACE = 'ui-onboarding'

/** Field storing the last welcome notice version the user acknowledged. */
export const WELCOME_NOTICE_ACK_FIELD = 'welcomeNoticeVersion'

/**
 * Bump only when the notice changes materially and every user should see it
 * again. The acknowledgement is compared for exact equality.
 */
export const WELCOME_NOTICE_VERSION = '2026-08-13.1'

/** The complete editable internal-testing notice in both supported GUI locales. */
export const WELCOME_NOTICE_COPY = {
  zh: {
    title: '内测声明',
    body: 'PHOENIX 目前仍处在面向 Harness 开发者进行测试的阶段，还有许多地方需要持续改进和打磨，希望听取广大开发者的反馈建议。PHOENIX 的核心插件以及基础 API 会继续快速迭代、持续演化。\n\n我们期待与全球开发者一起，在开源、开放、可复用、可组合的基础设施之上，共同探索智能上限。欢迎全球 Harness 开发者加入 PHOENIX 插件生态。',
    continueLabel: '继续',
  },
  en: {
    title: 'Internal Testing Notice',
    body: "PHOENIX remains in testing for Harness developers. Many areas need further improvement, and we welcome feedback from the developer community. PHOENIX's core plugins and foundational APIs will continue to evolve rapidly.\n\nWe look forward to exploring the limits of intelligence with developers around the world, building on open-source, open, reusable, and composable infrastructure. We welcome Harness developers everywhere to join the PHOENIX plugin ecosystem.",
    continueLabel: 'Continue',
  },
  es: {
    title: 'Aviso de pruebas internas',
    body: 'PHOENIX todavía está en fase de pruebas. Seguimos mejorando sus funciones y agradecemos los comentarios de la comunidad. Los complementos principales y las API fundamentales de PHOENIX continuarán evolucionando rápidamente.\n\nQueremos explorar los límites de la inteligencia junto a desarrolladores de todo el mundo sobre una infraestructura abierta, reutilizable y componible. Te invitamos a formar parte del ecosistema PHOENIX.',
    continueLabel: 'Continuar',
  },
} as const
