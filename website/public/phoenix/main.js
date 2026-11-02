const demoStates = Object.freeze({
  configurar: Object.freeze({ label: 'Configurando tu espacio', metric: 'Proveedor listo', detail: 'Elige modelo, credencial y políticas desde un solo lugar.' }),
  conversar: Object.freeze({ label: 'Sesión activa', metric: 'Contexto en curso', detail: 'PHOENIX coordina agente, herramientas y contexto sin perder el hilo.' }),
  conservar: Object.freeze({ label: 'Continuidad guardada', metric: 'Historial local', detail: 'La sesión queda disponible para revisar, reanudar y auditar.' }),
})

const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
const demoOutput = document.querySelector('#demo-output')
const demoLabel = document.querySelector('[data-demo-label]')
const demoMetric = document.querySelector('[data-demo-metric]')
const demoDetail = document.querySelector('[data-demo-detail]')
const demoStatusDot = document.querySelector('.demo-status-dot')
const demoButtons = [...document.querySelectorAll('[data-demo-state]')]
const menuLabel = document.querySelector('#mobile-menu-toggle .sr-only')

function setDemoState(stateName) {
  const state = demoStates[stateName]
  if (!state || !demoLabel || !demoMetric || !demoDetail || !demoOutput) return
  demoLabel.textContent = state.label
  demoMetric.textContent = state.metric
  demoDetail.textContent = state.detail
  demoOutput.dataset.activeState = stateName
  demoButtons.forEach((button) => {
    button.classList.toggle('is-active', button.dataset.demoState === stateName)
    button.setAttribute('aria-pressed', String(button.dataset.demoState === stateName))
    button.setAttribute('aria-selected', String(button.dataset.demoState === stateName))
  })
  if (demoStatusDot) demoStatusDot.style.background = stateName === 'conservar' ? '#8cc6af' : stateName === 'conversar' ? '#f2c477' : '#8cc6af'
}

demoButtons.forEach((button) => button.addEventListener('click', () => setDemoState(button.dataset.demoState)))
document.querySelectorAll('[data-demo-link]').forEach((link) => link.addEventListener('click', () => setDemoState(link.dataset.demoLink)))

const menuToggle = document.querySelector('#mobile-menu-toggle')
const mobileMenu = document.querySelector('#mobile-menu')
function closeMobileMenu() {
  if (!menuToggle || !mobileMenu) return
  menuToggle.setAttribute('aria-expanded', 'false')
  if (menuLabel) menuLabel.textContent = 'Abrir menú'
  mobileMenu.classList.remove('is-open')
}
menuToggle?.addEventListener('click', () => {
  const isOpen = menuToggle.getAttribute('aria-expanded') === 'true'
  const nextOpen = !isOpen
  menuToggle.setAttribute('aria-expanded', String(nextOpen))
  if (menuLabel) menuLabel.textContent = nextOpen ? 'Cerrar menú' : 'Abrir menú'
  mobileMenu?.classList.toggle('is-open', nextOpen)
})
mobileMenu?.querySelectorAll('a').forEach((link) => link.addEventListener('click', closeMobileMenu))
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeMobileMenu() })

const copyButton = document.querySelector('#copy-command')
const command = document.querySelector('#install-command')
const copyLabel = copyButton?.querySelector('.copy-label')
let copyResetTimer
copyButton?.addEventListener('click', async () => {
  if (!command) return
  const originalLabel = 'Copiar'
  try {
    await navigator.clipboard.writeText(command.textContent.trim())
    if (copyLabel) copyLabel.textContent = 'Copiado'
  } catch {
    if (copyLabel) copyLabel.textContent = 'Selecciona el comando'
  }
  window.clearTimeout(copyResetTimer)
  copyResetTimer = window.setTimeout(() => { if (copyLabel) copyLabel.textContent = originalLabel }, 1600)
})

if (prefersReducedMotion || !('IntersectionObserver' in window)) {
  document.querySelectorAll('.reveal').forEach((element) => element.classList.add('is-visible'))
} else {
  const observer = new IntersectionObserver((entries, currentObserver) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return
      entry.target.classList.add('is-visible')
      currentObserver.unobserve(entry.target)
    })
  }, { threshold: 0.12 })
  document.querySelectorAll('.reveal').forEach((element) => observer.observe(element))
}

document.querySelectorAll('[data-year]').forEach((element) => { element.textContent = String(new Date().getFullYear()) })
