# 🛡️ RAYDAR — Permanent Backend Feature Checklist

> **RULE**: No backend feature or modification may be marked as "DONE" or "PRODUCTION READY" unless EVERY item on this checklist has been verified and checked.

---

## Pre-Implementation
- [ ] **1. Backend Need Identified**: Clarified whether feature requires PostgreSQL tables, columns, RPC, Edge Functions, or Storage.
- [ ] **2. No Ghost Architecture**: Verified that business logic belongs in Supabase (`supabase/functions/` or `supabase/migrations/`), NOT local-only memory or transient Express middleware.

## Database & Schema Versioning
- [ ] **3. Migration Created in Git**: Created idempotent SQL migration file in `supabase/migrations/YYYYMMDD_feature_name.sql`.
- [ ] **4. RLS Enforced**: Row Level Security enabled on all new tables with explicit policies (`SELECT`, `INSERT`, `UPDATE`, `DELETE`).
- [ ] **5. Identity Linked to Auth**: Tables use `REFERENCES auth.users(id)` or `public.profiles(id)` — never trust client input.
- [ ] **6. Indexes Added**: Added indexes for foreign keys, timestamps, and search columns.

## Edge Functions & Serverless Logic
- [ ] **7. Edge Function Source in Git**: Created in `supabase/functions/<function-name>/index.ts` with CORS and error handling.
- [ ] **8. Configured in `config.toml`**: Added `[functions.<function-name>]` block with `verify_jwt` specified.
- [ ] **9. Secrets Documented**: Required secret variable names listed in `.env.example` (never values).
- [ ] **10. Zero Base64 in Database**: Binary files stored in Supabase Storage buckets with public URL reference in DB.

## Git & Deployment Execution
- [ ] **11. Git Commit & Push**: Changes committed and pushed to GitHub repository (Code Source of Truth).
- [ ] **12. Migration Applied to Supabase**: Applied to production Supabase project (`ifpbdythbhlgqymsaxtz`).
- [ ] **13. Edge Function Deployed**: Deployed to Supabase Cloud (`supabase functions deploy <name> --no-verify-jwt`).

## Production & Verification
- [ ] **14. Remote Deployment Verified**: Function returns non-404 status and database table is visible in schema cache.
- [ ] **15. Drift Audit Passed**: Ran `npm run audit:backend` and confirmed 0 drifts detected.
- [ ] **16. Frontend Connected**: Frontend service (`reportService.js`, `authService.js`, etc.) invokes the live remote endpoint.
- [ ] **17. Production Tested on Vercel**: Verified end-to-end functionality on live Vercel URL.
- [ ] **18. Mobile Device Tested**: Tested from a physical mobile browser to prevent environment-specific regressions.
- [ ] **19. Documentation Updated**: Updated `supabase/README.md` and feature documentation.
