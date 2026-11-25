-- App release gate: the minimum and latest client version per app + platform, used to tell a client whether it
-- must update before it may keep talking to this backend. This is the cutover kill-switch — at go-live the old
-- apps are retired and the new ones are forced current, so nobody keeps hitting a frozen old system.
--
-- Platform-wide (not tenant-scoped): one supported-version floor applies across every market. Read by a public
-- endpoint (clients poll it on launch) and enforced by an onRequest guard when `mandatory` is set. `app` is one of
-- customer | restaurant | rider | storefront; `platform` is ios | android | web. Versions are plain semver strings.
CREATE TABLE platform.app_release (
  app           text NOT NULL,
  platform      text NOT NULL,
  min_supported text NOT NULL,                 -- a client below this is hard-blocked (update_required)
  latest        text NOT NULL DEFAULT '',      -- a client below this is nudged (update_optional); '' = no nudge
  store_url     text NOT NULL DEFAULT '',      -- where to send the user to update
  mandatory     boolean NOT NULL DEFAULT false,-- kill-switch: when true the guard 426s clients below min_supported
  message       text NOT NULL DEFAULT '',      -- optional custom copy for the update screen
  updated_by    text NOT NULL DEFAULT '',
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (app, platform),
  CONSTRAINT app_release_app_ck CHECK (app IN ('customer','restaurant','rider','storefront')),
  CONSTRAINT app_release_platform_ck CHECK (platform IN ('ios','android','web'))
);
