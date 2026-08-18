import { useState } from 'react'
import { Play, Loader2, AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react'
import { runQuery } from '../api'

const EXAMPLE_QUERIES = [
  {
    label: 'All sessions (last 50)',
    query: `SELECT Id, Status, StartDateTime, EndDateTime, ChannelType, AgentDefinitionApiName, EndedReason
FROM AIAgentSession ORDER BY CreatedDate DESC LIMIT 50`
  },
  {
    label: 'All interactions',
    query: `SELECT Id, AIAgentSessionId, InteractionType, Status, TotalTokenCount, DurationMs, IsSuccess, CreatedDate
FROM AIAgentInteraction ORDER BY CreatedDate DESC LIMIT 50`
  },
  {
    label: 'All interaction steps',
    query: `SELECT Id, StepType, ActionLabel, ActionApiName, DurationMs, IsSuccess, ErrorMessage, CreatedDate
FROM AIAgentInteractionStep ORDER BY CreatedDate DESC LIMIT 50`
  },
  {
    label: 'All messages',
    query: `SELECT Id, Role, Content, TokenCount, MessageType, Sequence, CreatedDate
FROM AIAgentInteractionMessage ORDER BY CreatedDate DESC LIMIT 50`
  },
  {
    label: 'Failed interactions',
    query: `SELECT Id, AIAgentSessionId, InteractionType, Status, DurationMs, CreatedDate
FROM AIAgentInteraction WHERE IsSuccess = false ORDER BY CreatedDate DESC LIMIT 50`
  },
]

function ResultTable({ records }) {
  if (!records || records.length === 0) return <p className="text-xs text-gray-500 text-center py-4">No results</p>
  const keys = Object.keys(records[0]).filter(k => k !== 'attributes')
  return (
    <div className="overflow-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-gray-800">
            {keys.map(k => (
              <th key={k} className="text-left px-3 py-2 font-medium text-gray-400 whitespace-nowrap">{k}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {records.map((r, i) => (
            <tr key={i} className="border-b border-gray-800/50 hover:bg-gray-800/30">
              {keys.map(k => (
                <td key={k} className="px-3 py-2 text-gray-300 font-mono max-w-[240px] truncate" title={String(r[k] ?? '')}>
                  {r[k] === null || r[k] === undefined ? <span className="text-gray-600">null</span> : String(r[k])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function QueryPane({ org }) {
  const [query, setQuery] = useState(EXAMPLE_QUERIES[0].query)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [showExamples, setShowExamples] = useState(false)

  async function execute() {
    if (!query.trim() || !org) return
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const r = await runQuery(org, query.trim())
      setResult(r)
    } catch (e) {
      setError(e.message)
    }
    setLoading(false)
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
        <h2 className="text-sm font-semibold">SOQL Query</h2>
      </div>

      <div className="flex-1 flex flex-col overflow-hidden p-4 gap-3">
        {/* Examples */}
        <div>
          <button
            onClick={() => setShowExamples(v => !v)}
            className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-200 mb-2"
          >
            {showExamples ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            Example queries
          </button>
          {showExamples && (
            <div className="flex flex-wrap gap-2 mb-2">
              {EXAMPLE_QUERIES.map(eq => (
                <button
                  key={eq.label}
                  onClick={() => { setQuery(eq.query); setShowExamples(false) }}
                  className="text-xs px-2.5 py-1 rounded-md bg-gray-800 hover:bg-gray-700 text-gray-300 border border-gray-700"
                >
                  {eq.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Editor */}
        <div className="relative">
          <textarea
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') execute() }}
            className="w-full h-36 bg-gray-950 border border-gray-700 rounded-lg px-3 py-2.5 text-xs font-mono text-gray-200 resize-none focus:outline-none focus:border-sf-blue placeholder:text-gray-600"
            placeholder="SELECT Id FROM AIAgentSession LIMIT 10"
          />
          <button
            onClick={execute}
            disabled={loading || !org}
            className="absolute bottom-2.5 right-2.5 flex items-center gap-1.5 btn-primary text-xs py-1 px-2.5 disabled:opacity-40"
          >
            {loading ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
            Run <span className="opacity-60 text-xs">⌘↵</span>
          </button>
        </div>

        {/* Results */}
        {error && (
          <div className="flex items-start gap-2 text-red-400 text-xs bg-red-900/20 border border-red-800 rounded-lg p-3">
            <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />
            <pre className="whitespace-pre-wrap break-all">{error}</pre>
          </div>
        )}

        {result && (
          <div className="flex-1 overflow-auto card">
            <div className="flex items-center justify-between px-3 py-2 border-b border-gray-800">
              <span className="text-xs text-gray-400">{result.totalSize?.toLocaleString() ?? result.records?.length} rows</span>
            </div>
            <ResultTable records={result.records} />
          </div>
        )}
      </div>
    </div>
  )
}
