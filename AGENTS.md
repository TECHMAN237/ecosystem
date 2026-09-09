# RAYDAR — Permanent Architectural Guidelines

## 1. Official Architecture & Source of Truth
- **Frontend**: React / Vite / Static Web UI deployed to Vercel.
- **Backend**: Supabase (`https://ifpbdythbhlgqymsaxtz.supabase.co` - Project Ref: `ifpbdythbhlgqymsaxtz`).
- **Google AI Studio**: Development workspace only (not a production backend).

## 2. Strict Backend Separation Rules
- **Server-Side Business Logic**: Must be written directly in `supabase/functions/<function-name>/index.ts` (TypeScript / Deno).
- **Data Logic & Transactions**: PostgreSQL Functions / RPC and Triggers in `supabase/migrations/`.
- **Authentication & Identity**: Supabase Auth (`auth.users`), linked via strict Foreign Keys (`user_id REFERENCES auth.users(id)`).
- **Security & Authorization**: Row Level Security (RLS) on all tables. Never trust browser storage (`localStorage.role`, `isAdmin`, etc.) for security.
- **File Storage**: Supabase Storage (`avatars` bucket with public URL reference in PostgreSQL). **Zero base64 image storage in database**.
- **Backend Secrets**: Supabase Edge Function Secrets (never in `VITE_*` or client bundle).

## 3. Frontend Integration Pattern
- Frontend services (`src/services/` or `src/reportService.js`) act strictly as client wrappers.
- All server-side operations are invoked via:
  ```javascript
  const { data, error } = await supabase.functions.invoke('function-name', { body: payload });
  ```

## 4. Mandatory Reporting Standard
After every backend modification, provide the required status block:
- **BACKEND LOCATION**: Supabase Edge Function / PostgreSQL / Trigger / RPC
- **FUNCTION NAME**: Exact name
- **DATABASE TABLES**: Tables used
- **STORAGE**: Bucket used
- **AUTH**: Auth method
- **RLS**: Policies involved
- **DEPLOYMENT**: DEPLOYED / NOT DEPLOYED (with explicit instructions)
- **FRONTEND CONNECTION**: Method of invocation
- **TEST**: Verified outcome

## 5. Permanent Backend Version Control & Recovery Policy
**CRITICAL**: ANY modification that affects the Supabase backend must automatically be represented in the GitHub repository before or together with deployment.

### 5.1. GitHub is the Backend Source of Truth
The following must remain versioned in the repository whenever they exist or are modified:
- `supabase/migrations/` (All schema, DDL, RLS, triggers, indexes, RPCs)
- `supabase/functions/` (Edge Function source code, TypeScript / Deno)
- `supabase/config.toml` (Supabase configuration and function routing)
- `supabase/functions/deno.json` (Deno dependencies and configuration)
- SQL functions / RPC definitions
- Database triggers, indexes, and constraints
- Row Level Security (RLS) policies
- Storage bucket definitions and Storage policies
- Edge Function configuration and secrets expectations (names only)
- Backend deployment configurations

Never allow an important backend modification to exist only in the live Supabase project without a corresponding versioned representation in GitHub.

### 5.2. Automatic Change → Version → Deployment Workflow
For every backend modification, follow this mandatory workflow:
1. Inspect current GitHub backend state (`supabase/migrations/`, `supabase/functions/`, `supabase/config.toml`).
2. Determine required backend changes; avoid duplicate or conflicting migrations.
3. Modify or create migration (`supabase/migrations/`) or Edge Function source (`supabase/functions/`).
4. Validate the change (syntax, idempotence, type checking).
5. Commit the change to the Git repository.
6. Deploy/apply to Supabase (via CLI or SQL Editor / Dashboard).
7. Verify deployment against remote state.
8. Report exact Git commit hash + deployment status.

### 5.3. Database Changes Policy
- NEVER make an important schema change only through the Supabase Dashboard SQL Editor without also creating the corresponding migration in `supabase/migrations/`.
- Migrations must be idempotent whenever reasonably possible (`IF NOT EXISTS`, `OR REPLACE`).
- Preserve existing production data; never write destructive migration without explicit user authorization.
- Commit the migration to Git before or together with applying to Supabase.

### 5.4. Edge Functions Policy
- The authoritative source for Edge Functions is `supabase/functions/`.
- Do not modify deployed Edge Functions without updating, validating, and committing the local source files.

### 5.5. Storage Policy
- Bucket definitions, MIME types, file size limits, and Storage RLS policies must be versioned in migrations or `supabase/config.toml`.
- Never commit user-uploaded files, photos, PDFs, or private documents to Git.

### 5.6. Secrets Policy
- NEVER commit `SUPABASE_SERVICE_ROLE_KEY`, private tokens, or credentials to Git, `VITE_*` variables, or client bundles.
- Version only the configuration expectation or variable name (e.g., in `.env.example`), never the secret value.

### 5.7. Production Data Protection
- Version control is for backend source and schema, NOT production user data backup.
- Never export or commit production user records to satisfy version control.
- Never delete, truncate, reset, recreate, or migrate production data destructively unless explicitly authorized.

### 5.8. Failure Rule
If a backend modification cannot be safely versioned in GitHub:
- STOP before making the production modification.
- Report: `"BACKEND CHANGE BLOCKED — VERSION CONTROL NOT READY"` and explain what prevents safe versioning.

### 5.9. Verification & Honesty
- Never claim "versioned", "deployed", or "verified" unless the action was actually executed and confirmed.
- If an action was not executed, report `NOT EXECUTED` or `NOT VERIFIED`.

### 5.10. Immutability During Feature Work
- Future feature prompts automatically inherit this policy. Never remove or weaken this policy during feature implementation.

