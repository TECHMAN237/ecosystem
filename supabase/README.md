# RAYDAR — Supabase Backend Documentation & Recovery Guide

## 1. Project Reference & Topology
- **Supabase Project URL**: `https://ifpbdythbhlgqymsaxtz.supabase.co`
- **Project Ref**: `ifpbdythbhlgqymsaxtz`
- **Runtime Environment**: Supabase Cloud (PostgreSQL 15, Supabase Auth, Supabase Storage, Edge Functions / Deno)
- **Source of Truth**: GitHub Repository (`/supabase`)

---

## 2. Database Migrations History

All migrations in `/supabase/migrations` are strictly additive and non-destructive:

| Migration File | Description | Components |
|---|---|---|
| `20260905_raydar_backend_schema.sql` | Core database schema, initial tables, RLS policies, and RPC search | `profiles`, `missing_reports`, `found_reports`, `alerts`, RLS, `rpc_search_reports` |
| `20260906_fix_avatars_and_profile_persistence.sql` | Profile persistence fixes, `onboarding_completed`, initial storage bucket | `onboarding_completed`, indexes, `avatars` bucket, `rpc_get_or_create_profile` |
| `20260907_create_storage_and_reporting_tables.sql` | 10MB storage expansion, PDF/SVG MIME types, public report submission RLS | Storage policies, public insert policies, status and date indexes |
| `20260908_backend_reconciliation_and_indexes.sql` | Query performance indexes, automatic `updated_at` triggers, search reconciliation | `set_current_timestamp_updated_at` triggers, `email` and `reporter_id` indexes |

### Applying Migrations
With Supabase CLI:
```bash
# Link local project to Supabase Cloud
supabase link --project-ref ifpbdythbhlgqymsaxtz

# Push pending migrations
supabase db push
```

Alternatively, run each migration file sequentially in the Supabase SQL Editor:
1. `20260905_raydar_backend_schema.sql`
2. `20260906_fix_avatars_and_profile_persistence.sql`
3. `20260907_create_storage_and_reporting_tables.sql`
4. `20260908_backend_reconciliation_and_indexes.sql`

---

## 3. Storage Buckets

| Bucket Name | Access | Max Size | Allowed MIME Types | Intended Use |
|---|---|---|---|---|
| `avatars` | Public | 10 MB | JPEG, PNG, WEBP, GIF, SVG, PDF | User avatars, missing/found child photos, supporting verification documents |

### Storage Policies
- **SELECT**: Public read access to all objects in `avatars`.
- **INSERT**: Authenticated and community anonymous uploads allowed.
- **UPDATE**: Object overwrite / update enabled.
- **DELETE**: Object removal enabled.

---

## 4. Edge Functions

Source directory: `/supabase/functions`

| Function Name | Verification | Purpose |
|---|---|---|
| `create-missing-report` | `verify_jwt = false` | Creates missing child reports, validates input, and creates broadcast alerts. |
| `create-found-report` | `verify_jwt = false` | Creates found child reports, mirrors into `missing_reports` (status 'Trouvé'), creates broadcast alerts. |
| `matching-engine` | `verify_jwt = false` | Compares missing reports with found reports using similarity weighting (gender, location, clothing, physical description). |
| `ai-analysis` | `verify_jwt = false` | Analyzes biometric facial similarity and clothing matches. |
| `broadcast-alert` | `verify_jwt = false` | Emits emergency and community alerts to the `alerts` table. |
| `admin-action` | `verify_jwt = false` | Administrative operations (moderation status changes, system counts). Enforces `is_admin` or `role` check via user JWT. |

### Deploying Edge Functions
```bash
supabase functions deploy create-missing-report --no-verify-jwt
supabase functions deploy create-found-report --no-verify-jwt
supabase functions deploy matching-engine --no-verify-jwt
supabase functions deploy ai-analysis --no-verify-jwt
supabase functions deploy broadcast-alert --no-verify-jwt
supabase functions deploy admin-action --no-verify-jwt
```

### Edge Function Secrets
Set via Supabase Dashboard (`Project Settings -> Edge Functions -> Secrets`) or CLI:
```bash
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

---

## 5. Production Data vs Backend Code

> **CRITICAL DISTINCTION**:
> GitHub migrations and configuration files version the **database structure, schema, policies, triggers, and functions**.
> They do **NOT** back up production data:
> - User account rows in `auth.users`
> - User profiles in `public.profiles`
> - Active child reports in `public.missing_reports` and `public.found_reports`
> - Uploaded photos and PDF documents in the `avatars` storage bucket
>
> A separate automated data backup (e.g. daily Supabase Database Backups / WAL-G / pg_dump) is required for disaster recovery of user-submitted content.
