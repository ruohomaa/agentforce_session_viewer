import { useState, useRef, useEffect } from 'react'
import { ChevronDown, Building2, CheckCircle, AlertCircle, Loader2 } from 'lucide-react'

function StatusDot({ status }) {
  if (!status) return null
  const connected = status === 'Connected'
  return (
    <span className={`inline-block w-2 h-2 rounded-full mr-2 ${connected ? 'bg-green-400' : 'bg-red-400'}`} />
  )
}

export default function OrgSelector({ orgs, selectedOrg, onSelect, loading }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    function handle(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [])

  const displayName = selectedOrg
    ? (selectedOrg.alias || selectedOrg.username)
    : 'Select org'

  const connectedOrgs = orgs.filter(o => o.connectedStatus === 'Connected')
  const otherOrgs = orgs.filter(o => o.connectedStatus !== 'Connected')

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 border border-gray-700 transition-colors text-sm min-w-[200px]"
      >
        <Building2 size={14} className="text-sf-blue flex-shrink-0" />
        <span className="flex-1 text-left truncate font-medium">
          {loading ? 'Loading orgs…' : displayName}
        </span>
        {loading
          ? <Loader2 size={14} className="animate-spin text-gray-400" />
          : <ChevronDown size={14} className={`text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
        }
      </button>

      {open && (
        <div className="absolute top-full mt-1 left-0 z-50 w-80 card shadow-2xl overflow-hidden">
          <div className="p-2 border-b border-gray-800">
            <p className="text-xs text-gray-500 px-2 py-1">Connected orgs</p>
          </div>
          <div className="max-h-96 overflow-y-auto">
            {connectedOrgs.map(org => (
              <OrgItem
                key={org.username}
                org={org}
                selected={selectedOrg?.username === org.username}
                onSelect={() => { onSelect(org); setOpen(false) }}
              />
            ))}
            {otherOrgs.length > 0 && (
              <>
                <div className="p-2 border-t border-gray-800">
                  <p className="text-xs text-gray-500 px-2 py-1">Disconnected</p>
                </div>
                {otherOrgs.map(org => (
                  <OrgItem
                    key={org.username}
                    org={org}
                    selected={selectedOrg?.username === org.username}
                    onSelect={() => { onSelect(org); setOpen(false) }}
                  />
                ))}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function OrgItem({ org, selected, onSelect }) {
  const connected = org.connectedStatus === 'Connected'
  return (
    <button
      onClick={onSelect}
      className={`w-full text-left px-3 py-2.5 hover:bg-gray-800 transition-colors flex items-start gap-3 ${selected ? 'bg-gray-800/80' : ''}`}
    >
      <div className="mt-0.5 flex-shrink-0">
        {connected
          ? <CheckCircle size={14} className="text-green-400" />
          : <AlertCircle size={14} className="text-red-400" />
        }
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm truncate">{org.alias || org.username}</span>
          {org.isSandbox && <span className="badge badge-yellow text-xs">Sandbox</span>}
          {org.isScratch && <span className="badge badge-purple text-xs">Scratch</span>}
        </div>
        <p className="text-xs text-gray-400 truncate">{org.username}</p>
        {org.name && <p className="text-xs text-gray-500 truncate">{org.name}</p>}
      </div>
      {selected && <div className="w-1.5 h-1.5 rounded-full bg-sf-blue mt-2 flex-shrink-0" />}
    </button>
  )
}
