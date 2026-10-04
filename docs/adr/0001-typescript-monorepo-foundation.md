# ADR 0001 — TypeScript monorepo foundation with framework-free domain modules

- Status: Accepted
- Date: 2026-10-04

## Context
PRD §9.3 fixes NestJS (TypeScript) for the backend and §32.1 fixes the monorepo layout
(`packages/ts-money`, `packages/ts-contracts`, `services/api`, `adapters/*`). The first code must make the
money and any-market rules hard to break before any application code depends on them.

## Decision
- npm workspaces monorepo following §32.1.
- Node.js ≥ 22.18 runs TypeScript directly via type stripping; `tsc --noEmit` typechecks with
  `strict`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess` and `erasableSyntaxOnly`.
  No build step, no transpiler-specific syntax (enums, parameter properties).
- Domain modules in `services/api/src/modules/*` are plain TypeScript with no framework imports. NestJS
  modules will wrap them (controllers, providers, persistence), keeping domain logic testable in isolation
  and portable if a context is extracted into its own service (§9.1).
- Tests use `node:test`; property-based tests use `fast-check` (§32.3 requires them for money paths).

## Consequences
- Contributors need Node 22.18+. Adding NestJS (which uses decorators) requires a compile step for
  `services/api` only; shared packages stay build-free.
