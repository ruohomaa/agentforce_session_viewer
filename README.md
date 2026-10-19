# Agentforce Session Viewer

A local web application for browsing Agentforce session data across your connected Salesforce orgs. Sessions, interactions, steps, and messages are queried live from Salesforce Data360 using the Data360 Query API.

## Features

- **Org switcher** — lists all orgs authenticated via the Salesforce CLI (`sf`), with pills indicating sandbox, scratch, and Data360 provisioning status
- **Session browser** — paginated list of `AIAgentSession` records, sorted newest first
- **Session detail** — expandable interactions showing messages (chat bubbles) and steps (LLM calls, actions, grounding, guardrails) with token counts and durations
- **Session logs** — filter logs by severity or text and expand entries to inspect details
- **Moments and quality** — intent summaries, linked interaction IDs, evaluation values, and explanations
- **SQL query pane** — free-form Data360 SQL editor with example queries pre-loaded for all five session objects
- **Per-org credentials** — Connected App credentials stored locally; never sent anywhere except your own Salesforce org

## Prerequisites

- [Node.js](https://nodejs.org/) 18 or later
- [Salesforce CLI](https://developer.salesforce.com/tools/salesforcecli) (`sf`) with at least one org authenticated
- A Salesforce org with Data360 provisioned, the required Agentforce telemetry settings enabled, and an External Client App configured (see below)

## Installation

```bash
git clone <repo-url>
cd agentforce-session-viewer
npm install
npm start
# Open http://localhost:3001
```

## Salesforce and Data360 setup

Complete telemetry setup before configuring OAuth. A successful connection does not mean the session or usage objects have been provisioned.

### Enable telemetry collection

Use a Salesforce administrator account with access to Agentforce setup and Data360. Feature availability depends on your org's licenses and release.

1. Confirm that **Data360 is provisioned** and that **Einstein Generative AI** is enabled in Salesforce Setup. Your querying user must also have access to the relevant Data360 data space and objects.
2. In **Setup → Agentforce Agents**, enable **Agentforce Session Tracing**. This provisions the standard session-tracing data model for sessions, participants, interactions, messages, and steps.
3. On the same page, enable **Agent Optimization** for moments, intent summaries, and evaluation tags. Salesforce can enable this automatically with Session Tracing; confirm its state.
4. In Setup, search for **audit** and open **Einstein Audit, Analytics, and Monitoring Setup**. Enable **Audit and Feedback**. This is separate from Session Tracing and is required for usage analytics and detailed LLM request/response records. **Knowledge/RAG Quality Data and Metrics** is optional for retrieval-quality analysis.
5. Allow initial provisioning to finish. In the Data360 app, check **Data Streams** for the Agentforce and generative AI streams and any deployment or ingestion errors. Do not manually create empty replacement objects with the same names.
6. Run a new agent conversation after enabling collection. Allow time for ingestion, then refresh the viewer. Audit logging does not backfill usage from before it was enabled.

### Settings and related objects

Data model objects (DMOs, ending in `__dlm`) are the reporting/query layer. Data lake objects (DLOs, ending in `__dll`) hold ingested data. Salesforce provisions and maps these objects as the relevant features are enabled.

| Salesforce setting | Related Data360 objects | Viewer requirement |
|---|---|---|
| Agentforce Session Tracing | `ssot__AiAgentSession__dlm`, `ssot__AiAgentSessionParticipant__dlm`, `ssot__AiAgentInteraction__dlm`, `ssot__AiAgentInteractionStep__dlm`, `ssot__AiAgentInteractionMessage__dlm` | Required for the session browser and timeline |
| Session-tracing logs | `AiAgentSessionLog_std__dlm` | Required for the Logs tab; confirm availability in your org's provisioned tracing model |
| Agent Optimization | `ssot__AiAgentMoment__dlm`, `ssot__AiAgentMomentInteraction__dlm`, `ssot__AiAgentTagAssociation__dlm`, `ssot__AiAgentTag__dlm`, `ssot__AiAgentTagDefinition__dlm` | Required for Moments & Quality |
| Audit and Feedback | `AiAgentGenerativeAiUsage_std__dlm`, GenAI gateway request, response, generation, feedback, and quality objects | Required for usage analytics and LLM details |
| Agent Platform Tracing | `ObservabilitySpans__dll`, `ssot__TelemetryTraceSpan__dlm` | Optional; the viewer does not currently query execution spans |
| Agent Optimizer (Beta) | Analysis over agent telemetry and optimization data | Optional; the viewer does not integrate Optimizer recommendations |
| Agent Health Monitoring | Agent metrics, semantic models, alerts, and notifications | Optional; the viewer does not integrate monitoring alerts |

The viewer currently reads LLM details from the legacy `GenAIGatewayRequest__dlm` and `GenAIGeneration__dlm` objects. Confirm these are available; the standard replacements use different API names and field mappings.

No custom Salesforce objects are required by the viewer. Existing Salesforce objects such as `BotDefinition`, `BotVersion`, `MessagingSession`, and `VoiceCall` provide agent or channel context; these switches do not create those object definitions or automatically generate conversations.

### Verify provisioning

Run these separately in the viewer's Query tab or the Data360 Query Editor:

```sql
SELECT COUNT(*) AS session_count
FROM ssot__AiAgentSession__dlm
```

```sql
SELECT COUNT(*) AS usage_count
FROM AiAgentGenerativeAiUsage_std__dlm
```

A count of zero means the object is queryable but has no records yet. A `404` with `DataModelEntity ... is not found` means the object is not available to the query in that tenant/data space; check provisioning, the object name, and access. A `400` with `unknown column` indicates a schema mismatch, not missing conversations.

Do not use `information_schema.tables` with this app's Query API endpoint. Discover objects through the Metadata API, exposed by the viewer at `GET /api/orgs/<org-alias>/dc-metadata`.

References: [Session Tracing data model](https://help.salesforce.com/s/articleView?id=ai.generative_ai_session_trace_data_model.htm&type=5), [usage collection setup](https://www.salesforce.com/blog/agentforce-usage-data-model/), and [AI usage data model](https://help.salesforce.com/s/articleView?id=ai.generative_ai_usage_data_model.htm&type=5).

## Data360 OAuth setup

Agentforce session data lives in Salesforce Data360 and requires a dedicated OAuth app with the correct scopes. The app detects which of your orgs have Data360 provisioned automatically (via `CustomerDataPlatformSettings.IsCustomerDataPlatformEnabled`).

### 1. Create an External Client App

In Salesforce Setup → **App Manager** → **New External Client App**:

- **OAuth flow**: JWT Bearer
- **Scopes**:
  - `cdp_query_api` — Execute ANSI SQL queries against Data360
  - `refresh_token` — Obtain refresh tokens
  - `api` — Access Salesforce APIs (required for token exchange)
  - `cdp_profile_api` — Optional profile-data access; not required by the viewer's current SQL queries
- **Certificate**: upload a self-signed `.crt` file; keep the matching `.key` file

### 2. Generate a self-signed certificate (if you don't have one)

```bash
openssl genrsa -out server.key 2048
openssl req -new -key server.key -out server.csr
openssl x509 -req -sha256 -days 1825 -in server.csr -signkey server.key -out server.crt
```

Upload `server.crt` to the Connected App. Keep `server.key` somewhere safe — you'll need the path or PEM content when configuring the viewer.

### 3. Pre-authorize the app

Open your External Client App's policies in Salesforce Setup (or **Connected Apps → Manage → Edit Policies** for an existing Connected App):
- Set **Permitted Users** to *Admin approved users are pre-authorized*
- Under **Profiles** or **Permission Sets**, add the profiles/users who will query sessions

### 4. Configure the viewer

1. Start the app and select a Data360-enabled org
2. Open the Data360 setup button in the top-right
3. Fill in:
   - **Consumer Key** — from the Connected App's OAuth settings
   - **Username** — the Salesforce username the JWT will be issued for
   - **Login URL** — `https://test.salesforce.com` for sandboxes, `https://login.salesforce.com` for production
   - **Private Key** — paste the PEM content of your `.key` file, or provide the absolute file path
4. Click **Test connection** — a successful test shows the Data360 tenant URL
5. Click **Save**

Credentials are stored in `.dc-config.json` in the project root. Add it to `.gitignore` to avoid committing private keys.

## Authentication flow

```
Private key → RS256 JWT → POST {loginUrl}/services/oauth2/token
  → Salesforce access token
  → POST {instanceUrl}/services/a360/token
  → Data360 access token + tenant URL
  → POST {dcTenantUrl}/api/v1/query  { "sql": "..." }
```

Tokens are cached in memory and refreshed automatically before expiry.

## Data model

The five core session trace objects are queried from Data360:

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
| `server/auth.js` | JWT generation and Data360 token exchange |
| `server/config.js` | Credential persistence |
| `server/index.js` | Express API server |
| `public/index.html` | Single-file React frontend (CDN-loaded, no build step) |

## License

MIT — see [LICENSE](LICENSE).
