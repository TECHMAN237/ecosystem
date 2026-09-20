# 🛡️ RAYDAR — Official Backend Architecture & Source of Truth Manual

---

## 1. Executive Summary & Core Mandate

**GOOGLE AI STUDIO / LOCAL ≠ PRODUCTION**

- **Development Workspace**: Google AI Studio / Local Environment. Used for code authoring, local linting, and rapid UI iteration.
- **Code Source of Truth**: GitHub Repository (`github.com/...`). Contains all version-controlled migrations, Edge Functions, configuration, and frontend source code.
- **Production Backend**: Supabase Cloud (`https://ifpbdythbhlgqymsaxtz.supabase.co` - Project Ref: `ifpbdythbhlgqymsaxtz`).
- **Production Frontend**: Vercel. Static web client consuming Supabase APIs, Edge Functions, Auth, and Storage.

> **CRITICAL RULE**: A backend feature is NEVER considered "DONE" merely because it works locally or in Google AI Studio. It must be versioned in GitHub, deployed to Supabase Cloud, and validated on Vercel production.

---

## 2. Infrastructure & Topology Map

```
┌─────────────────────────────────────────────────────────────┐
│                 GOOGLE AI STUDIO / LOCAL                    │
│                 (Development Workspace)                     │
└──────────────────────────────┬──────────────────────────────┘
                               │ git commit & push
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                      GITHUB REPOSITORY                      │
│                  (CODE SOURCE OF TRUTH)                     │
│  - supabase/migrations/     - supabase/functions/           │
│  - supabase/config.toml     - .github/workflows/            │
└──────────────────────────────┬──────────────────────────────┘
                               │ CI/CD / Supabase CLI Deploy
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                 SUPABASE CLOUD (PRODUCTION)                 │
│                 Project: ifpbdythbhlgqymsaxtz               │
│                                                             │
│  ├── PostgreSQL Database (Tables, RLS, RPC, Triggers)       │
│  ├── Supabase Storage (avatars, missing-reports, etc.)      │
│  ├── Supabase Auth (auth.users, Session JWTs)               │
│  └── Edge Functions (Deno / Serverless API)                 │
└──────────────────────────────┬──────────────────────────────┘
                               │ Live API Consumption
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                 VERCEL (PRODUCTION FRONTEND)                │
│                 (Mobile & Desktop Web Client)               │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. Directory & Versioning Structure

```
supabase/
├── config.toml                 # Supabase CLI configuration & function JWT rules
├── README.md                   # Supabase operations & manual deployment guide
├── BACKEND_VERSION_CONTROL_POLICY.md # Permanent policy
├── migrations/                 # All DDL, tables, RLS, functions, triggers
│   ├── 20260905_raydar_backend_schema.sql
│   ├── 20260906_fix_avatars_and_profile_persistence.sql
│   ├── 20260907_create_storage_and_reporting_tables.sql
│   ├── 20260908_backend_reconciliation_and_indexes.sql
│   ├── 20260909_raydar_auth_and_onboarding_finalization.sql
│   ├── 20260910_update_missing_reports_verification_and_storage.sql
│   ├── 20260911_update_found_reports_schema_and_policies.sql
│   ├── 20260912_fix_found_reports_constraints.sql
│   ├── 20260913_storage_policies_and_report_defaults.sql
│   ├── 20260918_egress_optimization_and_thumbnails.sql
│   ├── 20260919_temporary_development_retention.sql
│   └── 20260920_profile_preferences_and_account_lifecycle.sql
└── functions/                  # Supabase Edge Functions (TypeScript / Deno)
    ├── _shared/
    │   ├── cors.ts
    │   └── supabaseClient.ts
    ├── create-missing-report/
    ├── create-found-report/
    ├── matching-engine/
    ├── ai-analysis/
    ├── broadcast-alert/
    ├── admin-action/
    └── email-verification/
```

---

## 4. Edge Functions Inventory & Purpose

| Function Name | Invocations | Purpose | Primary Tables |
|---|---|---|---|
| `create-missing-report` | Frontend `reportService.js` | Authoritative missing child report creation, photo validation, emergency alert trigger | `missing_reports`, `alerts` |
| `create-found-report` | Frontend `reportService.js` | Authoritative found child report creation, photo validation, community notification | `found_reports`, `alerts` |
| `matching-engine` | Frontend `ai_smart_matching.html` | Cross-compares missing vs found reports with multi-criteria weighted scoring | `missing_reports`, `found_reports` |
| `ai-analysis` | Smart Match detail modal | Evaluates biometric facial structure & clothing overlap | - |
| `broadcast-alert` | Alert Center & emergency flows | Dispatches community alerts across geographical radii | `alerts` |
| `admin-action` | Admin Dashboard | Admin moderation, report status overrides, system analytics | `missing_reports`, `found_reports`, `profiles` |
| `email-verification` | Auth & Onboarding | Authoritative 6-digit OTP code generation, dispatch (Resend/Brevo), validation | `email_verifications`, `profiles` |

---

## 5. Storage Buckets Specification

| Bucket Name | Access | Max Size | Allowed MIME Types | Usage |
|---|---|---|---|---|
| `avatars` | Public | 10 MB | Image & PDF formats | Profile pictures & avatar media |
| `missing-reports` | Public | 10 MB | JPEG, PNG, WEBP, GIF, SVG | Missing child main and additional photos |
| `found-reports` | Public | 10 MB | JPEG, PNG, WEBP, GIF, SVG | Found child photos taken by finders |
| `report-evidence` | Authenticated | 10 MB | PDF, JPEG, PNG, WEBP | Official birth certificates & legal verification docs |

---

## 6. Drift Detection System

To audit and verify synchronization between the local/Git source code and remote Supabase Cloud:

```bash
npm run audit:backend
```

This automated script inspects:
1. All declared Edge Functions against the live Supabase Edge runtime (detecting 404s).
2. Database tables and columns against PostgREST schema cache.
3. Storage buckets and object access policies.
4. Versioned SQL migrations.

---

## 7. Mandatory Workflow for Adding Future Backend Features

When developing ANY new backend feature (e.g., *Wearables, Payments, Matching Engine v2, Push Notifications, Device Monitoring*):

1. **Schema Design**: Write idempotent SQL in `supabase/migrations/YYYYMMDD_<feature>.sql`.
2. **RLS Hardening**: Enforce strict Row Level Security rules on all tables.
3. **Edge Function**: Implement logic in `supabase/functions/<feature>/index.ts` with Deno/TypeScript.
4. **Configuration**: Declare function in `supabase/config.toml`.
5. **Local Validation**: Test with `npm run audit:backend` and local test runners.
6. **Git Commit**: Commit all files into GitHub repository.
7. **Supabase Deployment**: Deploy migrations and Edge Functions via Supabase CLI.
8. **Remote Verification**: Re-run `npm run audit:backend` to confirm 0 drift.
9. **Production E2E Testing**: Verify on Vercel production using both desktop and physical mobile devices.
