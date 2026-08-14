CREATE TABLE IF NOT EXISTS customers (
  id BIGSERIAL PRIMARY KEY,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  phone TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  wilaya_code TEXT NOT NULL,
  wilaya_name TEXT NOT NULL,
  commune TEXT NOT NULL,
  address TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS admins (
  id BIGSERIAL PRIMARY KEY,
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS admins_email_lower_unique ON admins (LOWER(email));

CREATE TABLE IF NOT EXISTS admin_sessions (
  id BIGSERIAL PRIMARY KEY,
  admin_id BIGINT NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  csrf_token TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS login_attempts (
  id BIGSERIAL PRIMARY KEY,
  email TEXT NOT NULL,
  ip TEXT NOT NULL,
  succeeded BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS products (
  id BIGSERIAL PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  short_description TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  price_cents BIGINT NOT NULL CHECK(price_cents >= 0),
  cost_cents BIGINT NOT NULL DEFAULT 0 CHECK(cost_cents >= 0),
  compare_at_cents BIGINT,
  currency TEXT NOT NULL DEFAULT 'DZD',
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','archived')),
  category TEXT NOT NULL DEFAULT 'Ensembles',
  badge TEXT,
  color TEXT NOT NULL DEFAULT '',
  colors_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  materials TEXT NOT NULL DEFAULT '',
  care TEXT NOT NULL DEFAULT '',
  source_url TEXT,
  source_data_json JSONB,
  images_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  color_images_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  sizes_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  variants_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  features_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  testimonials_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  translations_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  size_guide_image TEXT,
  seo_title TEXT,
  seo_description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS orders (
  id BIGSERIAL PRIMARY KEY,
  order_number TEXT NOT NULL UNIQUE,
  customer_name TEXT NOT NULL,
  customer_id BIGINT REFERENCES customers(id) ON DELETE SET NULL,
  first_name TEXT NOT NULL DEFAULT '',
  last_name TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL,
  city TEXT NOT NULL,
  wilaya_code TEXT NOT NULL DEFAULT '',
  wilaya_name TEXT NOT NULL DEFAULT '',
  commune TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  delivery_type TEXT NOT NULL DEFAULT 'home',
  delivery_external_id TEXT,
  delivery_sync_status TEXT NOT NULL DEFAULT 'not_configured',
  delivery_sync_error TEXT,
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'new',
  items_json JSONB NOT NULL,
  subtotal_cents BIGINT NOT NULL,
  shipping_cents BIGINT NOT NULL DEFAULT 0,
  total_cents BIGINT NOT NULL,
  stock_reserved BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS customer_sessions (
  id BIGSERIAL PRIMARY KEY,
  customer_id BIGINT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS delivery_rates (
  wilaya_code TEXT PRIMARY KEY,
  wilaya_name_fr TEXT NOT NULL,
  wilaya_name_ar TEXT NOT NULL DEFAULT '',
  home_cents BIGINT NOT NULL DEFAULT 0 CHECK(home_cents >= 0),
  office_cents BIGINT NOT NULL DEFAULT 0 CHECK(office_cents >= 0),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS app_settings (
  setting_key TEXT PRIMARY KEY,
  value_json JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS import_jobs (
  id BIGSERIAL PRIMARY KEY,
  source_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  error TEXT,
  extracted_json JSONB,
  product_id BIGINT REFERENCES products(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGSERIAL PRIMARY KEY,
  admin_id BIGINT REFERENCES admins(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  details_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS order_attempts (
  id BIGSERIAL PRIMARY KEY,
  ip TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS schema_migrations (
  name TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS visits (
  id BIGSERIAL PRIMARY KEY,
  visitor_hash TEXT NOT NULL,
  path TEXT NOT NULL,
  product_id BIGINT REFERENCES products(id) ON DELETE SET NULL,
  visit_day DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(visitor_hash, path, visit_day)
);

CREATE TABLE IF NOT EXISTS order_status_history (
  id BIGSERIAL PRIMARY KEY,
  order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  changed_by_admin_id BIGINT REFERENCES admins(id) ON DELETE SET NULL,
  reason_code TEXT,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS whatsapp_webhook_events (
  message_id TEXT PRIMARY KEY,
  sender_phone TEXT NOT NULL,
  action TEXT NOT NULL,
  order_number TEXT,
  order_id BIGINT REFERENCES orders(id) ON DELETE SET NULL,
  result TEXT NOT NULL DEFAULT 'processing',
  outbound_claimed_at TIMESTAMPTZ,
  outbound_sent_at TIMESTAMPTZ,
  provider_message_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS product_costs (
  id BIGSERIAL PRIMARY KEY,
  product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  cost_cents BIGINT NOT NULL CHECK(cost_cents >= 0),
  effective_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  effective_to TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS expenses (
  id BIGSERIAL PRIMARY KEY,
  category TEXT NOT NULL,
  amount_cents BIGINT NOT NULL CHECK(amount_cents >= 0),
  currency TEXT NOT NULL DEFAULT 'DZD',
  recurrence TEXT NOT NULL DEFAULT 'one_time' CHECK(recurrence IN ('one_time','recurring')),
  cost_type TEXT NOT NULL DEFAULT 'fixed' CHECK(cost_type IN ('fixed','variable')),
  effective_from DATE NOT NULL,
  effective_to DATE,
  allocation_method TEXT NOT NULL DEFAULT 'revenue_weighted' CHECK(allocation_method IN ('revenue_weighted','even_split')),
  notes TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'manual',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS order_refunds (
  id BIGSERIAL PRIMARY KEY,
  order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  amount_cents BIGINT NOT NULL CHECK(amount_cents > 0),
  reason TEXT NOT NULL DEFAULT '',
  created_by_admin_id BIGINT REFERENCES admins(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS order_delivery_costs (
  order_id BIGINT PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,
  carrier_cost_cents BIGINT NOT NULL DEFAULT 0 CHECK(carrier_cost_cents >= 0),
  return_cost_cents BIGINT NOT NULL DEFAULT 0 CHECK(return_cost_cents >= 0),
  source TEXT NOT NULL DEFAULT 'manual',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Deduplication ledger. The unique event_id is what stops one order transition from
-- becoming two Meta conversions across refreshes, retries and repeated callbacks.
CREATE TABLE IF NOT EXISTS meta_events (
  id BIGSERIAL PRIMARY KEY,
  event_id TEXT NOT NULL UNIQUE,
  event_name TEXT NOT NULL,
  order_id BIGINT REFERENCES orders(id) ON DELETE SET NULL,
  action_source TEXT NOT NULL DEFAULT 'website',
  pixel_sent_at TIMESTAMPTZ,
  capi_sent_at TIMESTAMPTZ,
  capi_status INTEGER,
  capi_error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Attribution touch points. No personal data: click ids and campaign tags only.
-- One row per order, holding both the first and the last campaign touch.
CREATE TABLE IF NOT EXISTS meta_attribution (
  id BIGSERIAL PRIMARY KEY,
  order_id BIGINT UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
  visitor_hash TEXT,
  fbclid TEXT,
  fbc TEXT,
  fbp TEXT,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  utm_content TEXT,
  utm_term TEXT,
  landing_page TEXT,
  referrer TEXT,
  first_fbclid TEXT,
  first_utm_source TEXT,
  first_utm_medium TEXT,
  first_utm_campaign TEXT,
  first_landing_page TEXT,
  first_referrer TEXT,
  -- Resolved once at order time so reporting never re-derives it from raw fields.
  is_meta_last_touch BOOLEAN NOT NULL DEFAULT FALSE,
  is_meta_first_touch BOOLEAN NOT NULL DEFAULT FALSE,
  first_touch_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_touch_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Daily Meta Ads insights. One row per (date, level, entity), upserted idempotently so a
-- re-sync of the same day overwrites rather than duplicating. Attribution keeps moving for
-- several days after the fact, which is why recent dates are refreshed on every run.
CREATE TABLE IF NOT EXISTS meta_ads_insights_daily (
  id BIGSERIAL PRIMARY KEY,
  date DATE NOT NULL,
  level TEXT NOT NULL CHECK(level IN ('account','campaign','adset','ad')),
  entity_id TEXT NOT NULL,
  entity_name TEXT NOT NULL DEFAULT '',
  account_id TEXT NOT NULL DEFAULT '',
  campaign_id TEXT,
  campaign_name TEXT,
  adset_id TEXT,
  adset_name TEXT,
  ad_id TEXT,
  ad_name TEXT,
  status TEXT,
  objective TEXT,
  optimization_goal TEXT,
  attribution_setting TEXT,
  account_timezone TEXT,
  -- Money is stored in the AD ACCOUNT's currency, in minor units. It is not converted to DZD
  -- here: conversion needs a dated rate, which is a reporting-layer concern.
  currency TEXT NOT NULL DEFAULT '',
  spend_minor BIGINT NOT NULL DEFAULT 0,
  purchase_value_minor BIGINT NOT NULL DEFAULT 0,
  cpc_minor BIGINT,
  cpm_minor BIGINT,
  cost_per_purchase_minor BIGINT,
  impressions BIGINT NOT NULL DEFAULT 0,
  reach BIGINT NOT NULL DEFAULT 0,
  frequency NUMERIC(12,6),
  clicks BIGINT NOT NULL DEFAULT 0,
  link_clicks BIGINT NOT NULL DEFAULT 0,
  outbound_clicks BIGINT NOT NULL DEFAULT 0,
  unique_clicks BIGINT NOT NULL DEFAULT 0,
  ctr NUMERIC(12,6),
  landing_page_views BIGINT NOT NULL DEFAULT 0,
  leads BIGINT NOT NULL DEFAULT 0,
  adds_to_cart BIGINT NOT NULL DEFAULT 0,
  checkouts BIGINT NOT NULL DEFAULT 0,
  purchases BIGINT NOT NULL DEFAULT 0,
  purchase_roas NUMERIC(14,6),
  video_views BIGINT NOT NULL DEFAULT 0,
  thruplays BIGINT NOT NULL DEFAULT 0,
  video_p25 BIGINT NOT NULL DEFAULT 0,
  video_p50 BIGINT NOT NULL DEFAULT 0,
  video_p75 BIGINT NOT NULL DEFAULT 0,
  video_p100 BIGINT NOT NULL DEFAULT 0,
  -- Full action breakdowns, parsed by action_type at read time. Never index into these by position.
  actions_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  action_values_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(date, level, entity_id)
);

-- Freshness and failure tracking per sync job, so stale data is visible instead of silent.
CREATE TABLE IF NOT EXISTS meta_sync_state (
  sync_key TEXT PRIMARY KEY,
  last_run_at TIMESTAMPTZ,
  last_success_at TIMESTAMPTZ,
  last_error TEXT,
  last_result_json JSONB,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Cached Groq explanations. Deterministic KPIs and decisions remain the source of truth;
-- this table only avoids regenerating narrative text for unchanged campaign inputs.
CREATE TABLE IF NOT EXISTS campaign_ai_analyses (
  fingerprint TEXT PRIMARY KEY,
  entity_level TEXT NOT NULL CHECK(entity_level IN ('campaign','adset','ad')),
  entity_id TEXT NOT NULL,
  period_since DATE NOT NULL,
  period_until DATE NOT NULL,
  deterministic_status TEXT NOT NULL CHECK(deterministic_status IN ('SCALE','KEEP','WATCH','KILL')),
  model TEXT,
  analysis_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

-- Per-product catalog sync state, including the failure reason for items Meta rejected.
CREATE TABLE IF NOT EXISTS meta_catalog_items (
  product_id BIGINT PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
  retailer_id TEXT NOT NULL,
  content_hash TEXT NOT NULL DEFAULT '',
  last_synced_at TIMESTAMPTZ,
  last_method TEXT,
  last_error TEXT,
  UNIQUE(retailer_id)
);

-- One Facebook Page post per product. The row is claimed before calling Meta so two
-- simultaneous saves cannot publish the same product twice. Failed/pending attempts are
-- retried only through the explicit admin action, not every time a product is edited.
CREATE TABLE IF NOT EXISTS meta_product_page_posts (
  product_id BIGINT PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
  page_id TEXT NOT NULL,
  post_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','published','failed')),
  attempt_count INTEGER NOT NULL DEFAULT 1 CHECK(attempt_count > 0),
  last_error TEXT,
  posted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One Instagram post per product, independent from the Facebook Page post ledger.
CREATE TABLE IF NOT EXISTS meta_product_instagram_posts (
  product_id BIGINT PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL,
  post_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','published','failed')),
  attempt_count INTEGER NOT NULL DEFAULT 1 CHECK(attempt_count > 0),
  last_error TEXT,
  posted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Dated exchange rates. The Meta ad account is not billed in DZD, so spend must be converted
-- with the rate that applied on the spend date. A missing rate is never treated as 1.0 or 0:
-- the KPI layer reports the period as incomplete instead of inventing a number.
CREATE TABLE IF NOT EXISTS fx_rates (
  rate_date DATE NOT NULL,
  currency TEXT NOT NULL,
  dzd_per_unit NUMERIC(18,6) NOT NULL CHECK(dzd_per_unit > 0),
  source TEXT NOT NULL DEFAULT 'manual',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (rate_date, currency)
);

CREATE INDEX IF NOT EXISTS idx_products_status ON products(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON admin_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_attempts_lookup ON login_attempts(email, ip, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_order_attempts ON order_attempts(ip, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_visits_created ON visits(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_customer_sessions_expiry ON customer_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);
CREATE INDEX IF NOT EXISTS idx_order_status_history_order ON order_status_history(order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_whatsapp_webhook_events_order ON whatsapp_webhook_events(order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_product_costs_lookup ON product_costs(product_id, effective_from DESC);
CREATE INDEX IF NOT EXISTS idx_order_refunds_order ON order_refunds(order_id);
CREATE INDEX IF NOT EXISTS idx_expenses_effective ON expenses(effective_from DESC);
CREATE INDEX IF NOT EXISTS idx_meta_events_order ON meta_events(order_id);
CREATE INDEX IF NOT EXISTS idx_meta_events_created ON meta_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_meta_attribution_order ON meta_attribution(order_id);
CREATE INDEX IF NOT EXISTS idx_meta_attribution_visitor ON meta_attribution(visitor_hash);
CREATE INDEX IF NOT EXISTS idx_meta_insights_date ON meta_ads_insights_daily(date DESC, level);
CREATE INDEX IF NOT EXISTS idx_meta_insights_campaign ON meta_ads_insights_daily(campaign_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_meta_catalog_items_synced ON meta_catalog_items(last_synced_at);
CREATE INDEX IF NOT EXISTS idx_meta_product_page_posts_status ON meta_product_page_posts(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_meta_product_instagram_posts_status ON meta_product_instagram_posts(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_campaign_ai_entity ON campaign_ai_analyses(entity_level, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_campaign_ai_expiry ON campaign_ai_analyses(expires_at);
