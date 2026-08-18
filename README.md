# Agentforce Session Viewer

A local web application for browsing Agentforce session data across your connected Salesforce orgs. Sessions, interactions, steps, and messages are queried live from Salesforce Data Cloud using the Data Cloud Query API.

## Features

- **Org switcher** — lists all orgs authenticated via the Salesforce CLI (`sf`), with pills indicating sandbox, scratch, and Data Cloud provisioning status
- **Session browser** — paginated list of `AIAgentSession` records, sorted newest first
- **Session detail** — expandable interactions showing messages (chat bubbles) and steps (LLM calls, actions, grounding, guardrails) with token counts and durations
- **SQL query pane** — free-form Data Cloud SQL editor with example queries pre-loaded for all five session objects
- **Per-org credentials** — Connected App credentials stored locally; never sent anywhere except your own Salesforce org

## Prerequisites

- [Node.js](https://nodejs.org/) 18 or later
- [Salesforce CLI](https://developer.salesforce.com/tools/salesforcecli) (`sf`) with at least one org authenticated
- A Salesforce org with Data Cloud provisioned and an External Client App configured (see below)

## Installation

```bash
git clone <repo-url>
cd agentforce-session-viewer
npm install
npm start
# Open http://localhost:3001
```

## Data Cloud Setup

Agentforce session data lives in Salesforce Data Cloud and requires a dedicated Connected App with the correct OAuth scopes. The app detects which of your orgs have Data Cloud provisioned automatically (via `CustomerDataPlatformSettings.IsCustomerDataPlatformEnabled`).

### 1. Create an External Client App

In Salesforce Setup → **App Manager** → **New External Client App**:

- **OAuth flow**: JWT Bearer
- **Scopes** (add all four):
  - `cdp_query_api` — Execute ANSI SQL queries against Data Cloud
  - `cdp_profile_api` — Read Data Cloud profile data
  - `refresh_token` — Obtain refresh tokens
  - `api` — Access Salesforce APIs (required for token exchange)
- **Certificate**: upload a self-signed `.crt` file; keep the matching `.key` file

### 2. Generate a self-signed certificate (if you don't have one)

```bash
openssl genrsa -out server.key 2048
openssl req -new -key server.key -out server.csr
openssl x509 -req -sha256 -days 1825 -in server.csr -signkey server.key -out server.crt
```

Upload `server.crt` to the Connected App. Keep `server.key` somewhere safe — you'll need the path or PEM content when configuring the viewer.

### 3. Pre-authorize the app

In Setup → **Connected Apps** → **Manage** → find your app → **Edit Policies**:
- Set **Permitted Users** to *Admin approved users are pre-authorized*
- Under **Profiles** or **Permission Sets**, add the profiles/users who will query sessions

### 4. Configure the viewer

1. Start the app and select a Data Cloud-enabled org (amber **Data Cloud** pill)
2. Click **⚙ Setup Data Cloud** in the top-right
3. Fill in:
   - **Consumer Key** — from the Connected App's OAuth settings
   - **Username** — the Salesforce username the JWT will be issued for
   - **Login URL** — `https://test.salesforce.com` for sandboxes, `https://login.salesforce.com` for production
   - **Private Key** — paste the PEM content of your `.key` file, or provide the absolute file path
4. Click **Test connection** — a successful test shows the Data Cloud tenant URL
5. Click **Save**

Credentials are stored in `.dc-config.json` in the project root. Add it to `.gitignore` to avoid committing private keys.

## Authentication flow

```
Private key → RS256 JWT → POST {loginUrl}/services/oauth2/token
  → Salesforce access token
  → POST {instanceUrl}/services/a360/token
  → Data Cloud access token + tenant URL
  → POST {dcTenantUrl}/api/v1/query  { "sql": "..." }
```

Tokens are cached in memory and refreshed automatically before expiry.

## Data model

All five session trace objects are queried from Data Cloud:

| Object | Description |
|---|---|
| `AIAgentSession` | Top-level session record |
| `AIAgentSessionParticipant` | Participants (user / agent) in a session |
| `AIAgentInteraction` | Individual LLM interactions within a session |
| `AIAgentInteractionStep` | Steps within an interaction (LLM calls, actions, grounding, guardrails) |
| `AIAgentInteractionMessage` | User and agent messages within an interaction |

## Configuration files

| File | Purpose |
|---|---|
| `.dc-config.json` | Per-org Connected App credentials (Consumer Key, private key, login URL, username) |
| `server/auth.js` | JWT generation and Data Cloud token exchange |
| `server/config.js` | Credential persistence |
| `server/index.js` | Express API server |
| `public/index.html` | Single-file React frontend (CDN-loaded, no build step) |

## License

MIT — see [LICENSE](LICENSE).
