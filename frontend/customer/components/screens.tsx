/** Real product screens used as the site's imagery — what customers, riders and merchants actually see. */

export function MapSketch() {
  // A stylised street plan: the river along the top, boulevards, the route and two pins.
  return (
    <div className="map" aria-hidden>
      <svg viewBox="0 0 300 230" preserveAspectRatio="xMidYMid slice">
        <path d="M-10 18 C 60 6, 120 34, 190 16 S 290 4, 320 22 L320 -10 L-10 -10Z" fill="#c9d8d3" />
        <text x="196" y="14" fontSize="7" fill="#5d7a72" fontStyle="italic">Fleuve Congo</text>
        <g stroke="#fbf8f3" strokeWidth="9" fill="none" strokeLinecap="round">
          <path d="M-10 70 L320 92" />
          <path d="M40 -10 L88 240" />
          <path d="M170 -10 L150 240" />
          <path d="M-10 168 L320 150" />
          <path d="M230 20 L300 230" />
        </g>
        <g stroke="#f3ede3" strokeWidth="4" fill="none">
          <path d="M-10 120 L320 116" />
          <path d="M110 30 L118 240" />
          <path d="M200 60 L270 200" />
          <path d="M20 210 L300 196" />
        </g>
        <text x="8" y="66" fontSize="7" fill="#7a8197">Bd du 30 Juin</text>
        <text x="182" y="146" fontSize="7" fill="#7a8197">Av. Kasa-Vubu</text>
        <path d="M64 96 C 90 100, 112 118, 128 140 S 168 160, 214 150" stroke="#eb771a" strokeWidth="3.5" fill="none" strokeDasharray="1 0" />
        <circle cx="64" cy="96" r="7" fill="#141b33" />
        <circle cx="64" cy="96" r="2.6" fill="#fbf8f3" />
        <circle cx="128" cy="140" r="9" fill="#eb771a" stroke="#fbf8f3" strokeWidth="3" />
        <path d="M214 150 l0 -18" stroke="#1f305d" strokeWidth="2" />
        <circle cx="214" cy="128" r="8" fill="#1f305d" />
        <circle cx="214" cy="128" r="3" fill="#fbf8f3" />
      </svg>
    </div>
  );
}

export function TrackingScreen() {
  return (
    <>
      <MapSketch />
      <div className="scr">
        <div className="row" style={{ marginTop: 12 }}>
          <div>
            <div className="t">Arriving in 14 min</div>
            <div className="s">Chez Mama Pauline · Gombe</div>
          </div>
          <span className="pill">ON THE WAY</span>
        </div>
        <div className="card">
          <div className="row" style={{ alignItems: "center" }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <div className="avatar">PM</div>
              <div>
                <div style={{ fontWeight: 650 }}>Patrick M.</div>
                <div className="s">Moto · 2 bags, sealed</div>
              </div>
            </div>
            <span className="s">Call · Chat</span>
          </div>
        </div>
        <div className="card">
          <div className="s" style={{ marginBottom: 4 }}>Delivering to</div>
          <div style={{ fontWeight: 600, lineHeight: 1.35 }}>Blue gate after the Total station, Rond-point Victoire</div>
          <div className="s" style={{ marginTop: 6 }}>Pin dropped · voice note 0:12</div>
        </div>
        <div className="card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div className="s">Your handover code</div>
            <div style={{ fontWeight: 700, fontSize: 22, letterSpacing: "0.2em" }}>4 8 2 1</div>
          </div>
          <span className="s" style={{ maxWidth: 110, textAlign: "right" }}>Give it to Patrick at the door</span>
        </div>
      </div>
    </>
  );
}

export function PayScreen() {
  return (
    <div className="scr">
      <div className="t" style={{ marginTop: 4 }}>Checkout</div>
      <div className="s">Order #KIN-20419 · Chez Mama Pauline</div>
      <div className="card">
        <div className="row"><span>Poulet à la moambe</span><span className="price">16 000 FC</span></div>
        <div className="row"><span>Pondu na makayabu</span><span className="price">9 000 FC</span></div>
        <div className="row"><span>Chikwangue ×2</span><span className="price">3 000 FC</span></div>
        <div className="sep" />
        <div className="row s"><span>Service charge 10%</span><span className="price">2 800 FC</span></div>
        <div className="row s"><span>Delivery · 3 km</span><span className="price">8 600 FC</span></div>
        <div className="sep" />
        <div className="row" style={{ fontWeight: 700, fontSize: 16 }}><span>Total</span><span className="price">39 400 FC</span></div>
        <div className="row s"><span></span><span>≈ $13.82 at 2 850 FC · rate held 5 min</span></div>
      </div>
      <div style={{ marginTop: 14, fontWeight: 650, fontSize: 12, letterSpacing: "0.06em", color: "#5f6987" }}>PAY WITH</div>
      {[
        ["M-Pesa", "+243 81 ••• 4410", true],
        ["Orange Money", "", false],
        ["Airtel Money", "", false],
      ].map(([name, sub, on]) => (
        <div className="card" key={name as string} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "11px 14px", borderColor: on ? "#141b33" : undefined }}>
          <div>
            <div style={{ fontWeight: 600 }}>{name}</div>
            {sub ? <div className="s">{sub}</div> : null}
          </div>
          <span style={{ width: 16, height: 16, borderRadius: "50%", border: on ? "5px solid #141b33" : "1.5px solid #b9ad9e" }} />
        </div>
      ))}
      <div className="cta brand">Pay 39 400 FC</div>
      <div className="s" style={{ textAlign: "center", marginTop: 8 }}>You will approve on your phone</div>
    </div>
  );
}

export function JobOfferScreen() {
  return (
    <div className="scr">
      <div className="row" style={{ marginTop: 4 }}>
        <div className="t">New delivery</div>
        <span className="pill" style={{ background: "#ffe9b8", color: "#7a3304" }}>0:24</span>
      </div>
      <div className="card">
        <div className="s">You earn</div>
        <div style={{ fontFamily: "var(--display)", fontSize: 44, lineHeight: 1 }}>$2.10</div>
        <div className="s" style={{ marginTop: 6 }}>70% of the $3.00 delivery fee · paid today to M-Pesa</div>
      </div>
      <div className="card">
        <div className="steps">
          <div className="st"><span className="dot done" /><div><div style={{ fontWeight: 600 }}>Pick up</div><div className="s">Chez Mama Pauline, Av. du Commerce</div></div><span className="s">0.8 km</span></div>
          <div className="st"><span className="dot now" /><div><div style={{ fontWeight: 600 }}>Drop off</div><div className="s">Rond-point Victoire, blue gate</div></div><span className="s">3.0 km</span></div>
        </div>
      </div>
      <div className="card" style={{ fontSize: 12.5, color: "#2e3b63" }}>
        Declining never affects your standing or the jobs you are offered.
      </div>
      <div className="cta">Accept</div>
      <div className="s" style={{ textAlign: "center", marginTop: 10 }}>Not this one</div>
    </div>
  );
}

export function PosScreen() {
  return (
    <div className="scr">
      <div className="row" style={{ marginTop: 4 }}>
        <div className="t">Table 4</div>
        <span className="s">Counter · Aimée</span>
      </div>
      <div className="card">
        {[
          ["Liboke ya mbisi", "1", "18 000"],
          ["Fumbwa", "1", "8 000"],
          ["Makemba frits", "2", "6 000"],
          ["Jus de gingembre", "2", "4 000"],
        ].map(([n, q, p]) => (
          <div className="row" key={n}><span>{q}× {n}</span><span className="price">{p} FC</span></div>
        ))}
        <div className="sep" />
        <div className="row" style={{ fontWeight: 700 }}><span>To pay</span><span className="price">36 000 FC</span></div>
        <div className="row s"><span>Commission to Tunakula</span><span className="price">0 FC</span></div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 12 }}>
        {["Cash", "M-Pesa", "Orange", "Split"].map((m, i) => (
          <div key={m} className="card" style={{ margin: 0, textAlign: "center", fontWeight: 600, borderColor: i === 1 ? "#141b33" : undefined }}>{m}</div>
        ))}
      </div>
      <div className="cta brand">Charge 36 000 FC</div>
      <div className="s" style={{ textAlign: "center", marginTop: 8 }}>Works offline · syncs when back online</div>
    </div>
  );
}

export function Receipt() {
  return (
    <div className="receipt" aria-label="Printed receipt with both logos">
      <div className="logos">
        <img className="tk" src="/brand/tunakula-logo.jpg" alt="Tunakula" width={64} height={64} />
        <span className="biz">MP</span>
      </div>
      <div style={{ textAlign: "center", marginBottom: 10 }}>
        CHEZ MAMA PAULINE<br />Av. du Commerce 112, Gombe<br />RCCM CD/KIN/24-B-01188
      </div>
      <div className="r"><span>Ticket</span><span>KIN-20419</span></div>
      <div className="r"><span>04/10/2026</span><span>19:31</span></div>
      <div className="hr" />
      <div className="r"><span>1 Poulet moambe</span><span>16 000</span></div>
      <div className="r"><span>1 Pondu makayabu</span><span>9 000</span></div>
      <div className="r"><span>2 Chikwangue</span><span>3 000</span></div>
      <div className="hr" />
      <div className="r"><span>Sous-total</span><span>28 000</span></div>
      <div className="r"><span>Frais de service 10%</span><span>2 800</span></div>
      <div className="r"><span>Livraison 3 km</span><span>8 600</span></div>
      <div className="r" style={{ fontWeight: 700 }}><span>TOTAL FC</span><span>39 400</span></div>
      <div className="r"><span>Payé · M-Pesa</span><span>•••4410</span></div>
      <div className="qr" />
      <div style={{ textAlign: "center", fontSize: 11 }}>Scan to rate your meal · Merci!</div>
    </div>
  );
}
