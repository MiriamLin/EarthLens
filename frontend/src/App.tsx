import { useCallback, useEffect, useState } from 'react'
import { usePersistentState } from './lib/persist'
import Guide, { GuideButton, hasSeenGuide, markGuideSeen, type GuideId } from './components/Guide'
import type { AnalysisTool } from './pages/Analysis'
import DataRegions from './pages/DataRegions'
import Analysis from './pages/Analysis'
import ErrorBoundary from './components/ErrorBoundary'

const tabs = ['Data', 'Analysis'] as const

export default function App() {
  const [activeTab, setActiveTab] = usePersistentState<(typeof tabs)[number]>('earthlens.page', 'Data', (value) => tabs.includes(value as (typeof tabs)[number]))
  const [tool, setTool] = useState<AnalysisTool>('Time Series')
  const [guide, setGuide] = useState<GuideId | null>(null)
  const current: GuideId = activeTab === 'Data' ? 'data' : tool === 'Compare' ? 'compare' : tool === 'Sound' ? 'sound' : 'timeSeries'
  const handleTool = useCallback((next: AnalysisTool) => setTool(next), [])

  useEffect(() => {
    setGuide(null)
    if (hasSeenGuide(current)) return
    const timer = setTimeout(() => setGuide(current), 600)
    return () => clearTimeout(timer)
  }, [current])

  function closeGuide() {
    if (guide) markGuideSeen(guide)
    setGuide(null)
  }

  return (
    <main className="flex h-dvh w-full flex-col overflow-hidden bg-surface">
      <header className="flex h-16 shrink-0 items-stretch border-b border-line bg-white">
        <a href="/" aria-label="EarthLens home" className="flex shrink-0 items-center gap-2.5 border-r border-line px-6 text-navy">
          <svg aria-hidden="true" viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="9.5" />
            <path d="M2.5 12h19" />
            <path d="M12 2.5c2.6 2.6 3.9 5.8 3.9 9.5s-1.3 6.9-3.9 9.5c-2.6-2.6-3.9-5.8-3.9-9.5s1.3-6.9 3.9-9.5z" />
            <path d="M4 7h16M4 17h16" opacity=".55" />
          </svg>
          <span className="text-lg font-semibold tracking-tight">EarthLens</span>
        </a>
        <nav aria-label="Pages" className="grid flex-1 grid-cols-2">
          {tabs.map((tab) => (
            <button
              key={tab}
              type="button"
              aria-pressed={activeTab === tab}
              onClick={() => setActiveTab(tab)}
              className={`-mb-px cursor-pointer border-b-[3px] text-[15px] font-semibold transition-colors ${activeTab === tab ? 'border-navy bg-navy-soft/50 text-navy' : 'border-transparent text-muted hover:bg-surface hover:text-ink'}`}
            >
              {tab}
            </button>
          ))}
        </nav>
      </header>
      <div className={activeTab === 'Data' ? 'flex min-h-0 min-w-0 flex-1 flex-col' : 'hidden'}>
        <ErrorBoundary label="Data">
          <DataRegions />
        </ErrorBoundary>
      </div>
      <div className={activeTab === 'Analysis' ? 'flex min-h-0 min-w-0 flex-1 flex-col' : 'hidden'}>
        <ErrorBoundary label="Analysis">
          <Analysis active={activeTab === 'Analysis'} onToolChange={handleTool} />
        </ErrorBoundary>
      </div>
      <GuideButton onClick={() => setGuide(current)} />
      {guide && <Guide key={guide} id={guide} onClose={closeGuide} />}
    </main>
  )
}
