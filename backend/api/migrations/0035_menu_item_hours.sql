-- Menu/price scheduling (dayparting): a dish can be made orderable only during set windows — a breakfast
-- item 07:00–11:00, a lunch special 12:00–15:00. Same shape as branch opening hours: a weekly schedule keyed
-- by weekday (0=Sunday) of [open, close] HH:MM windows in the branch's local time. Additive: an empty schedule
-- (the default) means the dish is always available, so existing items behave exactly as before.

ALTER TABLE catalogue.menu_item ADD COLUMN IF NOT EXISTS availability_hours jsonb NOT NULL DEFAULT '{}';
