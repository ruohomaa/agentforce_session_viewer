const BASE = '/api'

export async function fetchOrgs() {
  const r = await fetch(`${BASE}/orgs`)
  if (!r.ok) throw new Error(await r.text())
  return r.json()
}

export async function fetchSessions(org, limit = 50) {
  const r = await fetch(`${BASE}/orgs/${encodeURIComponent(org)}/sessions?limit=${limit}`)
  if (!r.ok) throw new Error(await r.text())
  return r.json()
}

export async function fetchSessionFull(org, sessionId) {
  const r = await fetch(`${BASE}/orgs/${encodeURIComponent(org)}/sessions/${sessionId}/full`)
  if (!r.ok) throw new Error(await r.text())
  return r.json()
}

export async function fetchInteractionSteps(org, interactionId) {
  const r = await fetch(`${BASE}/orgs/${encodeURIComponent(org)}/interactions/${interactionId}/steps`)
  if (!r.ok) throw new Error(await r.text())
  return r.json()
}

export async function fetchInteractionMessages(org, interactionId) {
  const r = await fetch(`${BASE}/orgs/${encodeURIComponent(org)}/interactions/${interactionId}/messages`)
  if (!r.ok) throw new Error(await r.text())
  return r.json()
}

export async function runQuery(org, query) {
  const r = await fetch(`${BASE}/orgs/${encodeURIComponent(org)}/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  if (!r.ok) throw new Error(await r.text())
  return r.json()
}
