-- AI customer-service assistant (§AI): the tier-1 support surface. A customer's questions and the assistant's
-- grounded answers are kept as a conversation; when the assistant is unsure or the question needs a human
-- judgement (a discretionary refund, a complaint), the conversation is ESCALATED and a human who holds
-- `ai_chat:takeover` picks it up. Every assistant turn records the intent, confidence and citations so the AI
-- is auditable. Additive; its own schema, nothing else depends on it.

CREATE SCHEMA IF NOT EXISTS support;

-- One help conversation, optionally about a specific order. Status moves OPEN → ESCALATED (human needed) → RESOLVED.
CREATE TABLE support.conversation (
  id uuid PRIMARY KEY DEFAULT platform.uuid_v7(),
  country_iso2 char(2) NOT NULL,
  customer_id uuid NOT NULL REFERENCES identity.app_user(id),
  order_id uuid,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'ESCALATED', 'RESOLVED')),
  last_intent text NOT NULL DEFAULT 'UNKNOWN',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX support_conversation_customer ON support.conversation (country_iso2, customer_id, updated_at DESC);
CREATE INDEX support_conversation_status ON support.conversation (country_iso2, status, updated_at DESC);

-- Every turn: the customer's message, the assistant's grounded reply, or a human agent's reply on takeover.
CREATE TABLE support.message (
  id uuid PRIMARY KEY DEFAULT platform.uuid_v7(),
  country_iso2 char(2) NOT NULL,
  conversation_id uuid NOT NULL REFERENCES support.conversation(id),
  sender text NOT NULL CHECK (sender IN ('CUSTOMER', 'AI', 'AGENT')),
  body text NOT NULL,
  -- Present on an AI turn: how it classified and how sure it was, and the policies it cited.
  intent text,
  confidence numeric(4, 3),
  escalated boolean NOT NULL DEFAULT false,
  citations jsonb NOT NULL DEFAULT '[]',
  -- The agent's user id on an AGENT turn.
  author_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX support_message_conversation ON support.message (conversation_id, created_at);

ALTER TABLE support.conversation ENABLE ROW LEVEL SECURITY;
ALTER TABLE support.conversation FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_country ON support.conversation USING (country_iso2 = platform.current_country()) WITH CHECK (country_iso2 = platform.current_country());
ALTER TABLE support.message ENABLE ROW LEVEL SECURITY;
ALTER TABLE support.message FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_country ON support.message USING (country_iso2 = platform.current_country()) WITH CHECK (country_iso2 = platform.current_country());
