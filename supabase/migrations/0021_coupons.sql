-- Promo codes from the platform admin: a company redeems one to add free interviews
-- and/or extend its free trial. Each company can use a code once, and so can each
-- person (kept as a one-way hash), so deleting a company and signing up again
-- doesn't allow a second use.
select set_config('app.system', 'on', true);

create table coupons (
  id uuid primary key default gen_random_uuid(),
  code citext not null unique check (code ~ '^[A-Z0-9_-]{4,32}$'),
  interviews integer not null default 0 check (interviews between 0 and 10000),
  trial_days integer not null default 0 check (trial_days between 0 and 365),
  max_uses integer check (max_uses is null or max_uses > 0),
  expires_at timestamptz,
  active boolean not null default true,
  note text check (char_length(note) <= 500),
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (interviews > 0 or trial_days > 0)
);

create table coupon_redemptions (
  id uuid primary key default gen_random_uuid(),
  coupon_id uuid not null references coupons(id) on delete cascade,
  organization_id uuid references organizations(id) on delete set null,
  user_id uuid references users(id) on delete set null,
  -- Kept after the company or person is deleted, for the history and the one-use rules.
  company_name text not null,
  email_hash text not null,
  interviews_added integer not null,
  trial_days_added integer not null,
  created_at timestamptz not null default now(),
  unique (coupon_id, organization_id),
  unique (coupon_id, email_hash)
);
create index coupon_redemptions_coupon_idx on coupon_redemptions(coupon_id, created_at desc);
create index coupon_redemptions_org_idx on coupon_redemptions(organization_id);

alter table coupons enable row level security;
alter table coupons force row level security;
create policy system_only on coupons using (app_is_system()) with check (app_is_system());
alter table coupon_redemptions enable row level security;
alter table coupon_redemptions force row level security;
create policy system_only on coupon_redemptions using (app_is_system()) with check (app_is_system());
