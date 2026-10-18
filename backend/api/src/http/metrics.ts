/**
 * Prometheus metrics (opt-in). A tiny, dependency-free collector: an HTTP request counter and a latency
 * histogram labelled by method + matched route (the route *template*, not the raw URL, so cardinality stays
 * bounded), plus a few process gauges. Exposed at GET /metrics in the Prometheus text exposition format for a
 * scraper. It is opt-in and meant for an internal/edge-restricted scrape — optionally bearer-token gated.
 */
const BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10] as const;

export interface Metrics {
  /** Record one finished request: HTTP method, matched route template, status code, duration in seconds. */
  observe(method: string, route: string, status: number, seconds: number): void;
  /** Render the current metrics in Prometheus text format. */
  scrape(): string;
}

export function createMetrics(): Metrics {
  const counts = new Map<string, number>();                                   // "method|route|status" → count
  const hist = new Map<string, { buckets: number[]; sum: number; count: number }>(); // "method|route" → histogram
  const lbl = (s: string) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, " ");

  return {
    observe(method, route, status, seconds) {
      const ck = `${method}|${route}|${status}`;
      counts.set(ck, (counts.get(ck) ?? 0) + 1);
      const hk = `${method}|${route}`;
      let h = hist.get(hk);
      if (!h) { h = { buckets: new Array(BUCKETS.length).fill(0), sum: 0, count: 0 }; hist.set(hk, h); }
      h.sum += seconds;
      h.count += 1;
      // Cumulative buckets: an observation falls into every bucket whose upper bound it is ≤.
      for (let i = 0; i < BUCKETS.length; i++) if (seconds <= BUCKETS[i]!) h.buckets[i]! += 1;
    },

    scrape() {
      const out: string[] = [];
      out.push("# HELP http_requests_total Total HTTP requests handled, by method, route and status.");
      out.push("# TYPE http_requests_total counter");
      for (const [k, v] of counts) {
        const [m, r, s] = k.split("|");
        out.push(`http_requests_total{method="${lbl(m!)}",route="${lbl(r!)}",status="${s}"} ${v}`);
      }
      out.push("# HELP http_request_duration_seconds HTTP request latency in seconds.");
      out.push("# TYPE http_request_duration_seconds histogram");
      for (const [k, h] of hist) {
        const [m, r] = k.split("|");
        const base = `method="${lbl(m!)}",route="${lbl(r!)}"`;
        for (let i = 0; i < BUCKETS.length; i++) out.push(`http_request_duration_seconds_bucket{${base},le="${BUCKETS[i]}"} ${h.buckets[i]}`);
        out.push(`http_request_duration_seconds_bucket{${base},le="+Inf"} ${h.count}`);
        out.push(`http_request_duration_seconds_sum{${base}} ${h.sum}`);
        out.push(`http_request_duration_seconds_count{${base}} ${h.count}`);
      }
      const mem = process.memoryUsage();
      out.push("# HELP process_resident_memory_bytes Resident set size in bytes.");
      out.push("# TYPE process_resident_memory_bytes gauge");
      out.push(`process_resident_memory_bytes ${mem.rss}`);
      out.push("# HELP nodejs_heap_used_bytes V8 heap used in bytes.");
      out.push("# TYPE nodejs_heap_used_bytes gauge");
      out.push(`nodejs_heap_used_bytes ${mem.heapUsed}`);
      out.push("# HELP process_uptime_seconds Process uptime in seconds.");
      out.push("# TYPE process_uptime_seconds gauge");
      out.push(`process_uptime_seconds ${process.uptime().toFixed(3)}`);
      return out.join("\n") + "\n";
    },
  };
}
