-- CyberShield payment entitlements. Safe to apply to a fresh project or
-- upgrade the earlier prototype schema that only allowed full-course purchases.
create extension if not exists pgcrypto;

create table if not exists public.course_entitlements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan text not null,
  status text not null default 'active',
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

-- Remove legacy plan/status checks before installing the current plan set.
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.course_entitlements'::regclass
      and contype = 'c'
      and (pg_get_constraintdef(oid) ilike '%plan%' or pg_get_constraintdef(oid) ilike '%status%')
  loop
    execute format('alter table public.course_entitlements drop constraint %I', c.conname);
  end loop;
end $$;

-- The old prototype keyed one row per user; the new model is one row per user and plan.
alter table public.course_entitlements
  add constraint course_entitlements_plan_check check (plan in ('monthly-premium','full-course')),
  add constraint course_entitlements_status_check check (status in ('active','expired','revoked'));

do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.course_entitlements'::regclass
      and contype = 'u'
      and pg_get_constraintdef(oid) ilike '%user_id%'
      and pg_get_constraintdef(oid) not ilike '%plan%'
  loop
    execute format('alter table public.course_entitlements drop constraint %I', c.conname);
  end loop;
end $$;

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
  on public.course_entitlements(razorpay_payment_id) where razorpay_payment_id is not null;
create index if not exists course_entitlements_user_status_idx
  on public.course_entitlements(user_id, status);

alter table public.course_entitlements enable row level security;
do $$
declare p record;
begin
  for p in select policyname from pg_policies where schemaname='public' and tablename='course_entitlements'
  loop execute format('drop policy if exists %I on public.course_entitlements', p.policyname); end loop;
end $$;
create policy "Users can read their own entitlements" on public.course_entitlements
  for select to authenticated using ((select auth.uid()) = user_id);
revoke all on public.course_entitlements from public, anon, authenticated;
grant select on public.course_entitlements to authenticated;
grant all on public.course_entitlements to service_role;

create table if not exists public.course_payment_receipts (
  payment_id text primary key,
  order_id text not null unique,
  user_id uuid not null references auth.users(id) on delete cascade,
  plan text not null check (plan in ('monthly-premium','full-course')),
  expires_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.course_payment_receipts enable row level security;
do $$
declare p record;
begin
  for p in select policyname from pg_policies where schemaname='public' and tablename='course_payment_receipts'
  loop execute format('drop policy if exists %I on public.course_payment_receipts', p.policyname); end loop;
end $$;
revoke all on public.course_payment_receipts from public, anon, authenticated;
grant all on public.course_payment_receipts to service_role;

-- Legacy client-accessible payment table is not used by the current functions.
alter table public.cybershield_payments enable row level security;
revoke all on public.cybershield_payments from public, anon, authenticated;
grant all on public.cybershield_payments to service_role;
