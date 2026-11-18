-- A company's own interview prices, set by the platform admin (null = standard pricing).
-- Shape: {"tiers": [{"min": 10, "cents": 249}, ...], "note": "Agency deal"}.
-- Standard pricing lives in platform_settings under the key 'pricing'.
alter table organizations add column pricing jsonb check (pricing is null or jsonb_typeof(pricing) = 'object');
