import { useState, useEffect } from 'react'
import { format } from 'date-fns'
import {
  Loader2, User, Bot, ChevronDown, ChevronRight,
  Zap, MessageSquare, Clock, Hash, AlertTriangle,
  CheckCircle2, XCircle, Info, ExternalLink
} from 'lucide-react'
import { fetchSessionFull, fetchInteractionSteps, fetchInteractionMessages } from '../api'

function TokenCount({ input, output, total }) {
  const t = total || (input || 0) + (output || 0)
  if (!t) return null
  return (
    <span className="text-xs text-gray-500 flex items-center gap-1">
      <Hash size={10} />
      {t.toLocaleString()} tokens
      {input > 0 && output > 0 && <span className="text-gray-600">({input}↑ {output}↓)</span>}
    </span>
  )
}

function Duration({ ms }) {
  if (!ms) return null
  const s = ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`
  return (
    <span className="text-xs text-gray-500 flex items-center gap-1">
      <Clock size={10} />{s}
    </span>
  )
}

function StepBadge({ type }) {
  const colors = {
    LLMCall: 'badge-purple',
    Action: 'badge-blue',
    FunctionCall: 'badge-blue',
    Grounding: 'badge-yellow',
    Guardrail: 'badge-red',
    Planning: 'badge-green',
  }
  return <span className={`badge ${colors[type] || 'badge-gray'}`}>{type || 'Step'}</span>
}

function InteractionStep({ step }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border border-gray-800 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-gray-800/50 text-left"
      >
        {open ? <ChevronDown size={13} className="text-gray-400 flex-shrink-0" /> : <ChevronRight size={13} className="text-gray-400 flex-shrink-0" />}
        <StepBadge type={step.StepType} />
        <span className="flex-1 text-sm truncate text-gray-300">
          {step.ActionLabel || step.StepName || step.ActionApiName || step.ActionType || step.StepType}
        </span>
        <div className="flex items-center gap-3">
          <TokenCount input={step.InputTokenCount} output={step.OutputTokenCount} />
          <Duration ms={step.DurationMs} />
          {step.IsSuccess === true && <CheckCircle2 size={14} className="text-green-400" />}
          {step.IsSuccess === false && <XCircle size={14} className="text-red-400" />}
        </div>
      </button>
      {open && (
        <div className="border-t border-gray-800 bg-gray-950/50 px-4 py-3 space-y-2">
          {step.ErrorMessage && (
            <div className="flex items-start gap-2 text-red-400 text-xs bg-red-900/20 rounded-md p-2">
              <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />
              <pre className="whitespace-pre-wrap font-mono break-all">{step.ErrorMessage}</pre>
            </div>
          )}
          {step.Request && (
            <div>
              <p className="text-xs font-medium text-gray-500 mb-1">Request</p>
              <pre className="text-xs font-mono text-gray-300 bg-gray-900 rounded p-2 overflow-x-auto whitespace-pre-wrap break-all">{
                (() => { try { return JSON.stringify(JSON.parse(step.Request), null, 2) } catch { return step.Request } })()
              }</pre>
            </div>
          )}
          {step.Response && (
            <div>
              <p className="text-xs font-medium text-gray-500 mb-1">Response</p>
              <pre className="text-xs font-mono text-gray-300 bg-gray-900 rounded p-2 overflow-x-auto whitespace-pre-wrap break-all">{
                (() => { try { return JSON.stringify(JSON.parse(step.Response), null, 2) } catch { return step.Response } })()
              }</pre>
            </div>
          )}
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-gray-500">
            {step.StartDateTime && <span>Start: {format(new Date(step.StartDateTime), 'HH:mm:ss.SSS')}</span>}
            {step.EndDateTime && <span>End: {format(new Date(step.EndDateTime), 'HH:mm:ss.SSS')}</span>}
            {step.ActionApiName && <span>API: {step.ActionApiName}</span>}
            {step.ActionType && <span>Type: {step.ActionType}</span>}
          </div>
        </div>
      )}
    </div>
  )
}

function MessageBubble({ msg }) {
  const isUser = msg.Role === 'User' || msg.MessageType === 'HumanMessage'
  const isAgent = msg.Role === 'Agent' || msg.MessageType === 'AIMessage'

  return (
    <div className={`flex gap-3 ${isUser ? 'justify-end' : 'justify-start'}`}>
      {!isUser && (
        <div className="w-7 h-7 rounded-full bg-sf-blue/20 border border-sf-blue/40 flex items-center justify-center flex-shrink-0 mt-0.5">
          <Bot size={13} className="text-sf-blue" />
        </div>
      )}
      <div className={`max-w-[75%] rounded-2xl px-4 py-2.5 text-sm ${
        isUser
          ? 'bg-sf-blue text-white rounded-tr-sm'
          : 'bg-gray-800 text-gray-100 rounded-tl-sm'
      }`}>
        <p className="whitespace-pre-wrap break-words leading-relaxed">{msg.Content}</p>
        <div className="flex items-center gap-2 mt-1.5">
          {msg.TokenCount > 0 && <span className="text-xs opacity-60">{msg.TokenCount} tokens</span>}
          {msg.CreatedDate && (
            <span className="text-xs opacity-50">{format(new Date(msg.CreatedDate), 'HH:mm:ss')}</span>
          )}
        </div>
      </div>
      {isUser && (
        <div className="w-7 h-7 rounded-full bg-gray-700 flex items-center justify-center flex-shrink-0 mt-0.5">
          <User size={13} className="text-gray-300" />
        </div>
      )}
    </div>
  )
}

function InteractionPanel({ interaction, org }) {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState('messages')
  const [steps, setSteps] = useState(null)
  const [messages, setMessages] = useState(null)
  const [loadingSteps, setLoadingSteps] = useState(false)
  const [loadingMessages, setLoadingMessages] = useState(false)

  async function loadSteps() {
    if (steps !== null) return
    setLoadingSteps(true)
    try {
      const r = await fetchInteractionSteps(org, interaction.Id)
      setSteps(r.records || [])
    } catch { setSteps([]) }
    setLoadingSteps(false)
  }

  async function loadMessages() {
    if (messages !== null) return
    setLoadingMessages(true)
    try {
      const r = await fetchInteractionMessages(org, interaction.Id)
      setMessages(r.records || [])
    } catch { setMessages([]) }
    setLoadingMessages(false)
  }

  async function handleOpen() {
    const next = !open
    setOpen(next)
    if (next) {
      loadMessages()
      loadSteps()
    }
  }

  return (
    <div className="card overflow-hidden">
      <button
        onClick={handleOpen}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-800/40 text-left"
      >
        {open ? <ChevronDown size={14} className="text-gray-400" /> : <ChevronRight size={14} className="text-gray-400" />}
        <Zap size={14} className="text-sf-orange flex-shrink-0" />
        <span className="flex-1 text-sm font-medium text-gray-200">
          {interaction.InteractionType || 'Interaction'}
        </span>
        <div className="flex items-center gap-3">
          <TokenCount input={interaction.InputTokenCount} output={interaction.OutputTokenCount} total={interaction.TotalTokenCount} />
          <Duration ms={interaction.DurationMs} />
          {interaction.IsSuccess === true && <CheckCircle2 size={14} className="text-green-400" />}
          {interaction.IsSuccess === false && <XCircle size={14} className="text-red-400" />}
          <span className="text-xs text-gray-500">{format(new Date(interaction.CreatedDate), 'HH:mm:ss')}</span>
        </div>
      </button>

      {open && (
        <div className="border-t border-gray-800">
          <div className="flex border-b border-gray-800">
            {['messages', 'steps'].map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-4 py-2 text-xs font-medium capitalize transition-colors ${
                  tab === t ? 'text-sf-blue border-b-2 border-sf-blue' : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                {t}
              </button>
            ))}
          </div>

          {tab === 'messages' && (
            <div className="p-4 space-y-3 max-h-96 overflow-y-auto">
              {loadingMessages && <Loader2 size={16} className="animate-spin text-sf-blue mx-auto" />}
              {messages && messages.length === 0 && <p className="text-xs text-gray-500 text-center">No messages</p>}
              {messages && messages.map(m => <MessageBubble key={m.Id} msg={m} />)}
            </div>
          )}

          {tab === 'steps' && (
            <div className="p-4 space-y-2 max-h-96 overflow-y-auto">
              {loadingSteps && <Loader2 size={16} className="animate-spin text-sf-blue mx-auto" />}
              {steps && steps.length === 0 && <p className="text-xs text-gray-500 text-center">No steps</p>}
              {steps && steps.map(s => <InteractionStep key={s.Id} step={s} />)}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function SessionDetail({ session, org }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [tab, setTab] = useState('timeline')

  useEffect(() => {
    if (!session || !org) return
    setData(null)
    setError(null)
    setLoading(true)
    fetchSessionFull(org, session.Id)
      .then(d => { setData(d); setLoading(false) })
      .catch(e => { setError(e.message); setLoading(false) })
  }, [session?.Id, org])

  if (!session) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-gray-600">
        <MessageSquare size={32} className="mb-3 opacity-30" />
        <p className="text-sm">Select a session to view details</p>
      </div>
    )
  }

  const start = session.StartDateTime || session.CreatedDate
  const end = session.EndDateTime

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-gray-800 flex-shrink-0">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="font-mono text-xs text-gray-400 truncate">{session.Id}</span>
              <a
                href={`${org?.instanceUrl}/${session.Id}`}
                target="_blank"
                rel="noreferrer"
                className="text-gray-500 hover:text-sf-blue"
                title="Open in Salesforce"
              >
                <ExternalLink size={12} />
              </a>
            </div>
            <div className="flex flex-wrap gap-2 items-center">
              {session.Status && (
                <span className={`badge ${
                  session.Status === 'Completed' || session.Status === 'Ended' ? 'badge-green' :
                  session.Status === 'Active' || session.Status === 'InProgress' ? 'badge-blue' :
                  session.Status === 'Error' ? 'badge-red' : 'badge-gray'
                }`}>{session.Status}</span>
              )}
              {session.ChannelType && <span className="badge badge-gray">{session.ChannelType}</span>}
              {session.SessionType && <span className="badge badge-gray">{session.SessionType}</span>}
              {session.AgentDefinitionApiName && (
                <span className="text-xs text-sf-teal font-medium">{session.AgentDefinitionApiName}</span>
              )}
            </div>
          </div>
          <div className="text-right text-xs text-gray-500 flex-shrink-0">
            {start && <p>{format(new Date(start), 'MMM d, yyyy HH:mm:ss')}</p>}
            {end && <p className="mt-0.5">→ {format(new Date(end), 'HH:mm:ss')}</p>}
            {start && end && (
              <p className="text-gray-600 mt-0.5">
                {Math.round((new Date(end) - new Date(start)) / 1000)}s total
              </p>
            )}
          </div>
        </div>

        {session.EndedReason && (
          <div className="mt-2 flex items-center gap-1.5 text-xs text-gray-500">
            <Info size={11} />
            <span>Ended: {session.EndedReason}</span>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-800 flex-shrink-0">
        {['timeline', 'participants', 'raw'].map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2.5 text-xs font-medium capitalize transition-colors ${
              tab === t ? 'text-sf-blue border-b-2 border-sf-blue' : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            {t}
            {t === 'timeline' && data && ` (${data.interactions?.length || 0})`}
            {t === 'participants' && data && ` (${data.participants?.length || 0})`}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="flex items-center justify-center h-40">
            <Loader2 size={20} className="animate-spin text-sf-blue" />
          </div>
        )}
        {error && (
          <div className="m-4 p-3 bg-red-900/20 border border-red-800 rounded-lg text-red-400 text-sm">
            <AlertTriangle size={14} className="inline mr-2" />{error}
          </div>
        )}

        {!loading && !error && data && (
          <>
            {tab === 'timeline' && (
              <div className="p-4 space-y-3">
                {data.interactions.length === 0 && (
                  <p className="text-sm text-gray-500 text-center py-8">No interactions recorded</p>
                )}
                {data.interactions.map(interaction => (
                  <InteractionPanel key={interaction.Id} interaction={interaction} org={org} />
                ))}
              </div>
            )}

            {tab === 'participants' && (
              <div className="p-4 space-y-2">
                {data.participants.length === 0 && (
                  <p className="text-sm text-gray-500 text-center py-8">No participants recorded</p>
                )}
                {data.participants.map(p => (
                  <div key={p.Id} className="card px-4 py-3 flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-gray-800 flex items-center justify-center">
                      {p.ParticipantType === 'Agent' ? <Bot size={14} className="text-sf-blue" /> : <User size={14} className="text-gray-300" />}
                    </div>
                    <div>
                      <p className="text-sm font-medium">{p.ParticipantType || 'Participant'}</p>
                      <p className="text-xs text-gray-500">{p.Role || ''} {p.ParticipantId ? `· ${p.ParticipantId}` : ''}</p>
                    </div>
                    <span className="ml-auto text-xs text-gray-600">{p.CreatedDate ? format(new Date(p.CreatedDate), 'HH:mm:ss') : ''}</span>
                  </div>
                ))}
              </div>
            )}

            {tab === 'raw' && (
              <div className="p-4">
                <pre className="text-xs font-mono text-gray-300 bg-gray-950 rounded-lg p-4 overflow-auto whitespace-pre-wrap break-all">
                  {JSON.stringify({ session, ...data }, null, 2)}
                </pre>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
