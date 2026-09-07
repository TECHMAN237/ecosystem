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
