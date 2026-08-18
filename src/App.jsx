import { useState, useEffect, useCallback } from 'react'
import { Bot, LayoutList, Terminal, RefreshCw, AlertCircle } from 'lucide-react'
import OrgSelector from './components/OrgSelector'
import SessionList from './components/SessionList'
import SessionDetail from './components/SessionDetail'
import QueryPane from './components/QueryPane'
import { fetchOrgs, fetchSessions } from './api'

const TABS = [
  { id: 'sessions', label: 'Sessions', icon: LayoutList },
  { id: 'query', label: 'Query', icon: Terminal },
]

export default function App() {
  const [orgs, setOrgs] = useState([])
  const [selectedOrg, setSelectedOrg] = useState(null)
  const [orgsLoading, setOrgsLoading] = useState(true)
  const [orgsError, setOrgsError] = useState(null)

  const [tab, setTab] = useState('sessions')
  const [sessions, setSessions] = useState(null)
  const [sessionsLoading, setSessionsLoading] = useState(false)
  const [sessionsError, setSessionsError] = useState(null)
  const [selectedSession, setSelectedSession] = useState(null)

  // Load orgs on mount
  useEffect(() => {
    setOrgsLoading(true)
    fetchOrgs()
      .then(({ orgs }) => {
        setOrgs(orgs)
        // Auto-select first connected org
        const first = orgs.find(o => o.connectedStatus === 'Connected')
        if (first) setSelectedOrg(first)
        setOrgsLoading(false)
      })
      .catch(e => {
        setOrgsError(e.message)
        setOrgsLoading(false)
      })
  }, [])

  // Load sessions when org changes
  const loadSessions = useCallback(async () => {
    if (!selectedOrg) return
    const orgKey = selectedOrg.alias || selectedOrg.username
    setSessionsLoading(true)
    setSessionsError(null)
    setSelectedSession(null)
    try {
      const data = await fetchSessions(orgKey)
      setSessions(data.records || [])
    } catch (e) {
      setSessionsError(e.message)
      setSessions([])
    }
    setSessionsLoading(false)
  }, [selectedOrg])

  useEffect(() => {
    if (selectedOrg && tab === 'sessions') {
      loadSessions()
    }
  }, [selectedOrg, tab])

  const orgKey = selectedOrg ? (selectedOrg.alias || selectedOrg.username) : null

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      {/* Top bar */}
      <header className="flex items-center gap-4 px-4 py-2.5 border-b border-gray-800 bg-gray-900 flex-shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-sf-blue/20 border border-sf-blue/40 flex items-center justify-center">
            <Bot size={15} className="text-sf-blue" />
          </div>
          <span className="font-semibold text-sm tracking-tight">Agentforce Session Viewer</span>
        </div>

        <div className="flex items-center gap-1 ml-4">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors ${
                tab === t.id ? 'bg-gray-800 text-white' : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800/50'
              }`}
            >
              <t.icon size={13} />
              {t.label}
            </button>
          ))}
        </div>

        <div className="ml-auto">
          <OrgSelector
            orgs={orgs}
            selectedOrg={selectedOrg}
            onSelect={org => { setSelectedOrg(org); setSessions(null) }}
            loading={orgsLoading}
          />
        </div>
      </header>

      {/* Error banners */}
      {orgsError && (
        <div className="flex items-center gap-2 px-4 py-2 bg-red-900/30 border-b border-red-800 text-red-400 text-xs">
          <AlertCircle size={13} />
          Failed to load orgs: {orgsError}
        </div>
      )}

      {/* Main content */}
      {!selectedOrg && !orgsLoading ? (
        <div className="flex-1 flex items-center justify-center text-gray-600">
          <div className="text-center">
            <Bot size={40} className="mx-auto mb-3 opacity-30" />
            <p className="text-sm">Select an org to get started</p>
          </div>
        </div>
      ) : tab === 'sessions' ? (
        <div className="flex-1 flex overflow-hidden">
          {/* Session list sidebar */}
          <div className="w-72 border-r border-gray-800 flex-shrink-0 flex flex-col overflow-hidden">
            {sessionsError && (
              <div className="m-3 p-2.5 bg-red-900/20 border border-red-800 rounded-lg text-red-400 text-xs">
                <AlertCircle size={12} className="inline mr-1.5" />{sessionsError}
              </div>
            )}
            <SessionList
              sessions={sessions}
              selectedId={selectedSession?.Id}
              onSelect={setSelectedSession}
              loading={sessionsLoading}
              onRefresh={loadSessions}
            />
          </div>
          {/* Session detail */}
          <div className="flex-1 overflow-hidden">
            <SessionDetail session={selectedSession} org={selectedOrg} orgAlias={orgKey} />
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-hidden">
          <QueryPane org={orgKey} />
        </div>
      )}
    </div>
  )
}
