import { formatDistanceToNow, format } from 'date-fns'
import { MessageSquare, Clock, CheckCircle2, XCircle, AlertCircle, RefreshCw, Loader2 } from 'lucide-react'

function StatusBadge({ status }) {
  if (!status) return <span className="badge badge-gray">Unknown</span>
  const s = status.toLowerCase()
  if (s === 'active' || s === 'inprogress' || s === 'in_progress') return <span className="badge badge-blue">{status}</span>
  if (s === 'completed' || s === 'ended') return <span className="badge badge-green">{status}</span>
  if (s === 'error' || s === 'failed') return <span className="badge badge-red">{status}</span>
  return <span className="badge badge-gray">{status}</span>
}

function SessionRow({ session, selected, onClick }) {
  const start = session.StartDateTime || session.CreatedDate
  const elapsed = session.EndDateTime && session.StartDateTime
    ? Math.round((new Date(session.EndDateTime) - new Date(session.StartDateTime)) / 1000)
    : null

  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-4 py-3.5 border-b border-gray-800/60 hover:bg-gray-800/50 transition-colors
        ${selected ? 'bg-gray-800 border-l-2 border-l-sf-blue' : 'border-l-2 border-l-transparent'}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <MessageSquare size={13} className="text-sf-blue flex-shrink-0" />
            <span className="font-mono text-xs text-gray-400 truncate">{session.Id}</span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <StatusBadge status={session.Status} />
            {session.ChannelType && <span className="badge badge-gray">{session.ChannelType}</span>}
            {session.SessionType && <span className="badge badge-gray">{session.SessionType}</span>}
          </div>
        </div>
        <div className="text-right flex-shrink-0">
          <p className="text-xs text-gray-400">
            {start ? formatDistanceToNow(new Date(start), { addSuffix: true }) : '—'}
          </p>
          {elapsed !== null && (
            <p className="text-xs text-gray-500 mt-0.5 flex items-center justify-end gap-1">
              <Clock size={10} />
              {elapsed < 60 ? `${elapsed}s` : `${Math.round(elapsed / 60)}m`}
            </p>
          )}
        </div>
      </div>
      {session.AgentDefinitionApiName && (
        <p className="text-xs text-sf-teal mt-1.5 truncate">{session.AgentDefinitionApiName}</p>
      )}
      {session.EndedReason && (
        <p className="text-xs text-gray-500 mt-0.5">Ended: {session.EndedReason}</p>
      )}
    </button>
  )
}

export default function SessionList({ sessions, selectedId, onSelect, loading, onRefresh }) {
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
        <div>
          <h2 className="text-sm font-semibold">Sessions</h2>
          {!loading && sessions && (
            <p className="text-xs text-gray-500 mt-0.5">{sessions.length} records</p>
          )}
        </div>
        <button
          onClick={onRefresh}
          disabled={loading}
          className="btn-ghost p-1.5 rounded-md"
          title="Refresh"
        >
          {loading
            ? <Loader2 size={14} className="animate-spin text-gray-400" />
            : <RefreshCw size={14} className="text-gray-400" />
          }
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="flex items-center justify-center h-40">
            <Loader2 size={20} className="animate-spin text-sf-blue" />
          </div>
        )}
        {!loading && sessions && sessions.length === 0 && (
          <div className="flex flex-col items-center justify-center h-40 text-gray-500">
            <MessageSquare size={24} className="mb-2 opacity-40" />
            <p className="text-sm">No sessions found</p>
          </div>
        )}
        {!loading && sessions && sessions.map(s => (
          <SessionRow
            key={s.Id}
            session={s}
            selected={s.Id === selectedId}
            onClick={() => onSelect(s)}
          />
        ))}
      </div>
    </div>
  )
}
