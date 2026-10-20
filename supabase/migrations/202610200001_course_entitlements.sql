-- CyberShield payment entitlements: server-written, user-readable only.
create extension if not exists pgcrypto;

create table if not exists public.course_entitlements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan text not null check (plan in ('monthly-premium', 'full-course')),
  status text not null default 'active' check (status in ('active', 'expired', 'revoked')),
  expires_at timestamptz,
  razorpay_order_id text,
  razorpay_payment_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.course_entitlements add column if not exists id uuid default gen_random_uuid();
alter table public.course_entitlements add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table public.course_entitlements add column if not exists plan text;
alter table public.course_entitlements add column if not exists status text not null default 'active';
alter table public.course_entitlements add column if not exists expires_at timestamptz;
alter table public.course_entitlements add column if not exists razorpay_order_id text;
alter table public.course_entitlements add column if not exists razorpay_payment_id text;
alter table public.course_entitlements add column if not exists created_at timestamptz not null default now();
alter table public.course_entitlements add column if not exists updated_at timestamptz not null default now();

-- Keep the latest row for each user/plan before adding the unique key.
with ranked as (
  select ctid, row_number() over (
    partition by user_id, plan order by updated_at desc nulls last, created_at desc nulls last, ctid desc
  ) as rn
  from public.course_entitlements
  where user_id is not null and plan is not null
)
delete from public.course_entitlements e using ranked r
where e.ctid = r.ctid and r.rn > 1;

create unique index if not exists course_entitlements_user_plan_uidx
  on public.course_entitlements(user_id, plan);
create unique index if not exists course_entitlements_payment_uidx
  on public.course_entitlements(razorpay_payment_id)
  where razorpay_payment_id is not null;
create index if not exists course_entitlements_user_status_idx
  on public.course_entitlements(user_id, status);

alter table public.course_entitlements enable row level security;

-- Remove prior policies on this payment table so an old permissive policy
-- cannot allow users to write their own paid entitlements.
do $$
declare p record;
begin
  for p in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'course_entitlements'
  loop
    execute format('drop policy if exists %I on public.course_entitlements', p.policyname);
  end loop;
end $$;

create policy "Users can read their own entitlements"
  on public.course_entitlements for select to authenticated
  using (auth.uid() = user_id);

revoke insert, update, delete, truncate, references, trigger
  on public.course_entitlements from anon, authenticated;
grant select on public.course_entitlements to authenticated;
grant all on public.course_entitlements to service_role;
