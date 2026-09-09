# RAYDAR — Permanent Backend Version Control & Recovery Policy

## Objective
Any modification affecting the Supabase backend (`https://ifpbdythbhlgqymsaxtz.supabase.co`) must automatically be represented and versioned in the GitHub repository before or together with deployment.

This is a permanent project-level engineering rule.

---

## 1. GitHub is the Backend Source of Truth
The following components must remain version-controlled in the repository whenever created or modified:

- `supabase/migrations/`: All PostgreSQL schema, DDL, table definitions, columns, constraints, foreign keys, indexes, triggers, and functions/RPCs.
- `supabase/functions/`: All Supabase Edge Function source directories (TypeScript / Deno), including entry points (`index.ts`) and shared modules (`_shared/`).
- `supabase/config.toml`: CLI / runtime configuration, API settings, Storage limits, and Edge Function JWT verification settings.
- `supabase/functions/deno.json`: Deno runtime configuration, import maps, and dependencies.
- Row Level Security (RLS) policies: Versioned in migrations.
- Storage bucket definitions and Storage RLS policies: Versioned in migrations and `config.toml`.
- Edge Function configuration and secret key expectations (variable names only, never secrets).
- Backend deployment scripts or instructions.

Never allow an important backend modification to exist only in the live Supabase project without a corresponding versioned representation in GitHub.

---

## 2. Automatic Change → Version → Deployment Workflow

Whenever a task requires backend changes:

```
        BACKEND CHANGE REQUEST
                 ↓
        Inspect current GitHub state
                 ↓
        Determine required backend changes
                 ↓
        Modify/create migration or backend source
                 ↓
        Validate the change
                 ↓
        Commit the change to GitHub
                 ↓
        Deploy/apply to Supabase
                 ↓
        Verify deployment
                 ↓
        Report exact commit + deployment status
```

---

## 3. Database Changes Policy
- **NO UNVERSIONED SCHEMA EDITS**: Never make schema changes only in the Supabase Dashboard SQL Editor without committing a corresponding migration file in `supabase/migrations/`.
- **Idempotence**: Write migrations to be idempotent (`IF NOT EXISTS`, `OR REPLACE`) to prevent failure upon replay.
- **Production Data Preservation**: Preserve existing production records; never write destructive migrations (`DROP TABLE`, `TRUNCATE`) unless explicitly authorized by the project lead.
- **Order of Execution**: Commit the migration to Git before or together with applying to Supabase.
- **Verification**: Verify remote database schema reflects the migration.

---

## 4. Edge Functions Policy
- Authoritative source directory is `supabase/functions/`.
- Every deployed function must match the version-controlled source in Git.
- Before deployment: update source, validate TypeScript/Deno types, commit to Git, deploy to Supabase, and verify invocation.

---

## 5. Storage Infrastructure Policy
- Bucket definitions, MIME type restrictions, file-size limits, and Storage RLS policies must be versioned in `supabase/migrations/` and `supabase/config.toml`.
- **Infrastructure ONLY**: This policy versions bucket definitions and access rules. Real user-uploaded photos, PDFs, or private documents must NEVER be committed to Git.

---

## 6. Secrets Management
- **NEVER COMMIT SECRETS**: Do NOT commit `SUPABASE_SERVICE_ROLE_KEY`, private tokens, OAuth secrets, database passwords, or private keys to Git.
- **No Client Exposure**: Never expose backend secrets through `VITE_*` variables or browser bundles.
- Document required environment variable names in `.env.example` without values.

---

## 7. Production Data vs. Code Versioning
- Version control tracks backend code, schemas, policies, and configuration.
- Production data backup is distinct and handled separately.
- Do NOT export or commit production user records to Git.

---

## 8. Failure & Stop Rule
If a backend modification cannot be safely versioned in GitHub:
- **STOP immediately** before modifying the live database or deploying functions.
- Report: `"BACKEND CHANGE BLOCKED — VERSION CONTROL NOT READY"` and describe the blocking issue.

---

## 9. Verification Standard
- Never claim "versioned", "deployed", or "verified" unless the action was actually executed and confirmed.
- If an operation was not executed or verified, explicitly report `NOT EXECUTED` or `NOT VERIFIED`.

---

## 10. Immutability
This policy applies automatically to all future tasks and feature work. It cannot be weakened, bypassed, or removed.
