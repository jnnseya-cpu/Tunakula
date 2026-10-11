-- Per-customer language (§AI + i18n). We remember the language each person uses the app in, so the AI agents
-- write to them in their own language — the win-back message in the growth agent, and the suggested reply to
-- their review — instead of defaulting to the market language. Captured at sign-in and whenever they switch the
-- app language; nullable, so "unknown" falls back to the market default. Additive.
ALTER TABLE identity.app_user ADD COLUMN locale text;
