import { useState, type ReactNode } from 'react'
import { Sidebar } from './Sidebar'

const SIDEBAR_KEY = 'order_tracker_sidebar_min'

export function Layout({ children }: { children: ReactNode }) {
  const [minimizado, setMinimizado] = useState(() => localStorage.getItem(SIDEBAR_KEY) === '1')

  function toggle() {
    setMinimizado((m) => {
      localStorage.setItem(SIDEBAR_KEY, m ? '0' : '1')
      return !m
    })
  }

  return (
    <div className="flex min-h-screen bg-slate-50">
      <Sidebar minimizado={minimizado} onToggle={toggle} />
      <main className={`min-h-screen min-w-0 flex-1 transition-[margin] ${minimizado ? 'ml-16' : 'ml-60'}`}>{children}</main>
    </div>
  )
}
