-- Interview purchases paid online (Stripe Checkout).
-- A paid purchase adds `quantity` interviews to the company's balance (organizations.interview_quota).
-- Purchased interviews are valid for 12 months: when a purchase expires, whatever is left of it
-- (older interviews are used first) is taken off the balance. Refunds take unused interviews back.
select set_config('app.system', 'on', true);

create table purchases (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  user_id uuid references users(id) on delete set null,
  quantity integer not null check (quantity > 0),
  unit_cents integer not null check (unit_cents > 0),
  total_cents integer not null check (total_cents > 0),
  currency text not null default 'usd',
  status text not null default 'pending' check (status in ('pending', 'paid', 'failed', 'expired', 'refunded', 'partially_refunded')),
  stripe_session_id text unique,
  stripe_payment_intent text,
  receipt_url text,
  -- Interviews this purchase still adds to the balance (quantity, less refunds and expiry).
  interviews_added integer not null default 0 check (interviews_added >= 0),
  interviews_expired integer not null default 0 check (interviews_expired >= 0),
  refunded_cents integer not null default 0 check (refunded_cents >= 0),
  terms_version text,
  paid_at timestamptz,
  expires_at timestamptz,
  expired_at timestamptz,
  created_at timestamptz not null default now()
);
create index purchases_org_idx on purchases(organization_id, created_at desc);
create index purchases_expiring_idx on purchases(organization_id, expires_at) where status in ('paid', 'partially_refunded') and expired_at is null;
create index purchases_payment_intent_idx on purchases(stripe_payment_intent) where stripe_payment_intent is not null;

alter table purchases enable row level security;
alter table purchases force row level security;
create policy tenant_isolation on purchases
  using (app_is_system() or organization_id = app_current_org())
  with check (app_is_system() or organization_id = app_current_org());

-- Stripe events already handled, so a retried webhook never adds interviews twice.
create table stripe_events (
  id text primary key,
  type text not null,
  received_at timestamptz not null default now()
);
alter table stripe_events enable row level security;
alter table stripe_events force row level security;
create policy system_only on stripe_events using (app_is_system()) with check (app_is_system());
