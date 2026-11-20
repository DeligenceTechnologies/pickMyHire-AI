-- Company Stripe account: one Stripe customer per company (reused for every purchase), and the paid
-- invoice Stripe makes for each purchase (with the buyer's company name, billing address and tax ID), its number,
-- and how it was paid ("Visa •••• 4242").
select set_config('app.system', 'on', true);

alter table organizations add column stripe_customer_id text;
create unique index organizations_stripe_customer_idx on organizations(stripe_customer_id) where stripe_customer_id is not null;

alter table purchases
  add column stripe_invoice_id text,
  add column invoice_url text,
  add column invoice_pdf text,
  -- Shown to the buyer after paying and in their history, so they can quote it when they contact us.
  add column invoice_number text,
  add column payment_method text,
  -- Who paid, as they were then: kept even if the person later leaves or their account is deleted.
  add column bought_by_name text,
  add column bought_by_email text;

-- Payment records outlive a deleted company, for accounting and the admin Payments page: deleting the
-- company keeps its purchases (organization_id becomes null) with the company name saved here.
alter table purchases add column company_name text;
update purchases p set company_name = o.name from organizations o where o.id = p.organization_id;
alter table purchases alter column organization_id drop not null;
alter table purchases drop constraint purchases_organization_id_fkey;
alter table purchases add constraint purchases_organization_id_fkey foreign key (organization_id) references organizations(id) on delete set null;

