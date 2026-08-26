// Disable TLS cert verification for corporate proxy environments
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'

import { execFile } from 'child_process'
import { promisify } from 'util'
import { fileURLToPath } from 'url'
import { join, dirname } from 'path'
import express from 'express'
import cors from 'cors'
import { getOrRefreshDataCloudToken, clearTokenCache } from './auth.js'
import { getOrgConfig, setOrgConfig, deleteOrgConfig, getAllConfigs } from './config.js'

const execFileAsync = promisify(execFile)
const app = express()
const PORT = 3001
const __dirname = dirname(fileURLToPath(import.meta.url))
const PUBLIC = join(__dirname, '..', 'public')

app.use(cors())
app.use(express.json())
app.use(express.static(PUBLIC))

// ── SF CLI helpers ────────────────────────────────────────────────────────────

async function runSf(...args) {
  const { stdout } = await execFileAsync('sf', args, { maxBuffer: 10 * 1024 * 1024 })
  return JSON.parse(stdout)
}

// ── Data Cloud query ──────────────────────────────────────────────────────────

async function dcQuery(orgAlias, sql) {
  const cfg = await getOrgConfig(orgAlias)
  if (!cfg) throw new Error('NO_CONFIG')

  const { accessToken, instanceUrl } = await getOrRefreshDataCloudToken(orgAlias, cfg)

  const res = await fetch(`${instanceUrl}/api/v1/query`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ sql }),
  })

  if (!res.ok) {
    // 401 → expire cache so next call re-auths
    if (res.status === 401) clearTokenCache(orgAlias)
    const body = await res.text()
    throw new Error(`Data Cloud API ${res.status}: ${body}`)
  }

  return res.json()
}

async function dcQueryAll(orgAlias, sql) {
  const cfg = await getOrgConfig(orgAlias)
  if (!cfg) throw new Error('NO_CONFIG')

  const { accessToken, instanceUrl } = await getOrRefreshDataCloudToken(orgAlias, cfg)

  async function fetchPage(url, body) {
    let res
    try {
      res = await fetch(url, {
        method: body ? 'POST' : 'GET',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      })
    } catch (fetchErr) {
      throw new Error(`Data Cloud fetch failed (${url}): ${fetchErr.cause?.message || fetchErr.message}`)
    }
    if (!res.ok) {
      if (res.status === 401) clearTokenCache(orgAlias)
      const t = await res.text(); throw new Error(`Data Cloud API ${res.status}: ${t}`)
    }
    return res.json()
  }

  let result = await fetchPage(`${instanceUrl}/api/v1/query`, { sql })
  let data = result.data || []

  while (!result.done && result.nextBatchId) {
    result = await fetchPage(`${instanceUrl}/api/v1/query/${result.nextBatchId}`)
    data = data.concat(result.data || [])
  }

  return { records: data, totalSize: result.rowCount ?? data.length, metadata: result.metadata }
}

function handleDcError(err, res) {
  if (err.message === 'NO_CONFIG') {
    return res.status(400).json({ error: 'NO_CONFIG', message: 'Data Cloud credentials not configured for this org.' })
  }
  res.status(500).json({ error: err.message, records: [] })
}

// ── Data Cloud provisioning probe ────────────────────────────────────────────

// Cache probe results for 5 minutes so the org list loads fast on repeat visits
const dcProbeCache = new Map() // username → { provisioned: bool, at: timestamp }
const DC_PROBE_TTL = 5 * 60 * 1000

async function probeDataCloudEnabled(username) {
  const cached = dcProbeCache.get(username)
  if (cached && Date.now() - cached.at < DC_PROBE_TTL) return cached.provisioned

  try {
    // CustomerDataPlatformSettings is a Tooling API metadata type present in every org.
    // IsCustomerDataPlatformEnabled is true only when Data Cloud is actually provisioned.
    const result = await runSf(
      'data', 'query',
      '--target-org', username,
      '--use-tooling-api',
      '--query', 'SELECT IsCustomerDataPlatformEnabled FROM CustomerDataPlatformSettings LIMIT 1',
      '--json'
    )
    const provisioned = result?.result?.records?.[0]?.IsCustomerDataPlatformEnabled === true
    dcProbeCache.set(username, { provisioned, at: Date.now() })
    return provisioned
  } catch {
    return false
  }
}

// ── Org routes ────────────────────────────────────────────────────────────────

app.get('/api/orgs', async (req, res) => {
  try {
    const [sfResult, configs] = await Promise.all([runSf('org', 'list', '--json'), getAllConfigs()])
    const other = sfResult.result?.other || []
    const sandboxes = sfResult.result?.sandboxes || []
    const raw = [...other, ...sandboxes]

    // Probe Data Cloud provisioning for all connected orgs in parallel
    const probeResults = await Promise.all(
      raw.map(o =>
        o.connectedStatus === 'Connected'
          ? probeDataCloudEnabled(o.username).catch(() => false)
          : Promise.resolve(false)
      )
    )

    const all = raw.map((o, i) => {
      const key = o.alias || o.username
      return {
        alias: o.alias || '',
        username: o.username,
        orgId: o.orgId,
        instanceUrl: o.instanceUrl,
        name: o.name || '',
        isSandbox: o.isSandbox || false,
        isScratch: o.isScratch || false,
        connectedStatus: o.connectedStatus,
        orgEdition: o.orgEdition || '',
        isDefault: o.isDefaultUsername || false,
        dataCloudEnabled: probeResults[i],
        hasDataCloudConfig: !!(configs[key] || configs[o.username]),
      }
    })
    res.json({ orgs: all })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── Connected App config routes ───────────────────────────────────────────────

app.get('/api/orgs/:org/config', async (req, res) => {
  const cfg = await getOrgConfig(req.params.org)
  if (!cfg) return res.json({ configured: false })
  // Return config but redact the private key
  res.json({
    configured: true,
    consumerKey: cfg.consumerKey,
    username: cfg.username,
    loginUrl: cfg.loginUrl,
    privateKeyType: cfg.privateKey?.startsWith('-----') ? 'inline' : 'file',
    privateKeyHint: cfg.privateKey?.startsWith('-----')
      ? '(PEM stored)'
      : cfg.privateKey,
  })
})

app.post('/api/orgs/:org/config', async (req, res) => {
  const { consumerKey, privateKey, loginUrl, username } = req.body
  if (!consumerKey || !privateKey || !loginUrl || !username) {
    return res.status(400).json({ error: 'consumerKey, privateKey, loginUrl, username are all required' })
  }
  await setOrgConfig(req.params.org, { consumerKey, privateKey, loginUrl, username })
  clearTokenCache(req.params.org)
  res.json({ ok: true })
})

app.delete('/api/orgs/:org/config', async (req, res) => {
  await deleteOrgConfig(req.params.org)
  clearTokenCache(req.params.org)
  res.json({ ok: true })
})

// Test auth — returns the DC instance URL on success
app.post('/api/orgs/:org/config/test', async (req, res) => {
  const cfg = await getOrgConfig(req.params.org)
  if (!cfg) return res.status(400).json({ error: 'No config saved yet' })
  try {
    clearTokenCache(req.params.org)
    const { instanceUrl } = await getOrRefreshDataCloudToken(req.params.org, cfg)
    res.json({ ok: true, instanceUrl })
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})

// ── Session routes ────────────────────────────────────────────────────────────

app.get('/api/orgs/:org/sessions', async (req, res) => {
  const { org } = req.params
  const limit = parseInt(req.query.limit) || 50
  try {
    const result = await dcQueryAll(org,
      `SELECT ssot__Id__c, ssot__StartTimestamp__c, ssot__EndTimestamp__c,
              ssot__AiAgentChannelType__c, ssot__AiAgentSessionEndType__c,
              ssot__SessionOwnerId__c, ssot__SessionOwnerObject__c,
              ssot__ExternalSourceId__c, ssot__VariableText__c, ssot__InternalOrganizationId__c,
              ssot__PreviousSessionId__c
       FROM ssot__AiAgentSession__dlm ORDER BY ssot__StartTimestamp__c DESC LIMIT ${limit}`
    )
    res.json(result)
  } catch (err) { handleDcError(err, res) }
})

app.get('/api/orgs/:org/sessions/:sessionId/full', async (req, res) => {
  const { org, sessionId } = req.params
  try {
    const [participants, interactions] = await Promise.all([
      dcQueryAll(org,
        `SELECT ssot__Id__c, ssot__AiAgentSessionId__c, ssot__StartTimestamp__c, ssot__EndTimestamp__c,
                ssot__AiAgentSessionParticipantRole__c, ssot__AiAgentType__c,
                ssot__AiAgentApiName__c, ssot__AiAgentTemplateApiName__c, ssot__AiAgentVersionApiName__c,
                ssot__ParticipantId__c, ssot__ParticipantObject__c
         FROM ssot__AiAgentSessionParticipant__dlm
         WHERE ssot__AiAgentSessionId__c = '${sessionId}' ORDER BY ssot__StartTimestamp__c ASC`
      ),
      dcQueryAll(org,
        `SELECT ssot__Id__c, ssot__AiAgentSessionId__c, ssot__StartTimestamp__c, ssot__EndTimestamp__c,
                ssot__AiAgentInteractionType__c, ssot__TopicApiName__c,
                ssot__TelemetryTraceId__c, ssot__TelemetryTraceSpanId__c
         FROM ssot__AiAgentInteraction__dlm
         WHERE ssot__AiAgentSessionId__c = '${sessionId}' ORDER BY ssot__StartTimestamp__c ASC`
      ),
    ])

    const ids = (interactions.records || []).map(i => `'${i['ssot__Id__c']}'`).join(',')
    let steps = { records: [] }
    let messages = { records: [] }

    if (ids.length > 0) {
      ;[steps, messages] = await Promise.all([
        dcQueryAll(org,
          `SELECT ssot__Id__c, ssot__AiAgentInteractionId__c, ssot__StartTimestamp__c, ssot__EndTimestamp__c,
                  ssot__AiAgentInteractionStepType__c, ssot__Name__c, SubType__c,
                  ssot__InputValueText__c, ssot__OutputValueText__c, ssot__ErrorMessageText__c,
                  ssot__GenAiGatewayRequestId__c, ssot__GenAiGatewayResponseId__c, ssot__GenerationId__c,
                  ssot__PreStepVariableText__c, ssot__PostStepVariableText__c, ssot__AttributeText__c
           FROM ssot__AiAgentInteractionStep__dlm
           WHERE ssot__AiAgentInteractionId__c IN (${ids}) ORDER BY ssot__StartTimestamp__c ASC`
        ),
        dcQueryAll(org,
          `SELECT ssot__Id__c, ssot__AiAgentInteractionId__c, ssot__AiAgentSessionId__c,
                  ssot__MessageSentTimestamp__c, MessageStartTimestamp__c, MessageEndTimestamp__c,
                  ssot__AiAgentInteractionMessageType__c, ssot__AiAgentInteractionMsgContentType__c,
                  ssot__ContentText__c, ssot__AiAgentSessionParticipantId__c, ssot__ParentMessageId__c,
                  Modality__c, AttributeText__c
           FROM ssot__AiAgentInteractionMessage__dlm
           WHERE ssot__AiAgentInteractionId__c IN (${ids})
           ORDER BY ssot__MessageSentTimestamp__c ASC`
        ),
      ])
    }

    res.json({
      participants: participants.records,
      interactions: interactions.records,
      steps: steps.records,
      messages: messages.records,
    })
  } catch (err) { handleDcError(err, res) }
})

app.get('/api/orgs/:org/interactions/:id/steps', async (req, res) => {
  try {
    const result = await dcQueryAll(req.params.org,
      `SELECT ssot__Id__c, ssot__AiAgentInteractionId__c, ssot__StartTimestamp__c, ssot__EndTimestamp__c,
              ssot__AiAgentInteractionStepType__c, ssot__Name__c, SubType__c,
              ssot__InputValueText__c, ssot__OutputValueText__c, ssot__ErrorMessageText__c,
              ssot__GenAiGatewayRequestId__c, ssot__GenAiGatewayResponseId__c, ssot__GenerationId__c,
              ssot__PreStepVariableText__c, ssot__PostStepVariableText__c, ssot__AttributeText__c
       FROM ssot__AiAgentInteractionStep__dlm
       WHERE ssot__AiAgentInteractionId__c = '${req.params.id}' ORDER BY ssot__StartTimestamp__c ASC`
    )
    res.json(result)
  } catch (err) { handleDcError(err, res) }
})

app.get('/api/orgs/:org/interactions/:id/messages', async (req, res) => {
  try {
    const result = await dcQueryAll(req.params.org,
      `SELECT ssot__Id__c, ssot__AiAgentInteractionId__c, ssot__AiAgentSessionId__c,
              ssot__MessageSentTimestamp__c, MessageStartTimestamp__c, MessageEndTimestamp__c,
              ssot__AiAgentInteractionMessageType__c, ssot__AiAgentInteractionMsgContentType__c,
              ssot__ContentText__c, ssot__AiAgentSessionParticipantId__c, ssot__ParentMessageId__c,
              Modality__c, AttributeText__c
       FROM ssot__AiAgentInteractionMessage__dlm
       WHERE ssot__AiAgentInteractionId__c = '${req.params.id}'
       ORDER BY ssot__MessageSentTimestamp__c ASC`
    )
    res.json(result)
  } catch (err) { handleDcError(err, res) }
})

const USAGE_FIELDS = `Id__c, AiAgentSessionId__c, AiAgentInteractionId__c, Timestamp__c,
              IsBillableIndicator__c, IsMeteredIndicator__c, MeteringSkipReasonCode__c,
              PromptInputTokenCount__c, PromptCompletionTokenCount__c, PromptTotalTokenCount__c,
              UsageQuantity__c, UsageTypeCode__c, UnitTypeCode__c,
              ModelProviderName__c, ModelProviderModelName__c, GenAiGatewayModelName__c,
              GenAiGatewayFeatureName__c, TierQualifierType__c, AgentDeveloperName__c`

app.get('/api/orgs/:org/sessions/:sessionId/usage', async (req, res) => {
  const { org, sessionId } = req.params
  try {
    const result = await dcQueryAll(org,
      `SELECT ${USAGE_FIELDS}
       FROM AiAgentGenerativeAiUsage_std__dlm
       WHERE AiAgentSessionId__c = '${sessionId}'
       ORDER BY Timestamp__c ASC`
    )
    res.json(result)
  } catch (err) { handleDcError(err, res) }
})

app.get('/api/orgs/:org/usage', async (req, res) => {
  const { org } = req.params
  const { period = '7d' } = req.query
  const periodMs = { '24h': 86400_000, '7d': 7 * 86400_000, '30d': 30 * 86400_000 }[period] ?? 7 * 86400_000
  const since = new Date(Date.now() - periodMs).toISOString().replace('T', ' ').replace('Z', '')
  try {
    const result = await dcQueryAll(org,
      `SELECT ${USAGE_FIELDS}
       FROM AiAgentGenerativeAiUsage_std__dlm
       WHERE Timestamp__c >= TIMESTAMP '${since}'
       ORDER BY Timestamp__c DESC`
    )
    res.json(result)
  } catch (err) { handleDcError(err, res) }
})

app.get('/api/orgs/:org/genai-request/:requestId', async (req, res) => {
  const { org, requestId } = req.params
  const { generationId } = req.query
  try {
    const [reqResult, genResult, usageResult] = await Promise.all([
      dcQueryAll(org,
        `SELECT gatewayRequestId__c, prompt__c, maskedPrompt__c, model__c, provider__c,
                feature__c, appType__c, timestamp__c,
                promptTokens__c, completionTokens__c, totalTokens__c,
                temperature__c, frequencyPenalty__c, presencePenalty__c,
                numGenerations__c, promptTemplateDevName__c, parameters__c,
                enableInputSafetyScoring__c, enableOutputSafetyScoring__c, enablePiiMasking__c
         FROM GenAIGatewayRequest__dlm
         WHERE gatewayRequestId__c = '${requestId}' LIMIT 1`
      ),
      generationId
        ? dcQueryAll(org,
            `SELECT generationId__c, responseText__c, maskedResponseText__c, responseParameters__c
             FROM GenAIGeneration__dlm
             WHERE generationId__c = '${generationId}' LIMIT 1`
          ).catch(() => ({ records: [] }))
        : Promise.resolve({ records: [] }),
      req.query.interactionId
        ? dcQueryAll(org,
            `SELECT IsBillableIndicator__c, IsMeteredIndicator__c, MeteringSkipReasonCode__c,
                    TierQualifierType__c, UnitTypeCode__c, UsageTypeCode__c, UsageQuantity__c,
                    PromptTotalTokenCount__c, PromptInputTokenCount__c, PromptCompletionTokenCount__c,
                    ModelProviderName__c, ModelProviderModelName__c, GenAiGatewayFeatureName__c
             FROM AiAgentGenerativeAiUsage_std__dlm
             WHERE AiAgentInteractionId__c = '${req.query.interactionId}' LIMIT 1`
          ).catch(() => ({ records: [] }))
        : Promise.resolve({ records: [] }),
    ])
    res.json({
      request: reqResult.records[0] ?? null,
      generation: genResult.records[0] ?? null,
      billing: usageResult.records[0] ?? null,
    })
  } catch (err) { handleDcError(err, res) }
})

app.post('/api/orgs/:org/query', async (req, res) => {
  const { query } = req.body
  if (!query) return res.status(400).json({ error: 'query is required' })
  try {
    const result = await dcQueryAll(req.params.org, query)
    res.json(result)
  } catch (err) { handleDcError(err, res) }
})

app.get('/api/orgs/:org/dc-metadata', async (req, res) => {
  const { org } = req.params
  const cfg = await getOrgConfig(org)
  if (!cfg) return res.status(400).json({ error: 'NO_CONFIG', message: 'Data Cloud credentials not configured.' })
  try {
    const { accessToken, instanceUrl } = await getOrRefreshDataCloudToken(org, cfg)
    let fetchRes
    try {
      fetchRes = await fetch(`${instanceUrl}/api/v1/metadata`, {
        headers: { 'Authorization': `Bearer ${accessToken}` },
      })
    } catch (fetchErr) {
      throw new Error(`Metadata fetch failed: ${fetchErr.cause?.message || fetchErr.message}`)
    }
    if (!fetchRes.ok) {
      const t = await fetchRes.text()
      throw new Error(`Metadata API ${fetchRes.status}: ${t}`)
    }
    res.json(await fetchRes.json())
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── Fallback ──────────────────────────────────────────────────────────────────

app.get('*', (req, res) => res.sendFile(join(PUBLIC, 'index.html')))

app.listen(PORT, () => {
  console.log(`\n  Agentforce Session Viewer`)
  console.log(`  Open: http://localhost:${PORT}\n`)
})
