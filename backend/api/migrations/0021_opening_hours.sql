-- Merchant opening hours: a weekly schedule and date overrides (holidays / special hours). Additive —
-- an empty schedule means always open (today's behaviour), so existing branches are unaffected. A branch
-- is open to order only when its status is OPEN *and* the current local time falls in an open window.
ALTER TABLE catalogue.branch
  ADD COLUMN hours jsonb NOT NULL DEFAULT '{}',          -- { "0".."6": [["08:00","22:00"], ...] }  weekday 0=Sunday, local time
  ADD COLUMN special_hours jsonb NOT NULL DEFAULT '{}';  -- { "2026-12-25": [] (closed) | [["10:00","14:00"]] }  by local date
