const STORAGE_KEY = 'motif-theme'

export type Theme = 'light' | 'dark' | 'system'

function getSystemTheme(): 'light' | 'dark' {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function applyTheme(resolved: 'light' | 'dark') {
  const root = document.documentElement
  root.classList.toggle('dark', resolved === 'dark')

  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) {
    meta.setAttribute('content', resolved === 'dark' ? '#2B2A27' : '#F5F0EB')
  }
}

export function getTheme(): Theme {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored === 'light' || stored === 'dark' || stored === 'system') return stored
  return 'system'
}

export function setTheme(theme: Theme) {
  localStorage.setItem(STORAGE_KEY, theme)
  const resolved = theme === 'system' ? getSystemTheme() : theme
  applyTheme(resolved)
}

export function initTheme() {
  const theme = getTheme()
  const resolved = theme === 'system' ? getSystemTheme() : theme
  applyTheme(resolved)

  // Listen for system preference changes
  const mq = window.matchMedia('(prefers-color-scheme: dark)')
  mq.addEventListener('change', () => {
    if (getTheme() === 'system') {
      applyTheme(getSystemTheme())
    }
  })
}
