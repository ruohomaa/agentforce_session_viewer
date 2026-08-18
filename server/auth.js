import { createSign, createPrivateKey } from 'crypto'
import { readFile } from 'fs/promises'

// ── JWT generation ────────────────────────────────────────────────────────────

function base64url(input) {
  return Buffer.from(input).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

function makeJwt(consumerKey, username, loginUrl, privateKeyPem) {
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const now = Math.floor(Date.now() / 1000)
  const payload = base64url(JSON.stringify({
    iss: consumerKey,
    sub: username,
    aud: loginUrl,
    exp: now + 180, // 3 minutes
  }))

  const signing = `${header}.${payload}`
  const sign = createSign('RSA-SHA256')
  sign.update(signing)
  const sig = sign.sign(createPrivateKey(privateKeyPem))
    .toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')

  return `${signing}.${sig}`
}

// ── Salesforce token via JWT bearer ──────────────────────────────────────────

function normalizePem(pem) {
  // Normalise line endings from any platform
  let s = pem.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim()

  // Reformat if the base64 body was collapsed into a single line
  const m = s.match(/^(-----BEGIN [^-]+-----)\n?([\s\S]+?)\n?(-----END [^-]+-----)$/)
  if (m) {
    const body = m[2].replace(/\s+/g, '').match(/.{1,64}/g)?.join('\n') ?? m[2]
    s = `${m[1]}\n${body}\n${m[3]}`
  }
  return s
}

function assertPrivateKey(pem) {
  if (pem.includes('CERTIFICATE REQUEST'))
    throw new Error('That looks like a Certificate Signing Request (.csr). Paste the private key (.key) instead — it starts with "-----BEGIN RSA PRIVATE KEY-----" or "-----BEGIN PRIVATE KEY-----".')
  if (pem.includes('CERTIFICATE') && !pem.includes('PRIVATE KEY'))
    throw new Error('That looks like a certificate (.crt). Paste the private key (.key) instead — it starts with "-----BEGIN RSA PRIVATE KEY-----" or "-----BEGIN PRIVATE KEY-----".')
  if (!pem.includes('PRIVATE KEY'))
    throw new Error('Unrecognised PEM type. The private key should start with "-----BEGIN RSA PRIVATE KEY-----" or "-----BEGIN PRIVATE KEY-----".')
}

async function getSalesforceToken(cfg) {
  const raw = cfg.privateKey.trim()
  let privateKeyPem = raw.startsWith('-----')
    ? normalizePem(raw)
    : normalizePem(await readFile(raw, 'utf8'))

  assertPrivateKey(privateKeyPem)

  const jwt = makeJwt(cfg.consumerKey, cfg.username, cfg.loginUrl, privateKeyPem)

  const params = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion: jwt,
  })

  const res = await fetch(`${cfg.loginUrl}/services/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  })

  const body = await res.json()
  if (!res.ok || body.error) {
    throw new Error(`SF JWT auth failed: ${body.error_description || body.error || res.status}`)
  }

  return { accessToken: body.access_token, instanceUrl: body.instance_url }
}

// ── Data Cloud token exchange ────────────────────────────────────────────────

async function getDataCloudToken(sfAccessToken, sfInstanceUrl) {
  const params = new URLSearchParams({
    grant_type: 'urn:salesforce:grant-type:external:cdp',
    subject_token: sfAccessToken,
    subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
  })

  const res = await fetch(`${sfInstanceUrl}/services/a360/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  })

  const body = await res.json()
  if (!res.ok || body.error) {
    throw new Error(`Data Cloud token exchange failed: ${body.error_description || body.error || res.status}`)
  }

  return {
    accessToken: body.access_token,
    instanceUrl: (body.instance_url.startsWith('http') ? body.instance_url : `https://${body.instance_url}`).replace(/\/$/, ''),
    expiresAt: Date.now() + (body.expires_in ?? 7200) * 1000 - 60_000, // 1 min buffer
  }
}

// ── Token cache ──────────────────────────────────────────────────────────────

const tokenCache = new Map() // orgAlias → { accessToken, instanceUrl, expiresAt }

export function clearTokenCache(orgAlias) {
  tokenCache.delete(orgAlias)
}

export async function getOrRefreshDataCloudToken(orgAlias, cfg) {
  const cached = tokenCache.get(orgAlias)
  if (cached && cached.expiresAt > Date.now()) return cached

  const { accessToken: sfToken, instanceUrl: sfUrl } = await getSalesforceToken(cfg)
  const dcToken = await getDataCloudToken(sfToken, sfUrl)
  tokenCache.set(orgAlias, dcToken)
  return dcToken
}
