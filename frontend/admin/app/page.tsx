"use client";
import { useEffect, useState } from "react";
import { Columns, ChartCard, Diverging, Funnel, HBars, Heatmap, Line, ShareBars, StatTile } from "../components/charts/charts";
import { Gate, Shell, useConsole } from "../components/shell";
import { api, type Analytics, type Kpis } from "../lib/api";
import { count, dateShort, minorToNumber, money, pct } from "../lib/format";
import { stateLabel, WEEKDAYS } from "../lib/i18n";

export default function OverviewPage() {
  const [days, setDays] = useState(30);
  return (
    <Shell title="overview" actions={<Period days={days} setDays={setDays} />}>
      <Gate cap="overview"><Overview days={days} /></Gate>
    </Shell>
  );
}

function Period({ days, setDays }: { days: number; setDays: (d: number) => void }) {
  return (
    <div className="seg" role="group" aria-label="Period">
      {[7, 30, 90].map((d) => <button key={d} type="button" aria-pressed={days === d} onClick={() => setDays(d)}>{d} j</button>)}
    </div>
  );
}

const ACCOUNT_LABEL: Record<string, [string, string]> = {
  restaurant_payable: ["Dû aux commerces", "Owed to merchants"],
  rider_payable: ["Dû aux livreurs", "Owed to riders"],
  service_charge_revenue: ["Frais de service", "Service charge"],
  delivery_fee_revenue: ["Part livraison plateforme", "Platform delivery share"],
  psp_clearing: ["Encaissements PSP", "PSP clearing"],
  cod_cash_in_transit: ["Espèces en transit", "Cash in transit"],
};

function Overview({ days }: { days: number }) {
  const { country, lang, t } = useConsole();
  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    api<Analytics>(`/v1/admin/analytics?days=${days}`, { country })
      .then((d) => { setData(d); setError(null); })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [days, country]);

  if (error) return <div className="banner error">{error}</div>;
  if (!data) return <div className="muted">…</div>;

  const ccy = data.period.currency;
  const L = (fr: string, en: string) => (lang === "fr" ? fr : en);
  const m = (minor: string, compact = false) => money(lang, minor, ccy, { compact });
  const mNum = (v: number) => money(lang, String(Math.round(v * 100)), ccy, { compact: true }); // axis ticks
  const c = (n: number) => count(lang, n);
  const cur = data.kpis.current, prev = data.kpis.previous;
  const days1 = data.daily.map((d) => dateShort(lang, d.day));
  const labels = { table: t("table"), chart: t("chart") };

  const delta = (k: keyof Kpis, kind: "count" | "money" | "rate") => {
    // A delta against a near-empty period is noise ("+4 000 %"): compare only when the previous period has 20+ orders.
    if (prev.orders < 20) return { text: "—", dir: "flat", note: t("no_compare") } as const;
    const a = Number(cur[k]), b = Number(prev[k]);
    if (kind === "rate") {
      const diff = a - b;
      return { text: `${diff >= 0 ? "+" : ""}${(diff * 100).toFixed(1)} pt`, dir: diff > 0.0005 ? "up" : diff < -0.0005 ? "down" : "flat", note: t("vs_prev") } as const;
    }
    if (!b) return { text: "—", dir: "flat", note: t("vs_prev") } as const;
    const r = (a - b) / b;
    return { text: `${r >= 0 ? "+" : ""}${pct(lang, r)}`, dir: r > 0.0005 ? "up" : r < -0.0005 ? "down" : "flat", note: t("vs_prev") } as const;
  };
  const other = data.daily.map((d) => Math.max(0, d.orders - d.delivered - d.lost));
  const placedSpark = data.daily.map((d) => d.orders);
  const gmvSpark = data.daily.map((d) => minorToNumber(d.gmv_minor, ccy));
  const totalTypes = data.mix.order_type.reduce((s, x) => s + x.orders, 0);

  return (
    <div className={`grid ${loading ? "loading" : ""}`}>
      <div className="scope-note">
        {data.scope.kind === "market" ? t("whole_market") : `${t("your_branches")}: ${data.scope.branches.map((b) => b.name).join(", ")}`}
        {" · "}{t("last_n", { n: data.period.days })}{" · "}{data.period.timezone}{" · "}{ccy}
      </div>

      <div className="kpis">
        <StatTile label={t("k_gmv")} value={m(cur.gmv_minor)} delta={delta("gmv_minor", "money")} spark={gmvSpark} />
        <StatTile label={t("k_orders")} value={c(cur.orders)} delta={delta("orders", "count")} spark={placedSpark} />
        <StatTile label={t("k_aov")} value={m(cur.aov_minor)} delta={delta("aov_minor", "money")} />
        <StatTile label={t("k_delivered")} value={pct(lang, cur.delivered_rate)} delta={delta("delivered_rate", "rate")} />
        <StatTile label={t("k_lost")} value={pct(lang, cur.lost_rate)} delta={delta("lost_rate", "rate")} upIsGood={false} />
        <StatTile label={t("k_customers")} value={c(cur.customers)} delta={delta("customers", "count")} spark={data.daily.map((d) => d.new_customers + d.returning_customers)} />
      </div>

      <div className="grid g2">
        <ChartCard title={t("c_orders_day")} sub={t("c_orders_day_sub")} labels={labels}
          legend={[{ label: t("delivered"), color: "var(--good)" }, { label: t("lost"), color: "var(--critical)" }, { label: t("in_progress"), color: "var(--axis)" }]}
          table={{ columns: [L("Jour", "Day"), t("delivered"), t("lost"), t("in_progress")], numeric: [false, true, true, true], rows: data.daily.map((d, i) => [days1.at(i) ?? d.day, d.delivered, d.lost, other.at(i) ?? 0]) }}>
          <Columns categories={days1} format={(v) => c(v)} series={[
            { key: "delivered", label: t("delivered"), color: "var(--good)", values: data.daily.map((d) => d.delivered) },
            { key: "lost", label: t("lost"), color: "var(--critical)", values: data.daily.map((d) => d.lost) },
            { key: "other", label: t("in_progress"), color: "var(--axis)", values: other },
          ]} />
        </ChartCard>
        <ChartCard title={t("c_gmv_day")} sub={`${m(cur.gmv_minor)} · ${t("last_n", { n: data.period.days })}`} labels={labels}
          table={{ columns: [L("Jour", "Day"), t("k_gmv")], numeric: [false, true], rows: data.daily.map((d, i) => [days1.at(i) ?? d.day, m(d.gmv_minor)]) }}>
          <Line categories={days1} values={gmvSpark} label={t("k_gmv")} color="var(--s1)" format={mNum} />
        </ChartCard>
      </div>

      <div className="grid g3">
        <ChartCard title={t("c_funnel")} sub={t("c_funnel_sub")} labels={labels}
          table={{ columns: [L("Étape", "Stage"), L("Commandes", "Orders")], numeric: [false, true], rows: data.funnel.map((f) => [stateLabel(lang, f.stage), f.orders]) }}>
          <Funnel stages={data.funnel.map((f) => ({ label: stateLabel(lang, f.stage), value: f.orders }))} format={c} keptLabel={(r) => `${pct(lang, r, 0)} ${L("de l'étape précédente", "of previous stage")}`} />
        </ChartCard>
        <ChartCard title={t("c_minutes")} sub={`${t("median")} ${data.delivery_minutes.median ?? "—"} min · ${t("p90")} ${data.delivery_minutes.p90 ?? "—"} min`} labels={labels}
          table={{ columns: ["Minutes", L("Commandes", "Orders")], numeric: [false, true], rows: data.delivery_minutes.buckets.map((b) => [b.label, b.orders]) }}>
          <Columns categories={data.delivery_minutes.buckets.map((b) => b.label)} format={c} height={200} labelEvery={1}
            series={[{ key: "orders", label: L("Commandes", "Orders"), color: "var(--s1)", values: data.delivery_minutes.buckets.map((b) => b.orders) }]} />
        </ChartCard>
        <ChartCard title={t("c_mix")} sub={t("c_mix_sub")} labels={labels}
          legend={[{ label: stateLabel(lang, "DELIVERY"), color: "var(--s1)" }, { label: stateLabel(lang, "TAKEAWAY"), color: "var(--s2)" }, { label: stateLabel(lang, "PREPAID"), color: "var(--s3)" }, { label: stateLabel(lang, "CASH_ON_DELIVERY"), color: "var(--s4)" }]}
          table={{ columns: [L("Catégorie", "Category"), L("Commandes", "Orders")], numeric: [false, true], rows: [...data.mix.order_type.map((x) => [stateLabel(lang, x.key), x.orders]), ...data.mix.payment_mode.map((x) => [stateLabel(lang, x.key), x.orders])] }}>
          <ShareBars bars={[
            { label: L("Type", "Type"), parts: data.mix.order_type.map((x) => ({ label: stateLabel(lang, x.key), value: x.orders, color: x.key === "DELIVERY" ? "var(--s1)" : x.key === "TAKEAWAY" ? "var(--s2)" : "var(--s7)" })) },
            { label: L("Paiement", "Payment"), parts: data.mix.payment_mode.map((x) => ({ label: stateLabel(lang, x.key), value: x.orders, color: x.key === "PREPAID" ? "var(--s3)" : "var(--s4)" })) },
          ]} />
          <p className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>{c(totalTypes)} {L("commandes passées", "orders placed")}</p>
        </ChartCard>
      </div>

      <ChartCard title={t("c_heat")} sub={t("c_heat_sub")} labels={labels}
        table={{ columns: [L("Jour", "Day"), L("Heure", "Hour"), L("Commandes", "Orders")], numeric: [false, true, true], rows: data.heatmap.map((h) => [WEEKDAYS[lang].at(h.weekday - 1) ?? "", `${h.hour}h`, h.orders]) }}>
        <Heatmap rows={7} cols={24} rowLabels={WEEKDAYS[lang]} colLabel={(h) => `${h}h`} format={(v) => `${c(v)} ${L("commandes", "orders")}`}
          value={(r, col) => data.heatmap.find((h) => h.weekday === r + 1 && h.hour === col)?.orders ?? 0} legendLow={L("Peu", "Few")} legendHigh={L("Beaucoup", "Many")} />
      </ChartCard>

      <div className="grid g3">
        <ChartCard title={t("c_top_merchants")} sub={t("c_top_merchants_sub")} labels={labels}
          table={{ columns: [L("Commerce", "Merchant"), L("Commandes", "Orders"), t("k_gmv")], numeric: [false, true, true], rows: data.top_branches.map((b) => [b.name, b.orders, m(b.gmv_minor)]) }}>
          {data.top_branches.length ? <HBars rows={data.top_branches.map((b) => ({ label: b.name, value: minorToNumber(b.gmv_minor, ccy) }))} format={mNum} sub={(i) => `${c(data.top_branches.at(i)?.orders ?? 0)} ${L("commandes", "orders")}`} /> : <p className="muted">{t("nothing")}</p>}
        </ChartCard>
        <ChartCard title={t("c_top_dishes")} labels={labels}
          table={{ columns: [L("Plat", "Dish"), L("Vendus", "Sold")], numeric: [false, true], rows: data.top_dishes.map((d) => [d.name, d.quantity]) }}>
          {data.top_dishes.length ? <HBars rows={data.top_dishes.map((d) => ({ label: d.name, value: d.quantity }))} format={c} /> : <p className="muted">{t("nothing")}</p>}
        </ChartCard>
        <ChartCard title={t("c_riders")} sub={t("c_riders_sub")} labels={labels}
          table={{ columns: [L("Livreur", "Rider"), L("Livraisons", "Deliveries")], numeric: [false, true], rows: data.riders.map((r) => [r.name, r.deliveries]) }}>
          {data.riders.length ? <HBars rows={data.riders.map((r) => ({ label: r.name, value: r.deliveries }))} format={c} /> : <p className="muted">{t("nothing")}</p>}
        </ChartCard>
      </div>

      <ChartCard title={t("c_customers")} sub={t("c_customers_sub")} labels={labels}
        legend={[{ label: t("new_c"), color: "var(--s1)" }, { label: t("returning_c"), color: "var(--s2)" }]}
        table={{ columns: [L("Jour", "Day"), t("new_c"), t("returning_c")], numeric: [false, true, true], rows: data.daily.map((d, i) => [days1.at(i) ?? d.day, d.new_customers, d.returning_customers]) }}>
        <Columns categories={days1} format={c} height={200} series={[
          { key: "new", label: t("new_c"), color: "var(--s1)", values: data.daily.map((d) => d.new_customers) },
          { key: "returning", label: t("returning_c"), color: "var(--s2)", values: data.daily.map((d) => d.returning_customers) },
        ]} />
      </ChartCard>

      {data.finance ? (
        <div className="grid g2">
          <ChartCard title={t("c_balances")} sub={t("c_balances_sub")} labels={labels}
            table={{ columns: [L("Compte", "Account"), L("Devise", "Currency"), L("Solde", "Balance")], numeric: [false, false, true], rows: data.finance.balances.map((b) => [ACCOUNT_LABEL[b.account]?.[lang === "fr" ? 0 : 1] ?? b.account, b.currency, money(lang, b.balance_minor, b.currency)]) }}>
            <Diverging rows={data.finance.balances.filter((b) => b.currency === ccy).map((b) => ({ label: ACCOUNT_LABEL[b.account]?.[lang === "fr" ? 0 : 1] ?? b.account, value: minorToNumber(b.balance_minor, ccy) }))} format={mNum} />
          </ChartCard>
          <FinanceFlows data={data} labels={labels} />
        </div>
      ) : null}

      {data.audit ? (
        <ChartCard title={t("c_audit")} sub={data.audit.chain.ok ? `✓ ${t("chain_ok")}` : `✕ ${t("chain_broken")} ${data.audit.chain.brokenAt}`} labels={labels}
          table={{ columns: [L("Jour", "Day"), "Action", L("Nombre", "Count")], numeric: [false, false, true], rows: data.audit.by_day.map((a) => [a.day, a.action, a.count]) }}>
          <Columns categories={data.daily.map((d) => dateShort(lang, d.day))} format={c} height={160} series={[{ key: "actions", label: "Actions", color: "var(--s7)", values: data.daily.map((d) => data.audit?.by_day.filter((a) => a.day === d.day).reduce((s, a) => s + a.count, 0) ?? 0) }]} />
        </ChartCard>
      ) : null}
    </div>
  );
}

function FinanceFlows({ data, labels }: { data: Analytics; labels: { table: string; chart: string } }) {
  const { lang, t } = useConsole();
  const ccy = data.period.currency;
  const accounts = ["restaurant_payable", "rider_payable", "service_charge_revenue", "delivery_fee_revenue"] as const;
  const colors = ["var(--s1)", "var(--s2)", "var(--s3)", "var(--s4)"];
  const days = data.daily.map((d) => d.day);
  const name = (a: string) => ACCOUNT_LABEL[a]?.[lang === "fr" ? 0 : 1] ?? a;
  const series = accounts.map((a, i) => ({
    key: a, label: name(a), color: colors.at(i) ?? "var(--s1)",
    values: days.map((d) => minorToNumber(data.finance?.daily_credits.find((x) => x.day === d && x.account === a)?.amount_minor ?? "0", ccy)),
  }));
  return (
    <ChartCard title={t("c_flows")} sub={t("c_flows_sub")} labels={labels} legend={series.map((s) => ({ label: s.label, color: s.color }))}
      table={{ columns: [lang === "fr" ? "Jour" : "Day", ...series.map((s) => s.label)], numeric: [false, true, true, true, true], rows: days.map((d, i) => [d, ...series.map((s) => money(lang, String(Math.round((s.values.at(i) ?? 0) * 100)), ccy))]) }}>
      <Columns categories={days.map((d) => dateShort(lang, d))} series={series} format={(v) => money(lang, String(Math.round(v * 100)), ccy, { compact: true })} />
    </ChartCard>
  );
}
