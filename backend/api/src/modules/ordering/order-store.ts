/**
 * Append-only order event store with optimistic concurrency and command
 * idempotency (§11.2 INT-002). The production store is PostgreSQL
 * (`order_event`) publishing to Kafka; this in-memory version keeps the same
 * contract for tests and local runs.
 */
import { decide, replay, type CommandEnvelope, type OrderAggregate } from "./order-aggregate.ts";
import type { OrderEvent } from "./order-types.ts";

export class ConcurrencyError extends Error {
  constructor(orderId: string, expected: number, actual: number) {
    super(`Order ${orderId} is at version ${actual}, expected ${expected}`);
    this.name = "ConcurrencyError";
  }
}

export class InMemoryOrderStore {
  readonly #streams = new Map<string, OrderEvent[]>();
  readonly #byCommand = new Map<string, readonly OrderEvent[]>();
  readonly #subscribers: ((events: readonly OrderEvent[]) => void)[] = [];

  load(orderId: string): readonly OrderEvent[] {
    return this.#streams.get(orderId) ?? [];
  }

  append(orderId: string, expectedVersion: number, events: readonly OrderEvent[]): void {
    const stream = this.#streams.get(orderId) ?? [];
    if (stream.length !== expectedVersion) throw new ConcurrencyError(orderId, expectedVersion, stream.length);
    this.#streams.set(orderId, [...stream, ...events]);
    for (const notify of this.#subscribers) notify(events);
  }

  subscribe(handler: (events: readonly OrderEvent[]) => void): void {
    this.#subscribers.push(handler);
  }

  /** Handles a command: replay, decide, append. Re-sending a commandId returns the original events. */
  handle(env: CommandEnvelope): { events: readonly OrderEvent[]; order: OrderAggregate } {
    const key = `${env.orderId}:${env.commandId}`;
    const previous = this.#byCommand.get(key);
    const current = replay(this.load(env.orderId));
    if (previous) return { events: previous, order: current as OrderAggregate };

    const events = decide(current, env);
    this.append(env.orderId, current?.version ?? 0, events);
    this.#byCommand.set(key, events);
    return { events, order: replay(this.load(env.orderId)) as OrderAggregate };
  }
}
