-- What the buyer actually paid in their own currency when Stripe converted the USD price at checkout
-- (Adaptive Pricing). Our price, checks and totals stay in USD (total_cents / currency); these are for display.
alter table purchases add column local_amount integer check (local_amount is null or local_amount >= 0);
alter table purchases add column local_currency text;
