# Runbooks

PRD §28.8 minimum set. Each runbook is written before the market that needs it goes live (§28.10
"Operations: playbook, runbooks, on-call rota"). Status reflects what exists in this repository.

| Runbook | Trigger / alert | Status |
| --- | --- | --- |
| Connector outage and failover | Circuit open, connector health below floor (`PaymentRouter.openCircuits`) | To write |
| Ledger imbalance | Nightly ledger proof returns SEV1 (`proveLedger`) | To write |
| Reconciliation break spike | Statement import breaks above threshold | To write |
| Dispatch backlog | Unassigned jobs above threshold | To write |
| Mass rider offline | Riders online drop per zone | To write |
| SMS/OTP provider failure | OTP delivery rate drop | To write |
| App crash spike | Crash-free sessions below SLO | To write |
| Agent misbehaviour and kill switch | Override rate spike, guardrail breach | To write |
| Data subject request | DSR received | To write |
| Currency event (§19.6) | Redenomination announced | To write |
| Regional failover | Data-plane outage | To write |
| Migration wave rollback | Wave gate failure (§35) | To write |
