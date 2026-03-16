# PDC Gateway - Data Analytics Platform

A multi-tenant data analytics gateway that enables secure data exchange via the PTX-Dataspace-Connector (PDC). Built with React, TypeScript, and Supabase.

## 🏛️ Project Information

**Co-designed and co-developed by [Scheer IMC](https://www.scheer-imc.com/)** as part of the **EDGE-Skills Project**.

This project is part of the Prometheus-X ecosystem for secure, trusted data exchange in education and skills development.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)


# EDGE-Skills – Gateway to Dataspace (Web Application)

This repository contains a web-based application acting as a **Gateway to a Dataspace**, developed within the **EDGE-Skills project (2024–2026)**.

The gateway supports discovery, access, and interaction with dataspace-related services and components, following principles of interoperability, modularity, and openness.

---

## Project and Governance Context

This software is developed as part of the **EDGE-Skills project**, co-funded under European Union programmes (EU Digital).

- **Design, ideation, and architectural direction**: Scheer IMC  
- **Implementation approach**: Co-development, including AI-assisted development tools  
- **Supervision and responsibility during the Project execution**: Scheer IMC, on behalf of the EDGE-Skills consortium  

All published source code is checked, reviewed, curated, and maintained by the project team in line with EDGE and PTX dataspace governance principles.

---

## Alignment with EDGE / PTX Dataspace Principles

This gateway is designed with consideration for:

- Openness and reusability
- Interoperability across organizational boundaries
- Clear separation of presentation, logic, and integration layers
- Compatibility with evolving dataspace architectures, connectors, and policy frameworks

The software does not enforce a single dataspace standard and may require adaptation for specific deployments.

---

## Project Status

This repository provides a **work-in-progress reference implementation**.

It is **not a final production-ready system**.  
Further refinement is expected, particularly regarding:

- UI/UX design adaptation
- Security hardening and access control
- Dependency management and updates
- Integration with production-grade dataspace infrastructures

---

## AI-Assisted Development

AI-assisted tools were used to support prototyping, and implementation.  
All AI-assisted outputs were **reviewed and validated by human developers**.

Responsibility for the resulting codebase remains fully with the **EDGE-Skills project consortium**.

---

## Open-Source License

This project is released under the **MIT License**.  
See the [LICENSE](LICENSE) file for details.

---

## Third-Party Dependencies

All third-party libraries are licensed under **OSI-approved open-source licenses**, including:

- MIT License
- Apache License 2.0

Dependency licenses must be respected in downstream use.

---

## EU Funding Disclaimer

This project has received funding from the European Union.  
The views and opinions expressed in this repository are those of the authors only and do not necessarily reflect those of the European Union or the granting authority.  
Neither the European Union nor the granting authority can be held responsible for them.

---

## Contributions

Contributions are welcome.  
Please see [CONTRIBUTING.md](CONTRIBUTING.md) for details.

---

## Disclaimer

This software is provided **"as is"**, without warranty of any kind.

---

## 📚 Table of Contents

1. [Quick Start](#-quick-start)
2. [Architecture Overview](#-architecture-overview)
3. [Project Structure](#-project-structure)
4. [Routing & Pages](#-routing--pages)
5. [Backend (Edge Functions)](#-backend-edge-functions)
6. [Database Schema](#-database-schema)
7. [Authentication & Authorization](#-authentication--authorization)
8. [Configuration System](#-configuration-system)
9. [Contract Mapping & Extraction](#-contract-mapping--extraction)
10. [Payload Generation](#-payload-generation)
11. [Parameter System](#-parameter-system)
12. [Result URL Resolution](#-result-url-resolution)
13. [Embedding the Gateway](#-embedding-the-gateway)
14. [Self-Hosting & Running Locally](#-self-hosting--running-locally)
15. [Development Guide](#-development-guide)

---

## 🚀 Quick Start

### Prerequisites

- [Node.js 20+](https://nodejs.org/)
- npm (or [Bun](https://bun.sh/))
- [Docker Engine](https://docs.docker.com/engine/install/) for local Supabase

### Start (Recommended)

```bash
# Clone the repository
git clone <YOUR_GIT_URL>
cd <YOUR_PROJECT_NAME>

npm install

# Run full local stack (frontend + Supabase + local email inbox)
npm run stack:local
```

For AWS/local/remote variants and detailed setup, see [Self-Hosting & Running Locally](#-self-hosting--running-locally).

### Environment Variables

Frontend env values should only contain `VITE_` keys.
Copy template:

```bash
cp .env.example .env.local
```

| Variable | Required | Description |
|----------|----------|-------------|
| `VITE_SUPABASE_URL` | Yes | Supabase API URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Yes | Supabase anonymous/public key |
| `VITE_SUPABASE_PROJECT_ID` | No | Optional identifier for environment labeling (currently not used at runtime) |

### Backend Secrets (Server-side only)

These are configured in `supabase/functions/.env` (local) or Supabase secrets (deployed) and are **never exposed to the client**.
Copy template:

```bash
cp supabase/functions/.env.example supabase/functions/.env
```

| Secret | Description |
|--------|-------------|
| `PDC_BEARER_TOKEN` | Legacy fallback bearer token for PDC authentication (optional fallback in `pdc-execute`) |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key for admin operations (used by `resolve-placeholder`) |
| `SUPABASE_URL` | Supabase URL (auto-set in edge function environment) |
| `SUPABASE_ANON_KEY` | Supabase anon key (auto-set in edge function environment) |
| `EMBED_TOKEN_SECRET` | HMAC secret used to sign/verify embed tokens (used by `embed-auth`) |
| `PDC_EXECUTE_TOKEN_SECRET` | HMAC secret used to sign/verify org-bound execution tokens for public/embed flows |

---

## 🏗️ Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Frontend (React + TypeScript)               │
│                                                                     │
│  Routes:                                                            │
│  /login          → LoginPage (email/password auth)                  │
│  /               → LandingPage                                      │
│  /admin          → AdminDashboard (ProtectedRoute, requireAdmin)    │
│  /debug          → DebugModePage (ProtectedRoute)                   │
│  /embed          → EmbedGateway (standalone embeddable view)        │
│  /:slug          → OrgGateway (public org-scoped analytics flow)    │
│                                                                     │
│  Workflow Steps:                                                    │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────┐                 │
│  │ Analytics   │→ │ Data         │→ │ Processing  │→ Results        │
│  │ Selection   │  │ Selection    │  │ View        │                 │
│  └─────────────┘  └──────────────┘  └─────────────┘                 │
│         ↓                ↓                 ↓                        │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │         useDataspaceConfig / OrgGateway (DB Fetch)          │    │
│  └─────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│                    Supabase Edge Functions                          │
│  ┌──────────────┐  ┌───────────────┐  ┌───────────────────┐         │
│  │ pdc-execute  │  │ upload-proxy  │  │ config-api        │         │
│  │ (PDC calls)  │  │ (CORS bypass) │  │ (Admin CRUD)      │         │
│  ├──────────────┤  ├───────────────┤  ├───────────────────┤         │
│  │result-proxy  │  │resolve-       │  │                   │         │
│  │(result fetch)│  │placeholder    │  │                   │         │
│  └──────────────┘  └───────────────┘  └───────────────────┘         │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│                    External Services                                │
│  ┌──────────────────────────┐  ┌────────────────────────────────┐   │
│  │ PTX-Dataspace-Connector  │  │ VisionsTrust Catalog API       │   │
│  │ (PDC - Data Exchange)    │  │ (Contract/Resource Metadata)   │   │
│  └──────────────────────────┘  └────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

### Technology Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, TypeScript, Vite |
| Styling | Tailwind CSS, shadcn/ui |
| State | React Context, TanStack React Query |
| Routing | React Router v6 |
| Backend | Supabase (PostgreSQL, Auth, Edge Functions) |
| Edge Runtime | Deno (Supabase Edge Functions) |

---

## 📁 Project Structure

```
src/
├── components/
│   ├── admin/                        # Admin dashboard components
│   │   ├── AdminDashboard.tsx        # Main admin interface (tabs)
│   │   ├── ContractExtractor.tsx     # Contract URL extraction logic
│   │   ├── GlobalConfigSection.tsx   # Global settings management
│   │   ├── ManualResourceForm.tsx    # Manual resource creation
│   │   ├── PdcConfigSection.tsx      # PDC connector settings
│   │   ├── PlaceholdersConfigSection.tsx # Placeholder management
│   │   ├── ResourcesConfigSection.tsx # Resource CRUD
│   │   ├── ResourceDetailsModal.tsx  # Resource detail view/edit
│   │   ├── ServiceChainDetailsModal.tsx # Service chain detail view
│   │   └── UsersManagementSection.tsx # User & role management
│   ├── auth/                         # Authentication components
│   │   ├── LoginPage.tsx             # Login/signup form
│   │   ├── ProtectedRoute.tsx        # Route guard (auth + role checks)
│   │   └── OrganizationSetup.tsx     # Org creation for new users
│   ├── embed/                        # Embedding components
│   │   ├── EmbedGateway.tsx          # Embeddable gateway view
│   │   └── PDCGatewayElement.ts      # Web Component wrapper
│   ├── ui/                           # shadcn/ui components
│   ├── AnalyticsSelection.tsx        # Step 1: Select analytics type
│   ├── CenterFocusCarousel.tsx       # Carousel for analytics cards
│   ├── ChangePasswordDialog.tsx      # Password change modal
│   ├── ConfigPage.tsx                # Legacy config page
│   ├── DataSelection.tsx             # Step 2: Choose data sources
│   ├── DataspaceConfigPage.tsx       # Debug config viewer
│   ├── DocumentUploadZone.tsx        # File upload component
│   ├── HumanValidationPage.tsx       # Debug: Payload preview
│   ├── ManualJsonInput.tsx           # Manual JSON data input
│   ├── NavLink.tsx                   # Navigation link component
│   ├── ProcessingView.tsx            # Step 3: Execute PDC request
│   ├── ResultsView.tsx              # Step 4: Display results
│   ├── StepIndicator.tsx            # Step progress indicator
│   └── UserMenu.tsx                 # User dropdown menu
├── config/
│   ├── global.config.ts              # App-wide settings (admin/debug flags)
│   ├── dataspace.config.ts           # Legacy type definitions
│   ├── dataspace-params.config.ts    # Legacy parameter types
│   └── theme.config.ts              # Theme configuration
├── contexts/
│   ├── AuthContext.tsx               # Auth state, multi-org, debug mode
│   └── ProcessSessionContext.tsx     # Session management
├── hooks/
│   ├── useDataspaceConfig.ts         # Fetch org config from database
│   ├── useProcessSession.ts          # Session ID & param resolution
│   ├── use-mobile.tsx               # Mobile breakpoint detection
│   └── useTheme.ts                  # Theme management
├── pages/
│   ├── Index.tsx                     # Main authenticated flow
│   ├── OrgGateway.tsx               # Public organization gateway (/:slug)
│   ├── LandingPage.tsx              # Public landing page
│   ├── DebugModePage.tsx            # Debug interface
│   └── NotFound.tsx                 # 404 page
├── services/
│   └── configApi.ts                  # Admin API service (config-api client)
├── types/
│   ├── auth.ts                       # Auth types (AppRole, Organization, etc.)
│   └── dataspace.ts                  # Dataspace types (PdcConfig, resources, etc.)
└── utils/
    ├── pdcPayloadGenerator.ts        # Generate PDC request payload
    ├── paramSanitizer.ts             # Parameter handling & filtering
    ├── paramsPrefill.ts              # Parameter pre-fill utilities
    ├── resultUrlResolver.ts          # Resolve result fetch URLs
    └── urlValidator.ts               # SSRF protection

supabase/
├── functions/
│   ├── config-api/index.ts           # Admin configuration CRUD API
│   ├── embed-auth/index.ts           # Embed token issue/validate/revoke
│   ├── invite-org-user/index.ts      # Organization invitation flow
│   ├── pdc-execute/index.ts          # PDC data exchange proxy
│   ├── upload-proxy/index.ts         # CORS proxy for file uploads
│   ├── result-proxy/index.ts         # CORS proxy for result fetching
│   └── resolve-placeholder/index.ts  # Dynamic placeholder resolution
├── migrations/                       # Database migrations
└── config.toml                       # Edge function configuration
```

---

## 🗺️ Routing & Pages

Defined in `src/App.tsx`:

| Route | Component | Auth | Description |
|-------|-----------|------|-------------|
| `/` | `LandingPage` | No | Public landing page |
| `/login` | `LoginPage` | No | Login and signup form |
| `/admin` | `AdminDashboard` | Admin | Configuration management dashboard |
| `/debug` | `DebugModePage` | User | Debug interface for authenticated users |
| `/embed` | `EmbedGateway` | No | Standalone embeddable gateway (for iframes) |
| `/:slug` | `OrgGateway` | No | Public analytics flow scoped to an organization |
| `*` | `NotFound` | No | 404 catch-all |

`ProtectedRoute` wraps routes requiring authentication. It supports `requireAdmin` and `requireSuperAdmin` props.

---

## 🔧 Backend (Edge Functions)

All edge functions are in `supabase/functions/` and configured with `verify_jwt = false` in `config.toml` (JWT validation is handled within each function as needed).

### `pdc-execute` — PDC Data Exchange

Proxies data exchange requests to the PTX-Dataspace-Connector, resolving active org config server-side.

- **URL validation**: Active `dataspace_configs.pdc_url` must be HTTPS
- **Timeout**: 60 seconds
- **Auth**: Bearer token from per-org secure storage (`organization_pdc_secrets`), with optional legacy fallback to `PDC_BEARER_TOKEN`

```
POST /functions/v1/pdc-execute
Body: { payload: PdcPayload, org_execution_token?: string }
```

### `upload-proxy` — CORS Bypass for File Uploads

Forwards file uploads to external endpoints that don't support CORS. Preserves multipart boundary and content-type.

- **URL validation**: Only HTTPS URLs accepted
- **Timeout**: 60 seconds
- **Target**: Specified via `x-upload-url` header
- **Auth forwarding**: Via `x-upload-authorization` header

```
POST /functions/v1/upload-proxy
Headers: x-upload-url, x-upload-authorization
Body: Raw FormData (forwarded as-is)
```

### `result-proxy` — CORS Bypass for Result Fetching

Proxies result retrieval from external endpoints. Supports both GET and POST methods.

- **URL validation**: HTTP and HTTPS accepted
- **Timeout**: 30 seconds
- **Target**: Specified via `x-result-url` header
- **Method**: Specified via `x-result-method` header (default: GET)
- **Auth forwarding**: Via `x-result-authorization` header

```
POST /functions/v1/result-proxy
Headers: x-result-url, x-result-authorization, x-result-method
```

### `config-api` — Admin Configuration CRUD

JWT-authenticated API for managing organization configuration. Requires admin role for write operations.

- **Auth**: JWT required (validates via `supabase.auth.getClaims`)
- **Authorization**: Read access for org members; write access requires `admin` or `super_admin` role
- **Input validation**: Uses Zod schemas for all mutations

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/` | Member | Fetch all config (PDC, resources, chains, global) |
| `GET` | `/pdc` | Member | Get active PDC config |
| `POST` | `/pdc` | Admin | Create PDC config |
| `PUT` | `/pdc/:id` | Admin | Update PDC config |
| `GET` | `/resources` | Admin | Get all resources |
| `PUT` | `/resources/:id` | Admin | Update resource |
| `GET` | `/global` | Admin | Get global config |
| `PUT` | `/global` | Admin | Upsert global config |

### `resolve-placeholder` — Dynamic Placeholder Resolution

Resolves dynamic parameter placeholders at runtime. Supports built-in generators and custom function code execution.

- **Auth**: Uses `SUPABASE_SERVICE_ROLE_KEY` (no user JWT required)
- **Built-in generators**: `uuid`, `session_id`, `timestamp`, `date_iso`, `random_string`
- **Custom functions**: Executes user-defined async JavaScript code with a sandboxed context

```
POST /functions/v1/resolve-placeholder
Body: { placeholder_id: string, organization_id: string, test_only?: boolean }
```

### `embed-auth` — Embed Token Management

Manages embedding access tokens and origin validation for `/embed`.

- **Actions**:
  - `validate` (public token validation for iframe/web component runtime)
  - `issue` (admin-only, creates temporary/persistent tokens)
  - `revoke_persistent` (admin-only)
- **Token types**: temporary (HMAC-signed, TTL-based) and persistent (hashed + revocable)

### `invite-org-user` — Organization User Invitation

Invites users into an organization from the admin dashboard.

- **Auth**: Requires authenticated requester with `admin` or `super_admin` role in target org
- **Service-role operations**: writes invitation/member/role rows and calls `auth.admin.inviteUserByEmail`

---

## 🗄️ Database Schema

### Core Tables

| Table | Purpose |
|-------|---------|
| `organizations` | Multi-tenant organization data (name, slug, settings) |
| `organization_members` | User-organization membership (status: pending/active/suspended) |
| `user_roles` | RBAC roles per user per org (`super_admin`, `admin`, `user`) |
| `profiles` | User profile information (auto-created on signup via trigger) |
| `dataspace_configs` | PDC connector settings (URL, bearer token reference, fallback URLs) |
| `dataspace_params` | Software & data resource definitions (parameters as JSONB) |
| `service_chains` | Service chain configurations (services, embedded resources as JSONB) |
| `param_placeholders` | Dynamic placeholder definitions (static values, generators, custom functions) |
| `pdc_execution_logs` | Audit log of PDC executions (payload, response, status) |
| `global_configs` | Per-organization app settings (features, logging) |
| `debug_sessions` | Debug mode sessions (time-limited, per user per org) |

### Key Relationships

```
organizations
    │
    ├── organization_members → user (via user_id)
    ├── user_roles → user (via user_id)
    ├── dataspace_configs
    │       ├── dataspace_params (via config_id)
    │       └── service_chains (via config_id)
    ├── param_placeholders
    ├── global_configs (one-to-one)
    ├── pdc_execution_logs
    └── debug_sessions
```

### Views

| View | Purpose |
|------|---------|
| `profiles_secure` | Masked view of profiles (email masked for non-admin viewers via `mask_email` function) |

### Database Functions

| Function | Purpose |
|----------|---------|
| `create_organization_with_admin` | Creates org + membership + super_admin role + default global config in a single transaction |
| `has_role` | Check if user has a specific role in an organization |
| `is_org_admin` | Check if user is admin or super_admin |
| `is_org_member` | Check if user is active member of an organization |
| `get_user_organization` | Get user's first active organization ID |
| `verify_admin_access` | Verify the authenticated user is an admin in a given org |
| `mask_email` | Mask email addresses (admins see full, others see `ab***@domain.com`) |
| `handle_new_user` | Trigger function: auto-creates profile on auth.users insert |
| `update_updated_at_column` | Trigger function: auto-updates `updated_at` timestamps |

### Enums

| Enum | Values |
|------|--------|
| `app_role` | `super_admin`, `admin`, `user` |
| `resource_type` | `software`, `data`, `service_chain` |
| `visualization_type` | `upload_document`, `manual_json_input`, `data_api` |

---

## 🔒 Authentication & Authorization

### Authentication

- **Method**: Supabase Auth with email/password
- **Context**: `AuthContext` (`src/contexts/AuthContext.tsx`) manages auth state
- **Multi-org**: Users can belong to multiple organizations; active org stored in `localStorage`
- **Session**: JWT tokens, auto-refresh enabled

### Auth Context Features

```typescript
// Available from useAuth() hook:
signIn(email, password)
signUp(email, password, fullName?)
signOut()
refreshAuth()
toggleDebugMode()           // Activates 24h debug session
createOrganization(name, slug)
switchOrganization(orgId)   // Switch active org
leaveOrganization(orgId)    // Leave with super_admin protection
```

### RBAC Roles

| Role | Permissions |
|------|-------------|
| `super_admin` | Full access + user management + cannot leave if sole super_admin |
| `admin` | Configuration management + view users + debug mode access |
| `user` | Read-only access to gateway |

### Route Protection

`ProtectedRoute` component checks:
1. Authentication (redirects to `/login` if not authenticated)
2. Admin role (if `requireAdmin` prop is set)
3. Super admin role (if `requireSuperAdmin` prop is set)

### Security Measures

- **RLS Policies**: All tables protected by Row-Level Security
- **Server-side Secrets**: Bearer tokens never exposed to client
- **SSRF Protection**: URL validation in edge functions (HTTPS-only for PDC and uploads)
- **Input Validation**: Zod schemas in `config-api` edge function
- **Email Masking**: Non-admin users see masked emails via `profiles_secure` view
- **Debug Mode**: Time-limited (24h) sessions, admin-only

---

## ⚙️ Configuration System

Configuration is **database-driven** and managed per organization. The admin dashboard provides a UI for all configuration, and the `config-api` edge function provides the API.

### Data Flow

```
Admin Dashboard → config-api (Edge Function) → Database
                                                   ↓
Public Gateway (/:slug) ← Direct Supabase queries ←
```

### Configuration Types

1. **PDC Config** (`dataspace_configs`): PDC URL, bearer token reference, fallback result URL
2. **Resources** (`dataspace_params`): Software resources (analytics) and data resources with parameters
3. **Service Chains** (`service_chains`): Multi-step service chains with embedded resources
4. **Global Config** (`global_configs`): App name, version, feature flags, logging settings
5. **Placeholders** (`param_placeholders`): Dynamic value generators for parameter substitution

### Frontend Config Hooks

- `useDataspaceConfig()`: Fetches active PDC config, visible resources, and service chains from the database. Used by `Index`, `EmbedGateway`, and `ConfigPage`.
- `OrgGateway` page: Performs the same fetch but scoped to a specific organization by slug.

---

## 📄 Contract Mapping & Extraction

The admin dashboard includes a **Contract Extractor** (`src/components/admin/ContractExtractor.tsx`) that:

1. Fetches ecosystem metadata from a VisionsTrust contract URL
2. Recursively traverses service offerings, software/data resources
3. Extracts and normalizes resource metadata
4. Merges with existing data (preserves manually edited parameters)

### Adding a New Contract

1. Go to Admin Dashboard → Resources tab
2. Click "Extract from Contract"
3. Enter the contract URL
4. Review extracted resources
5. Click "Import" to merge with existing data

---

## 📦 Payload Generation

**Location**: `src/utils/pdcPayloadGenerator.ts`

### PdcPayload Structure

```typescript
interface PdcPayload {
  contract: string;             // Contract URL
  purposeId?: string;           // Service offering URL (analytics)
  resourceId?: string;          // Service offering URL (data)
  serviceChainId?: string;      // Catalog ID (for service chains)
  resources: Array<{
    resource: string;           // Data resource URL
    params?: { query: Array<Record<string, string>> };
  }>;
  purposes: Array<{
    resource: string;           // Analytics resource URL
    params?: { query: Array<Record<string, string>> };
  }>;
  serviceChainParams?: Array<{  // Middle resources in service chains
    resource: string;
    params?: { query: Array<Record<string, string>> };
  }>;
}
```

### Generation Modes

**Software Analytics**: Maps selected analytics to `purposes`, selected data resources to `resources`.

**Service Chain Analytics**: Maps embedded resources by `service_index`:
- First resource → `resources` array
- Last resource → `purposes` array
- Middle resources → `serviceChainParams` array

### Flow

```
User Selections → generatePdcPayload() → sanitizeParams() → Build Payload
      ↓                                        ↓
  Analytics +                           Remove #ignoreParam
  Data Resources                        Resolve #genSessionId
                                        Filter by paramAction context
```

---

## ⚙️ Parameter System

**Location**: `src/utils/paramSanitizer.ts`

### Special Placeholder Values

| Placeholder | Description |
|-------------|-------------|
| `#genSessionId` | Replaced with unique session ID at runtime |
| `#ignoreParam` | Parameter completely excluded from all flows |

### Parameter Actions (paramAction)

Actions control parameter inclusion in different contexts:

| Action | Effect |
|--------|--------|
| `#ignorePayload` | Exclude from PDC payload |
| `#ignoreFlowResult` | Exclude from result fetch URL |
| `#ignoreFlowData` | Exclude from data page fetch |

### Multiple Actions

Parameters can have multiple actions (space-separated):

```typescript
{
  paramName: "fileOwner",
  paramValue: "user123",
  paramAction: "#ignorePayload #ignoreFlowResult"
}
```

### Flow Contexts

The `sanitizeParams()` function accepts a `FlowContext` to filter parameters:

| Context | Used By | Ignores |
|---------|---------|---------|
| `payload` | PDC payload generation | `#ignorePayload` |
| `flowResult` | Result URL resolution | `#ignoreFlowResult` |
| `flowData` | Upload/data page fetch | `#ignoreFlowData` |
| `all` | Default, no action filtering | Nothing |

### Session Management

The `useProcessSession()` hook from `ProcessSessionContext` (`src/contexts/ProcessSessionContext.tsx`) generates a unique session ID (`session_{timestamp}_{random}`) per analytics process and provides utilities:

- `resolveParamValue(value)` — replaces `#genSessionId`
- `resolveParams(params)` — resolves all values in a record
- `sanitizeParams(params)` — removes ignored params + resolves session IDs

---

## 🔗 Result URL Resolution

**Location**: `src/utils/resultUrlResolver.ts`

After PDC execution, result URLs are resolved from the data resource configuration. The `result_url_source` field determines the source:

| Source | Behavior |
|--------|----------|
| `contract` | Uses the URL from the resource's `api_response_representation.url` field |
| `fallback` | Uses the PDC config's `fallback_result_url` |
| `custom` | Uses the resource's `custom_result_url` |

Results are fetched via the `result-proxy` edge function to bypass CORS restrictions.

---

## 🖼️ Embedding the Gateway

Embedding is secured by:

1. Organization allowlist (`allowed_origins`) configured in Admin.
2. Embed token issued by `embed-auth` (temporary or persistent).
3. `/embed` route validation before data is loaded.

### 1) Configure Embed Access in Admin

Open `Admin Dashboard -> Embed` and configure:

- `Enable Embedding`
- `Allowed Origins` (exact origins, e.g. `https://app.example.com`)
- Issue token for one allowed origin:
  - `Temporary (TTL)` token for short-lived access
  - `Persistent` token for trusted internal embeds

The page also provides ready-to-copy iframe/web component snippets.

### 2) Option 1: iframe Embedding

```html
<iframe
  src="https://your-domain.com/embed?org=your-org-slug&theme=dark&token=YOUR_EMBED_TOKEN"
  width="100%"
  height="800"
  frameborder="0"
></iframe>
```

### 3) Option 2: Web Component

**Location**: `public/pdc-gateway.js`

```html
<script src="https://your-gateway-domain.com/pdc-gateway.js"></script>
<pdc-gateway
  org-slug="your-org-slug"
  theme="dark"
  token="YOUR_EMBED_TOKEN"
  gateway-origin="https://your-gateway-domain.com"
  height="800"
></pdc-gateway>
```

### Query Parameters / Attributes

| Name | Description | Required |
|------|-------------|----------|
| `org` / `org-slug` | Organization slug | Yes |
| `theme` | `light` or `dark` | No |
| `token` | Embed token from Admin (`embed-auth`) | Yes |
| `gateway-origin` | PTX Gateway base URL used by web component iframe | Recommended |
| `height` | Iframe/web-component height in px | No |

### Embed Token Notes

- Token is origin-bound.
- Temporary tokens expire by TTL.
- Persistent tokens are long-lived and must be revoked manually from Admin.
- Token validation happens in `supabase/functions/embed-auth/index.ts`.
- `/embed` denies access when token is missing/invalid/expired or origin is not allowed.
- If parent site uses strict `Referrer-Policy: no-referrer`, origin validation may fail.

### Event Communication

The embedded gateway sends `postMessage` events to the parent window:

```javascript
window.addEventListener('message', (event) => {
  if (event.data.type === 'pdc-gateway-step-change') {
    console.log('Step:', event.data.step);       // "Select Type", "Choose Data", etc.
    console.log('Index:', event.data.stepIndex);  // 0, 1, 2, 3
  }
});
```

---

## 🐳 Self-Hosting & Running Locally

### Prerequisites

- [Docker Engine](https://docs.docker.com/engine/install/) + Docker Compose plugin
- [Node.js 20+](https://nodejs.org/) (Node 18 works but may show engine warnings)
- npm (or [Bun](https://bun.sh/))
- Git

### Full Local Development (Frontend + Local Supabase)

This is the recommended local setup for this project.

```bash
# 1. Clone the repository
git clone <YOUR_GIT_URL>
cd <YOUR_PROJECT_NAME>

# 2. Install frontend dependencies
npm install
# or
bun install

# 3. Verify Docker daemon access
docker info

# If you see a Docker socket permission error on Linux:
#   sudo usermod -aG docker $USER
#   newgrp docker
#   docker info

# 4. Start local Supabase (PostgreSQL, Auth, Edge Functions, Studio, etc.)
npx supabase start
# or, if installed globally:
# supabase start

# 5. Apply all project migrations locally
npx supabase db reset

# 6. Read local credentials
npx supabase status
# (or let the setup script read them automatically)

# 7. Auto-configure local frontend + function env files
npm run setup:local-auth
# This creates/updates:
# - .env.local
# - supabase/functions/.env
# (it will not overwrite existing non-empty signing secrets)
# Local auth emails are available in Mailpit: http://127.0.0.1:54324

# 8. Run frontend
npm run dev
# or
bun dev

# App available at http://localhost:8080
```

### Single Script to Run All Services

Use one script for all environments:

```bash
# Local: frontend + backend + local Supabase + local email inbox (Mailpit)
npm run stack:local

# AWS server with local Supabase on the same server:
# frontend + backend + local Supabase + local email inbox (Mailpit)
npm run stack:aws-local

# AWS server with remote Supabase project:
# frontend only (Supabase/auth/email handled by remote Supabase)
npm run stack:aws-remote
```

### Automatic Auth/Email Setup (Local + AWS)

```bash
# Local: generate .env.local + supabase/functions/.env from running local Supabase
npm run setup:local-auth

# AWS/self-hosted Supabase: generate SMTP/auth env template
npm run setup:aws-smtp -- \
  --domain https://gateway.example.com \
  --smtp-host smtp.your-provider.com \
  --smtp-port 587 \
  --smtp-user smtp-user \
  --smtp-pass smtp-password \
  --admin-email no-reply@gateway.example.com \
  --sender-name "PTX Gateway"

# Output file:
# .env.supabase.aws.smtp
# Merge it into your Supabase self-host .env, then restart auth/kong containers.
```

Useful options:

```bash
# Reset DB after starting local Supabase
bash scripts/run-all.sh local --reset-db

# Custom host/port
bash scripts/run-all.sh server --host 0.0.0.0 --frontend-port 8080
```

### Start / Stop Commands

```bash
# Start commands:
# See "Single Script to Run All Services" above.

# Stop local stack (frontend + local Supabase)
npm run stack:stop:local

# Stop AWS server stack with local Supabase
npm run stack:stop:aws-local

# Stop AWS server stack with remote Supabase (frontend only)
npm run stack:stop:aws-remote

# Generic stop (defaults to local mode)
npm run stack:stop

# Optional: stop a custom frontend port
bash scripts/stop-stack.sh local --frontend-port 8080
```

### Local URLs (Default)

- Frontend: `http://localhost:8080`
- Supabase API: `http://127.0.0.1:54321`
- Supabase Studio: `http://127.0.0.1:54323`

### Optional: Full Self-Hosted Supabase (Separate Stack)

For a production-style self-hosted Supabase stack, follow the official guide:
https://supabase.com/docs/guides/self-hosting/docker

### Troubleshooting

| Issue | Solution |
|-------|----------|
| `npx supabase start` says "Docker Desktop is a prerequisite" on Linux | Docker daemon is usually not accessible. Run `docker info`; if permission denied: `sudo usermod -aG docker $USER && newgrp docker` then retry |
| `npx supabase start` fails | Ensure Docker is running and ports `54321-54324` are free |
| Migrations fail | Run `npx supabase db reset` to recreate local DB |
| Edge functions return 500 | Check secrets with `npx supabase secrets list` |
| CORS errors | Ensure `VITE_SUPABASE_URL` matches the running instance |
| Auth not working | Verify the anon key matches the running instance |

---

## 🛠️ Development Guide

### Adding a New Analytics Type

1. Create resource in Admin Dashboard (or via contract extraction)
2. Set `resource_type` to `software` and `is_visible` to `true`
3. Define parameters with appropriate `paramAction` flags
4. Test payload generation using the debug mode validation page

### Adding a New Edge Function

1. Create the function directory and file:

```bash
mkdir supabase/functions/my-function
```

2. Create `supabase/functions/my-function/index.ts`:

```typescript
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  return new Response(JSON.stringify({ success: true }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
```

3. Register in `supabase/config.toml`:

```toml
[functions.my-function]
verify_jwt = false
```

### Testing

```bash
# Run frontend in dev mode
bun dev

# Edge functions run automatically with `supabase start`
# Test edge functions directly:
curl -X POST http://127.0.0.1:54321/functions/v1/pdc-execute \
  -H "Content-Type: application/json" \
  -d '{"payload":{...}, "org_execution_token":"<signed-token>"}'
```

---

## 📖 Additional Resources

- [Supabase Documentation](https://supabase.com/docs)
- [VisionsTrust API](https://api.visionstrust.com/docs)
- [PTX-Dataspace-Connector](https://github.com/Prometheus-X-association/dataspace-connector)
- [Prometheus-X Association](https://prometheus-x.org/)
- [EDGE-Skills Project](https://www.edge-skills.eu/)
- [Admin Pages Guide](docs/admin-pages-guide.md)

---

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make changes following existing patterns
4. Test thoroughly
5. Submit a pull request

See [CONTRIBUTING.md](CONTRIBUTING.md) for detailed guidelines.

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

**Co-designed and co-developed by Scheer IMC GmbH** as part of the EDGE-Skills Project.
