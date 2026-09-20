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
| `20260909_raydar_auth_and_onboarding_finalization.sql` | Authoritative email verification table, profile RPC, anti-bypass security | `email_verifications`, `rpc_create_or_update_profile`, `rpc_verify_email_code` |
| `20260910_update_missing_reports_verification_and_storage.sql` | Legal documents & evidence URLs columns on missing_reports, report-evidence bucket | Document URLs, `report-evidence` storage policies |
| `20260911_update_found_reports_schema_and_policies.sql` | Dedicated `found-reports` storage bucket and schema synchronization | `found_reports` columns, `found-reports` bucket, RLS policies |
| `20260912_fix_found_reports_constraints.sql` | Foreign key alignment and service_role administrative overrides | FK constraints, `service_role` security policies |
| `20260913_storage_policies_and_report_defaults.sql` | Storage RLS expansion for authenticated user paths | Storage path policies `{auth.uid()}/...` |
| `20260918_egress_optimization_and_thumbnails.sql` | Egress optimization, client-side compression & thumbnail storage paths | Thumbnail storage paths, cache headers |
| `20260919_temporary_development_retention.sql` | In-memory client-side retention ceiling and sync helpers | In-memory query buffers |
| `20260920_profile_preferences_and_account_lifecycle.sql` | Profile preferences, phone code, and account lifecycle tracking | Account deletion / suspension flags |

### Applying Migrations
With Supabase CLI:
```bash
# Link local project to Supabase Cloud
supabase link --project-ref ifpbdythbhlgqymsaxtz

# Push pending migrations
supabase db push
```

---

## 3. Storage Buckets

| Bucket Name | Access | Max Size | Allowed MIME Types | Intended Use |
|---|---|---|---|---|
| `avatars` | Public | 10 MB | JPEG, PNG, WEBP, GIF, SVG, PDF | User avatars, general media |
| `missing-reports` | Public | 10 MB | JPEG, PNG, WEBP, GIF, SVG | Missing child main and additional photos |
| `found-reports` | Public | 10 MB | JPEG, PNG, WEBP, GIF, SVG | Found child photos taken by finders |
| `report-evidence` | Authenticated | 10 MB | PDF, JPEG, PNG, WEBP | Official birth certificates & legal verification docs |

---

## 4. Edge Functions

Source directory: `/supabase/functions`

| Function Name | Verification | Purpose |
|---|---|---|
| `create-missing-report` | `verify_jwt = false` | Creates missing child reports, validates input, and creates broadcast alerts. |
| `create-found-report` | `verify_jwt = false` | Creates found child reports strictly in `found_reports` table, creates broadcast alerts. |
| `matching-engine` | `verify_jwt = false` | Compares missing reports with found reports using similarity weighting (gender, location, clothing, physical description). |
| `ai-analysis` | `verify_jwt = false` | Analyzes biometric facial similarity and clothing matches. |
| `broadcast-alert` | `verify_jwt = false` | Emits emergency and community alerts to the `alerts` table. |
| `admin-action` | `verify_jwt = false` | Administrative operations (moderation status changes, system counts). Enforces admin privileges. |
| `email-verification` | `verify_jwt = false` | Authoritative 6-digit verification code generation, multi-provider email dispatch (Resend/Brevo/SendGrid/Postmark), and code validation. |

### Deploying Edge Functions
```bash
supabase functions deploy create-missing-report --no-verify-jwt
supabase functions deploy create-found-report --no-verify-jwt
supabase functions deploy matching-engine --no-verify-jwt
supabase functions deploy ai-analysis --no-verify-jwt
supabase functions deploy broadcast-alert --no-verify-jwt
supabase functions deploy admin-action --no-verify-jwt
supabase functions deploy email-verification --no-verify-jwt
```

### Automated Backend Drift Audit
To detect any drift between versioned code in Git and live Supabase Cloud:
```bash
npm run audit:backend
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
