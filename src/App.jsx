import { useState, useCallback } from "react";

async function claudeCall(prompt) {
  const res = await fetch("/api/claude", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 3000,
      tools: [{ type: "web_search_20250305", name: "web_search" }],
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`Erreur API: ${res.status}`);
  const data = await res.json();
  return data.content.filter(b => b.type === "text").map(b => b.text).join("");
}

function extractJson(text) {
  let parsed = null;
  try { parsed = JSON.parse(text.trim()); } catch {}
  if (!parsed) {
    const m = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (m) try { parsed = JSON.parse(m[1].trim()); } catch {}
  }
  if (!parsed) {
    const s = text.indexOf("{"), e = text.lastIndexOf("}");
    if (s !== -1 && e !== -1) try { parsed = JSON.parse(text.slice(s, e + 1)); } catch {}
  }
  if (!parsed) {
    const s = text.indexOf("["), e = text.lastIndexOf("]");
    if (s !== -1 && e !== -1) try { parsed = JSON.parse(text.slice(s, e + 1)); } catch {}
  }
  return parsed;
}

async function fetchMarketData(symbol) {
  const text = await claudeCall(`Search DEXScreener https://dexscreener.com/search?q=${symbol} and CoinGecko for token ${symbol}. Return ONLY raw JSON no markdown:
{"found":true,"name":"full name","symbol":"${symbol}","price":1.21,"priceChange24h":-95.1,"volume24h":13600000,"liquidity":340000,"marketCap":297000000,"circulatingSupply":248000000,"totalSupply":1000000000,"tokenAgeDays":300,"contractAddress":"0x1aA8...","chain":"base","coingeckoId":"ravedao","dexUrl":"https://dexscreener.com/base/0x..."}
If not found: {"found":false}`);
  const parsed = extractJson(text);
  if (!parsed) throw new Error("Données marché introuvables. Réessaie.");
  return parsed;
}

async function fetchNarrative(symbol, name) {
  const text = await claudeCall(`Search web for crypto token ${symbol} (${name || symbol}). Check Twitter/X, news, official site.
Return ONLY raw JSON no markdown:
{
  "score": 7,
  "verdict": "Narratif solide 🟢",
  "verdictColor": "#4ade80",
  "oneLiner": "Description courte du narratif en français",
  "summary": "2-3 phrases en français sur le projet.",
  "redFlag": false,
  "redFlagDetail": ""
}
Score: 0-2=scam(#f87171), 3-4=faible(#f87171), 5-6=correct(#facc15), 7-8=solide(#4ade80), 9-10=exceptionnel(#4ade80)`);
  const parsed = extractJson(text);
  return parsed || { score: 0, verdict: "Analyse impossible", verdictColor: "#6b7280", oneLiner: "Impossible d'analyser.", summary: "", redFlag: false, redFlagDetail: "" };
}

async function scanMarket() {
  const text = await claudeCall(`Search the web for trending crypto tokens on DEXScreener right now. Look at https://dexscreener.com/trending and recent crypto news to find tokens with unusual volume or price action today.

Find 6 to 8 interesting tokens. Your entire response must be ONLY this JSON object, nothing else, no explanation, no markdown backticks:
{"tokens":[{"symbol":"TOKEN","name":"Full Name","price":0.5,"priceChange24h":45.2,"volume24h":2000000,"liquidity":200000,"marketCap":8000000,"tokenAgeDays":60,"volLiqRatio":10,"floatPct":22,"signal":"🔥","reason":"Raison courte en français"}]}

Rules: signal must be exactly one of: 🔥 👀 ⚠️ — reason max 8 words French — marketCap between 500000 and 300000000 — floatPct = circulatingSupply divided by totalSupply times 100 (if unknown use null)`);

  // Try wrapped object
  try {
    const obj = extractJson(text);
    if (obj && obj.tokens && Array.isArray(obj.tokens) && obj.tokens.length > 0) return obj.tokens;
    if (Array.isArray(obj) && obj.length > 0) return obj;
  } catch {}

  // Try raw array
  const arrStart = text.indexOf("[");
  const arrEnd = text.lastIndexOf("]");
  if (arrStart !== -1 && arrEnd !== -1) {
    try {
      const arr = JSON.parse(text.slice(arrStart, arrEnd + 1));
      if (Array.isArray(arr) && arr.length > 0) return arr;
    } catch {}
  }

  // Try extracting individual objects
  const objects = [];
  const regex = /\{[^{}]*"symbol"[^{}]*\}/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    try { const o = JSON.parse(match[0]); if (o.symbol) objects.push(o); } catch {}
  }
  if (objects.length > 0) return objects;

  throw new Error("Scan impossible. Réessaie.");
}

function ScoreBar({ value, max = 5 }) {
  return (
    <div style={{ display: "flex", gap: 4 }}>
      {Array.from({ length: max }).map((_, i) => (
        <div key={i} style={{
          width: 14, height: 14, borderRadius: 3,
          background: i < value ? "#f97316" : "rgba(255,255,255,0.08)",
          border: i < value ? "1px solid #fb923c" : "1px solid rgba(255,255,255,0.12)",
          boxShadow: i < value ? "0 0 6px #f97316aa" : "none",
        }} />
      ))}

      {/* Guide view */}
      {view === "guide" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

          {/* DEXScreener config */}
          <div style={{ background: "rgba(249,115,22,0.06)", border: "1px solid rgba(249,115,22,0.2)", borderRadius: 16, padding: "18px" }}>
            <div style={{ fontSize: 11, color: "#f97316", fontWeight: 700, marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              ⚙️ Configuration DEXScreener
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {[
                { label: "Rank", value: "Trending 6H", tip: "6H = activité soutenue depuis plusieurs heures. 1H pour surveiller en journée. Jamais 5min (trop de bruit)" },
                { label: "Sort pairs", value: "Most Volume", tip: "Les tokens qui bougent vraiment" },
                { label: "Market Cap", value: "1M$ → 50M$", tip: "Zone idéale pour un pump x10-x100" },
                { label: "Liquidity", value: "100K$ → 500K$", tip: "Assez liquide pour trader mais pas trop" },
                { label: "Volume", value: "Min 1M$", tip: "Élimine les tokens morts" },
                { label: "Pair Age", value: "Min 7 jours", tip: "Élimine les scams de 24h" },
                { label: "TXNS", value: "Min 500", tip: "Activité réelle, pas du volume artificiel" },
              ].map((item, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "#e5e7eb" }}>{item.label}</div>
                    <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>{item.tip}</div>
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#f97316", fontFamily: "monospace", textAlign: "right", flexShrink: 0, marginLeft: 12 }}>{item.value}</div>
                </div>
              ))}
            </div>
          </div>

          {/* VOL/LIQ ratio guide */}
          <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16, padding: "18px" }}>
            <div style={{ fontSize: 11, color: "#6b7280", fontWeight: 700, marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              📊 Lire le ratio VOL/LIQ
            </div>
            <div style={{ fontSize: 12, color: "#9ca3af", lineHeight: 1.7, marginBottom: 12 }}>
              VOL ÷ LIQ = combien de fois le token a été échangé par rapport à ce qui est disponible. Si VOL &lt; LIQ → token mort, passe au suivant.
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {[
                { ratio: "< 1x", signal: "❌", label: "Token mort", color: "#f87171", bg: "rgba(248,113,113,0.08)" },
                { ratio: "1x — 5x", signal: "😴", label: "Rien d'exceptionnel", color: "#6b7280", bg: "rgba(255,255,255,0.03)" },
                { ratio: "5x — 10x", signal: "👀", label: "Quelque chose commence", color: "#facc15", bg: "rgba(250,204,21,0.08)" },
                { ratio: "10x — 50x", signal: "🔥", label: "Signal fort — creuse", color: "#f97316", bg: "rgba(249,115,22,0.08)" },
                { ratio: "> 50x", signal: "💥", label: "Manipulation probable", color: "#c084fc", bg: "rgba(192,132,252,0.08)" },
              ].map((row, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderRadius: 8, background: row.bg }}>
                  <span style={{ fontSize: 16, minWidth: 24 }}>{row.signal}</span>
                  <div style={{ fontFamily: "monospace", fontSize: 12, fontWeight: 700, color: row.color, minWidth: 70 }}>{row.ratio}</div>
                  <div style={{ fontSize: 12, color: "#9ca3af" }}>{row.label}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Float guide */}
          <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16, padding: "18px" }}>
            <div style={{ fontSize: 11, color: "#6b7280", fontWeight: 700, marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              🫧 Lire le Float (sur CoinGecko)
            </div>
            <div style={{ fontSize: 12, color: "#9ca3af", lineHeight: 1.7, marginBottom: 12 }}>
              Float = Offre en circulation ÷ Offre totale × 100. Plus c'est bas, plus l'équipe contrôle le supply et peut déclencher un pump.
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {[
                { range: "≤ 25%", signal: "✅", label: "Low float — setup idéal", color: "#4ade80", bg: "rgba(74,222,128,0.08)" },
                { range: "25% — 40%", signal: "⚠️", label: "Acceptable", color: "#facc15", bg: "rgba(250,204,21,0.08)" },
                { range: "40% — 80%", signal: "❌", label: "Trop distribué", color: "#f87171", bg: "rgba(248,113,113,0.08)" },
                { range: "100%", signal: "💀", label: "Tout circule — pas de levier", color: "#6b7280", bg: "rgba(255,255,255,0.03)" },
              ].map((row, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderRadius: 8, background: row.bg }}>
                  <span style={{ fontSize: 16, minWidth: 24 }}>{row.signal}</span>
                  <div style={{ fontFamily: "monospace", fontSize: 12, fontWeight: 700, color: row.color, minWidth: 70 }}>{row.range}</div>
                  <div style={{ fontSize: 12, color: "#9ca3af" }}>{row.label}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Quick checklist */}
          <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16, padding: "18px" }}>
            <div style={{ fontSize: 11, color: "#6b7280", fontWeight: 700, marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              ✅ Checklist rapide — 3 secondes par token
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {[
                { q: "VOL > LIQ ?", oui: "Continue", non: "Passe au suivant ❌" },
                { q: "VOL/LIQ > 5x ?", oui: "Intéressant 👀", non: "Passe au suivant ❌" },
                { q: "MCAP entre 1M-50M$ ?", oui: "Continue", non: "Trop gros ou trop petit ❌" },
                { q: "Buys > Sells ?", oui: "Quelqu'un accumule 🔥", non: "Distribution en cours ❌" },
                { q: "Age > 7 jours ?", oui: "Continue", non: "Trop récent, probable scam ❌" },
              ].map((item, i) => (
                <div key={i} style={{ padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#e5e7eb", marginBottom: 4 }}>→ {item.q}</div>
                  <div style={{ display: "flex", gap: 16, fontSize: 11 }}>
                    <span style={{ color: "#4ade80" }}>✓ OUI : {item.oui}</span>
                    <span style={{ color: "#f87171" }}>✗ NON : {item.non}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Workflow */}
          <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16, padding: "18px" }}>
            <div style={{ fontSize: 11, color: "#6b7280", fontWeight: 700, marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              🔄 Workflow quotidien
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {[
                { step: "1", label: "DEXScreener", action: "Trending + filtres → repère les tokens avec VOL >> LIQ", time: "5 min" },
                { step: "2", label: "Bubblemaps", action: "Grosses bulles connectées ? → équipe contrôle le supply", time: "1 min" },
                { step: "3", label: "Scanner", action: "Lance l'analyse complète → score /5 + narratif", time: "40 sec" },
                { step: "4", label: "Coinglass", action: "Funding rate négatif ? → shorts en place = squeeze potentiel", time: "30 sec" },
                { step: "5", label: "X / Twitter", action: "KOLs en parlent ? Narratif qui monte ?", time: "2 min" },
              ].map((item, i) => (
                <div key={i} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                  <div style={{ width: 24, height: 24, borderRadius: "50%", background: "rgba(249,115,22,0.2)", border: "1px solid rgba(249,115,22,0.4)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: "#f97316", flexShrink: 0 }}>{item.step}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "#e5e7eb" }}>{item.label}</div>
                      <div style={{ fontSize: 11, color: "#4b5563" }}>{item.time}</div>
                    </div>
                    <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>{item.action}</div>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 12, padding: "10px 12px", background: "rgba(249,115,22,0.06)", borderRadius: 8, fontSize: 12, color: "#9ca3af" }}>
              ⏱ Total : ~10 minutes par session. Fais-le matin et soir.
            </div>
          </div>

          <div style={{ fontSize: 11, color: "#4b5563", textAlign: "center", paddingBottom: 16 }}>Pas un conseil financier. DYOR.</div>
        </div>
      )}

      {/* Watchlist view */}
      {view === "watchlist" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: "#e5e7eb" }}>⭐ Ma Watchlist</div>
            <div style={{ fontSize: 12, color: "#6b7280" }}>{watchlist.length} token{watchlist.length > 1 ? "s" : ""}</div>
          </div>

          {watchlist.length === 0 && (
            <div style={{ textAlign: "center", padding: "40px 0", color: "#6b7280" }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>⭐</div>
              <div style={{ fontSize: 14 }}>Aucun token en watchlist</div>
              <div style={{ fontSize: 12, marginTop: 6, color: "#4b5563" }}>Analyse un token et clique sur "+ Ajouter à la Watchlist"</div>
            </div>
          )}

          {watchlist.map((t, i) => (
            <div key={i} style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 14, padding: "16px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                <div>
                  <div style={{ fontSize: 18, fontWeight: 800, fontFamily: "monospace" }}>{t.symbol}</div>
                  <div style={{ fontSize: 12, color: "#6b7280" }}>{t.name}</div>
                  <div style={{ fontSize: 11, color: "#4b5563", marginTop: 2 }}>Ajouté le {new Date(t.addedAt).toLocaleDateString("fr-FR")}</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#f97316" }}>Score {t.score}/5</div>
                  {t.floatPct && <div style={{ fontSize: 12, color: t.floatPct <= 25 ? "#4ade80" : t.floatPct <= 40 ? "#facc15" : "#f87171", marginTop: 2 }}>Float {t.floatPct.toFixed(0)}%</div>}
                  {t.narrativeScore > 0 && <div style={{ fontSize: 12, color: t.narrativeColor, marginTop: 2 }}>Narratif {t.narrativeScore}/10</div>}
                </div>
              </div>

              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
                {t.dexUrl && <a href={t.dexUrl} target="_blank" rel="noreferrer" style={{ flex: 1, minWidth: 80, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, padding: "8px 6px", color: "#e5e7eb", textDecoration: "none", textAlign: "center", fontSize: 11, fontWeight: 600 }}>📊 DEX</a>}
                {t.bubblemapsUrl && <a href={t.bubblemapsUrl} target="_blank" rel="noreferrer" style={{ flex: 1, minWidth: 80, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, padding: "8px 6px", color: "#e5e7eb", textDecoration: "none", textAlign: "center", fontSize: 11, fontWeight: 600 }}>🫧 Bubbles</a>}
                {t.coinglassUrl && <a href={t.coinglassUrl} target="_blank" rel="noreferrer" style={{ flex: 1, minWidth: 80, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, padding: "8px 6px", color: "#e5e7eb", textDecoration: "none", textAlign: "center", fontSize: 11, fontWeight: 600 }}>📈 Coinglass</a>}
                <a href={`https://x.com/search?q=%24${t.symbol}&src=typed_query&f=live`} target="_blank" rel="noreferrer" style={{ flex: 1, minWidth: 80, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, padding: "8px 6px", color: "#e5e7eb", textDecoration: "none", textAlign: "center", fontSize: 11, fontWeight: 600 }}>𝕏 Live</a>
              </div>

              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => { setInput(t.symbol); setView("search"); }} style={{ flex: 1, padding: "9px", background: "#f97316", border: "none", borderRadius: 8, color: "white", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
                  🔍 Réanalyser
                </button>
                <button onClick={() => removeFromWatchlist(t.symbol)} style={{ padding: "9px 14px", background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.3)", borderRadius: 8, color: "#f87171", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
                  🗑
                </button>
              </div>
            </div>
          ))}

          {watchlist.length > 0 && (
            <div style={{ fontSize: 11, color: "#4b5563", textAlign: "center", paddingBottom: 16 }}>
              Clique sur DEX pour voir le VOL/LIQ en temps réel · Clique sur Réanalyser pour une analyse fraîche
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Metric({ label, value, sub, good, bad, tip }) {
  const color = good ? "#4ade80" : bad ? "#f87171" : "#e5e7eb";
  const [show, setShow] = useState(false);
  return (
    <div style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, padding: "14px 16px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
        <div style={{ fontSize: 10, color: "#9ca3af", letterSpacing: "0.1em", textTransform: "uppercase", fontFamily: "monospace" }}>{label}</div>
        {tip && <button onClick={() => setShow(!show)} style={{ background: "rgba(255,255,255,0.08)", border: "none", borderRadius: "50%", width: 18, height: 18, color: "#6b7280", fontSize: 11, cursor: "pointer" }}>?</button>}
      </div>
      <div style={{ fontSize: 20, fontWeight: 700, color, fontFamily: "monospace" }}>{value ?? "—"}</div>
      {sub && <div style={{ fontSize: 11, color: "#6b7280", marginTop: 3 }}>{sub}</div>}
      {show && tip && <div style={{ marginTop: 10, padding: 10, background: "rgba(0,0,0,0.4)", borderRadius: 8, fontSize: 11, color: "#9ca3af", lineHeight: 1.6, borderLeft: "2px solid #f97316" }}>{tip}</div>}

      {/* Guide view */}
      {view === "guide" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

          {/* DEXScreener config */}
          <div style={{ background: "rgba(249,115,22,0.06)", border: "1px solid rgba(249,115,22,0.2)", borderRadius: 16, padding: "18px" }}>
            <div style={{ fontSize: 11, color: "#f97316", fontWeight: 700, marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              ⚙️ Configuration DEXScreener
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {[
                { label: "Rank", value: "Trending 6H", tip: "6H = activité soutenue depuis plusieurs heures. 1H pour surveiller en journée. Jamais 5min (trop de bruit)" },
                { label: "Sort pairs", value: "Most Volume", tip: "Les tokens qui bougent vraiment" },
                { label: "Market Cap", value: "1M$ → 50M$", tip: "Zone idéale pour un pump x10-x100" },
                { label: "Liquidity", value: "100K$ → 500K$", tip: "Assez liquide pour trader mais pas trop" },
                { label: "Volume", value: "Min 1M$", tip: "Élimine les tokens morts" },
                { label: "Pair Age", value: "Min 7 jours", tip: "Élimine les scams de 24h" },
                { label: "TXNS", value: "Min 500", tip: "Activité réelle, pas du volume artificiel" },
              ].map((item, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "#e5e7eb" }}>{item.label}</div>
                    <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>{item.tip}</div>
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#f97316", fontFamily: "monospace", textAlign: "right", flexShrink: 0, marginLeft: 12 }}>{item.value}</div>
                </div>
              ))}
            </div>
          </div>

          {/* VOL/LIQ ratio guide */}
          <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16, padding: "18px" }}>
            <div style={{ fontSize: 11, color: "#6b7280", fontWeight: 700, marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              📊 Lire le ratio VOL/LIQ
            </div>
            <div style={{ fontSize: 12, color: "#9ca3af", lineHeight: 1.7, marginBottom: 12 }}>
              VOL ÷ LIQ = combien de fois le token a été échangé par rapport à ce qui est disponible. Si VOL &lt; LIQ → token mort, passe au suivant.
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {[
                { ratio: "< 1x", signal: "❌", label: "Token mort", color: "#f87171", bg: "rgba(248,113,113,0.08)" },
                { ratio: "1x — 5x", signal: "😴", label: "Rien d'exceptionnel", color: "#6b7280", bg: "rgba(255,255,255,0.03)" },
                { ratio: "5x — 10x", signal: "👀", label: "Quelque chose commence", color: "#facc15", bg: "rgba(250,204,21,0.08)" },
                { ratio: "10x — 50x", signal: "🔥", label: "Signal fort — creuse", color: "#f97316", bg: "rgba(249,115,22,0.08)" },
                { ratio: "> 50x", signal: "💥", label: "Manipulation probable", color: "#c084fc", bg: "rgba(192,132,252,0.08)" },
              ].map((row, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderRadius: 8, background: row.bg }}>
                  <span style={{ fontSize: 16, minWidth: 24 }}>{row.signal}</span>
                  <div style={{ fontFamily: "monospace", fontSize: 12, fontWeight: 700, color: row.color, minWidth: 70 }}>{row.ratio}</div>
                  <div style={{ fontSize: 12, color: "#9ca3af" }}>{row.label}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Float guide */}
          <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16, padding: "18px" }}>
            <div style={{ fontSize: 11, color: "#6b7280", fontWeight: 700, marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              🫧 Lire le Float (sur CoinGecko)
            </div>
            <div style={{ fontSize: 12, color: "#9ca3af", lineHeight: 1.7, marginBottom: 12 }}>
              Float = Offre en circulation ÷ Offre totale × 100. Plus c'est bas, plus l'équipe contrôle le supply et peut déclencher un pump.
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {[
                { range: "≤ 25%", signal: "✅", label: "Low float — setup idéal", color: "#4ade80", bg: "rgba(74,222,128,0.08)" },
                { range: "25% — 40%", signal: "⚠️", label: "Acceptable", color: "#facc15", bg: "rgba(250,204,21,0.08)" },
                { range: "40% — 80%", signal: "❌", label: "Trop distribué", color: "#f87171", bg: "rgba(248,113,113,0.08)" },
                { range: "100%", signal: "💀", label: "Tout circule — pas de levier", color: "#6b7280", bg: "rgba(255,255,255,0.03)" },
              ].map((row, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderRadius: 8, background: row.bg }}>
                  <span style={{ fontSize: 16, minWidth: 24 }}>{row.signal}</span>
                  <div style={{ fontFamily: "monospace", fontSize: 12, fontWeight: 700, color: row.color, minWidth: 70 }}>{row.range}</div>
                  <div style={{ fontSize: 12, color: "#9ca3af" }}>{row.label}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Quick checklist */}
          <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16, padding: "18px" }}>
            <div style={{ fontSize: 11, color: "#6b7280", fontWeight: 700, marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              ✅ Checklist rapide — 3 secondes par token
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {[
                { q: "VOL > LIQ ?", oui: "Continue", non: "Passe au suivant ❌" },
                { q: "VOL/LIQ > 5x ?", oui: "Intéressant 👀", non: "Passe au suivant ❌" },
                { q: "MCAP entre 1M-50M$ ?", oui: "Continue", non: "Trop gros ou trop petit ❌" },
                { q: "Buys > Sells ?", oui: "Quelqu'un accumule 🔥", non: "Distribution en cours ❌" },
                { q: "Age > 7 jours ?", oui: "Continue", non: "Trop récent, probable scam ❌" },
              ].map((item, i) => (
                <div key={i} style={{ padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#e5e7eb", marginBottom: 4 }}>→ {item.q}</div>
                  <div style={{ display: "flex", gap: 16, fontSize: 11 }}>
                    <span style={{ color: "#4ade80" }}>✓ OUI : {item.oui}</span>
                    <span style={{ color: "#f87171" }}>✗ NON : {item.non}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Workflow */}
          <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16, padding: "18px" }}>
            <div style={{ fontSize: 11, color: "#6b7280", fontWeight: 700, marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              🔄 Workflow quotidien
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {[
                { step: "1", label: "DEXScreener", action: "Trending + filtres → repère les tokens avec VOL >> LIQ", time: "5 min" },
                { step: "2", label: "Bubblemaps", action: "Grosses bulles connectées ? → équipe contrôle le supply", time: "1 min" },
                { step: "3", label: "Scanner", action: "Lance l'analyse complète → score /5 + narratif", time: "40 sec" },
                { step: "4", label: "Coinglass", action: "Funding rate négatif ? → shorts en place = squeeze potentiel", time: "30 sec" },
                { step: "5", label: "X / Twitter", action: "KOLs en parlent ? Narratif qui monte ?", time: "2 min" },
              ].map((item, i) => (
                <div key={i} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                  <div style={{ width: 24, height: 24, borderRadius: "50%", background: "rgba(249,115,22,0.2)", border: "1px solid rgba(249,115,22,0.4)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: "#f97316", flexShrink: 0 }}>{item.step}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "#e5e7eb" }}>{item.label}</div>
                      <div style={{ fontSize: 11, color: "#4b5563" }}>{item.time}</div>
                    </div>
                    <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>{item.action}</div>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 12, padding: "10px 12px", background: "rgba(249,115,22,0.06)", borderRadius: 8, fontSize: 12, color: "#9ca3af" }}>
              ⏱ Total : ~10 minutes par session. Fais-le matin et soir.
            </div>
          </div>

          <div style={{ fontSize: 11, color: "#4b5563", textAlign: "center", paddingBottom: 16 }}>Pas un conseil financier. DYOR.</div>
        </div>
      )}
    </div>
  );
}

function Signal({ label, signal, description, tip }) {
  const icon = signal === true ? "✅" : signal === false ? "❌" : signal === "warn" ? "⚠️" : "—";
  const color = signal === true ? "#4ade80" : signal === false ? "#f87171" : signal === "warn" ? "#facc15" : "#6b7280";
  const [show, setShow] = useState(false);
  return (
    <div style={{ padding: "10px 0", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
      <div style={{ display: "flex", gap: 10 }}>
        <span style={{ fontSize: 16, minWidth: 22, marginTop: 1 }}>{icon}</span>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <div style={{ fontSize: 13, fontWeight: 600, color }}>{label}</div>
            <button onClick={() => setShow(!show)} style={{ background: "rgba(255,255,255,0.08)", border: "none", borderRadius: "50%", width: 18, height: 18, color: "#6b7280", fontSize: 11, cursor: "pointer", flexShrink: 0 }}>?</button>
          </div>
          <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>{description}</div>
          {show && <div style={{ marginTop: 8, padding: 10, background: "rgba(0,0,0,0.4)", borderRadius: 8, fontSize: 11, color: "#9ca3af", lineHeight: 1.6, borderLeft: "2px solid #f97316" }}>{tip}</div>}
        </div>
      </div>

      {/* Guide view */}
      {view === "guide" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

          {/* DEXScreener config */}
          <div style={{ background: "rgba(249,115,22,0.06)", border: "1px solid rgba(249,115,22,0.2)", borderRadius: 16, padding: "18px" }}>
            <div style={{ fontSize: 11, color: "#f97316", fontWeight: 700, marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              ⚙️ Configuration DEXScreener
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {[
                { label: "Rank", value: "Trending 6H", tip: "6H = activité soutenue depuis plusieurs heures. 1H pour surveiller en journée. Jamais 5min (trop de bruit)" },
                { label: "Sort pairs", value: "Most Volume", tip: "Les tokens qui bougent vraiment" },
                { label: "Market Cap", value: "1M$ → 50M$", tip: "Zone idéale pour un pump x10-x100" },
                { label: "Liquidity", value: "100K$ → 500K$", tip: "Assez liquide pour trader mais pas trop" },
                { label: "Volume", value: "Min 1M$", tip: "Élimine les tokens morts" },
                { label: "Pair Age", value: "Min 7 jours", tip: "Élimine les scams de 24h" },
                { label: "TXNS", value: "Min 500", tip: "Activité réelle, pas du volume artificiel" },
              ].map((item, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "#e5e7eb" }}>{item.label}</div>
                    <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>{item.tip}</div>
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#f97316", fontFamily: "monospace", textAlign: "right", flexShrink: 0, marginLeft: 12 }}>{item.value}</div>
                </div>
              ))}
            </div>
          </div>

          {/* VOL/LIQ ratio guide */}
          <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16, padding: "18px" }}>
            <div style={{ fontSize: 11, color: "#6b7280", fontWeight: 700, marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              📊 Lire le ratio VOL/LIQ
            </div>
            <div style={{ fontSize: 12, color: "#9ca3af", lineHeight: 1.7, marginBottom: 12 }}>
              VOL ÷ LIQ = combien de fois le token a été échangé par rapport à ce qui est disponible. Si VOL &lt; LIQ → token mort, passe au suivant.
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {[
                { ratio: "< 1x", signal: "❌", label: "Token mort", color: "#f87171", bg: "rgba(248,113,113,0.08)" },
                { ratio: "1x — 5x", signal: "😴", label: "Rien d'exceptionnel", color: "#6b7280", bg: "rgba(255,255,255,0.03)" },
                { ratio: "5x — 10x", signal: "👀", label: "Quelque chose commence", color: "#facc15", bg: "rgba(250,204,21,0.08)" },
                { ratio: "10x — 50x", signal: "🔥", label: "Signal fort — creuse", color: "#f97316", bg: "rgba(249,115,22,0.08)" },
                { ratio: "> 50x", signal: "💥", label: "Manipulation probable", color: "#c084fc", bg: "rgba(192,132,252,0.08)" },
              ].map((row, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderRadius: 8, background: row.bg }}>
                  <span style={{ fontSize: 16, minWidth: 24 }}>{row.signal}</span>
                  <div style={{ fontFamily: "monospace", fontSize: 12, fontWeight: 700, color: row.color, minWidth: 70 }}>{row.ratio}</div>
                  <div style={{ fontSize: 12, color: "#9ca3af" }}>{row.label}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Float guide */}
          <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16, padding: "18px" }}>
            <div style={{ fontSize: 11, color: "#6b7280", fontWeight: 700, marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              🫧 Lire le Float (sur CoinGecko)
            </div>
            <div style={{ fontSize: 12, color: "#9ca3af", lineHeight: 1.7, marginBottom: 12 }}>
              Float = Offre en circulation ÷ Offre totale × 100. Plus c'est bas, plus l'équipe contrôle le supply et peut déclencher un pump.
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {[
                { range: "≤ 25%", signal: "✅", label: "Low float — setup idéal", color: "#4ade80", bg: "rgba(74,222,128,0.08)" },
                { range: "25% — 40%", signal: "⚠️", label: "Acceptable", color: "#facc15", bg: "rgba(250,204,21,0.08)" },
                { range: "40% — 80%", signal: "❌", label: "Trop distribué", color: "#f87171", bg: "rgba(248,113,113,0.08)" },
                { range: "100%", signal: "💀", label: "Tout circule — pas de levier", color: "#6b7280", bg: "rgba(255,255,255,0.03)" },
              ].map((row, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderRadius: 8, background: row.bg }}>
                  <span style={{ fontSize: 16, minWidth: 24 }}>{row.signal}</span>
                  <div style={{ fontFamily: "monospace", fontSize: 12, fontWeight: 700, color: row.color, minWidth: 70 }}>{row.range}</div>
                  <div style={{ fontSize: 12, color: "#9ca3af" }}>{row.label}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Quick checklist */}
          <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16, padding: "18px" }}>
            <div style={{ fontSize: 11, color: "#6b7280", fontWeight: 700, marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              ✅ Checklist rapide — 3 secondes par token
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {[
                { q: "VOL > LIQ ?", oui: "Continue", non: "Passe au suivant ❌" },
                { q: "VOL/LIQ > 5x ?", oui: "Intéressant 👀", non: "Passe au suivant ❌" },
                { q: "MCAP entre 1M-50M$ ?", oui: "Continue", non: "Trop gros ou trop petit ❌" },
                { q: "Buys > Sells ?", oui: "Quelqu'un accumule 🔥", non: "Distribution en cours ❌" },
                { q: "Age > 7 jours ?", oui: "Continue", non: "Trop récent, probable scam ❌" },
              ].map((item, i) => (
                <div key={i} style={{ padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#e5e7eb", marginBottom: 4 }}>→ {item.q}</div>
                  <div style={{ display: "flex", gap: 16, fontSize: 11 }}>
                    <span style={{ color: "#4ade80" }}>✓ OUI : {item.oui}</span>
                    <span style={{ color: "#f87171" }}>✗ NON : {item.non}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Workflow */}
          <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16, padding: "18px" }}>
            <div style={{ fontSize: 11, color: "#6b7280", fontWeight: 700, marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              🔄 Workflow quotidien
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {[
                { step: "1", label: "DEXScreener", action: "Trending + filtres → repère les tokens avec VOL >> LIQ", time: "5 min" },
                { step: "2", label: "Bubblemaps", action: "Grosses bulles connectées ? → équipe contrôle le supply", time: "1 min" },
                { step: "3", label: "Scanner", action: "Lance l'analyse complète → score /5 + narratif", time: "40 sec" },
                { step: "4", label: "Coinglass", action: "Funding rate négatif ? → shorts en place = squeeze potentiel", time: "30 sec" },
                { step: "5", label: "X / Twitter", action: "KOLs en parlent ? Narratif qui monte ?", time: "2 min" },
              ].map((item, i) => (
                <div key={i} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                  <div style={{ width: 24, height: 24, borderRadius: "50%", background: "rgba(249,115,22,0.2)", border: "1px solid rgba(249,115,22,0.4)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: "#f97316", flexShrink: 0 }}>{item.step}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "#e5e7eb" }}>{item.label}</div>
                      <div style={{ fontSize: 11, color: "#4b5563" }}>{item.time}</div>
                    </div>
                    <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>{item.action}</div>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 12, padding: "10px 12px", background: "rgba(249,115,22,0.06)", borderRadius: 8, fontSize: 12, color: "#9ca3af" }}>
              ⏱ Total : ~10 minutes par session. Fais-le matin et soir.
            </div>
          </div>

          <div style={{ fontSize: 11, color: "#4b5563", textAlign: "center", paddingBottom: 16 }}>Pas un conseil financier. DYOR.</div>
        </div>
      )}
    </div>
  );
}

const fmt = (n) => {
  if (n == null) return null;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${parseFloat(n).toFixed(4)}`;
};

const fmtPrice = (n) => {
  if (!n) return "—";
  if (n < 0.0001) return `$${n.toFixed(8)}`;
  if (n < 0.01) return `$${n.toFixed(6)}`;
  if (n < 1) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(3)}`;
};

const ANALYSIS_STEPS = [
  { label: "Données marché", sub: "DEXScreener · CoinGecko" },
  { label: "Analyse du narratif", sub: "News · Twitter · Produit réel" },
  { label: "Calcul du score final", sub: "" },
];

export default function App() {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [step, setStep] = useState(-1);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [scanResults, setScanResults] = useState(null);
  const [view, setView] = useState("search"); // "search" | "scan" | "guide" | "watchlist"
  const [watchlist, setWatchlist] = useState(() => {
    try { return JSON.parse(localStorage.getItem("watchlist") || "[]"); } catch { return []; }
  });

  const addToWatchlist = (token) => {
    const item = {
      symbol: token.symbol,
      name: token.name,
      floatPct: token.floatPct,
      narrativeScore: token.narrative?.score || 0,
      narrativeColor: token.narrative?.verdictColor || "#6b7280",
      score: token.score,
      addedAt: new Date().toISOString(),
      dexUrl: token.dexUrl,
      coinglassUrl: token.coinglassUrl,
      bubblemapsUrl: token.bubblemapsUrl,
    };
    const updated = [item, ...watchlist.filter(w => w.symbol !== token.symbol)];
    setWatchlist(updated);
    localStorage.setItem("watchlist", JSON.stringify(updated));
    alert(token.symbol + " ajouté à la watchlist !");
  };

  const removeFromWatchlist = (symbol) => {
    const updated = watchlist.filter(w => w.symbol !== symbol);
    setWatchlist(updated);
    localStorage.setItem("watchlist", JSON.stringify(updated));
  };

  const analyze = useCallback(async (symbolOverride) => {
    const sym = symbolOverride || input;
    if (!sym.trim() || loading) return;
    if (symbolOverride) setInput(symbolOverride);
    setView("search");
    setLoading(true);
    setError("");
    setResult(null);
    setStep(0);

    try {
      const symbol = sym.trim().toUpperCase();
      const raw = await fetchMarketData(symbol);
      if (!raw.found) { setError("Token introuvable."); setLoading(false); return; }

      setStep(1);
      const narrative = await fetchNarrative(symbol, raw.name);

      setStep(2);
      const volLiqRatio = raw.volume24h && raw.liquidity ? raw.volume24h / raw.liquidity : null;
      const floatPct = raw.circulatingSupply && raw.totalSupply ? (raw.circulatingSupply / raw.totalSupply) * 100 : null;

      const signals = {
        volumeExplosion: volLiqRatio != null ? (volLiqRatio >= 10 ? true : volLiqRatio >= 5 ? "warn" : false) : null,
        lowFloat: floatPct != null ? (floatPct <= 25 ? true : floatPct <= 40 ? "warn" : false) : null,
        mcapZone: raw.marketCap ? (raw.marketCap >= 1e6 && raw.marketCap <= 50e6 ? true : raw.marketCap <= 100e6 ? "warn" : false) : null,
        notTooNew: raw.tokenAgeDays != null ? (raw.tokenAgeDays >= 30 ? true : raw.tokenAgeDays >= 7 ? "warn" : false) : null,
        narrative: narrative.score >= 7 ? true : narrative.score >= 5 ? "warn" : false,
      };

      let score = 0;
      Object.values(signals).forEach(s => { if (s === true) score++; else if (s === "warn") score += 0.5; });

      const verdict = score >= 4 ? { label: "Setup potentiel 🔥", color: "#f97316" }
        : score >= 2.5 ? { label: "À surveiller 👀", color: "#facc15" }
        : { label: "Pas intéressant ❌", color: "#f87171" };

      const bubblemapsUrl = raw.contractAddress && raw.contractAddress.length > 10 && !raw.contractAddress.includes("...")
        ? `https://app.bubblemaps.io/${raw.chain || "eth"}/token/${raw.contractAddress}`
        : `https://app.bubblemaps.io`;

      setResult({
        ...raw, volLiqRatio, floatPct, signals, score, verdict, narrative,
        bubblemapsUrl,
        coingeckoUrl: raw.coingeckoId ? `https://www.coingecko.com/en/coins/${raw.coingeckoId}` : null,
        coinglassUrl: `https://www.coinglass.com/currencies/${symbol}`,
        dexUrl: raw.dexUrl || `https://dexscreener.com/search?q=${symbol}`,
      });
    } catch (e) { setError(e.message); }
    setLoading(false);
    setStep(-1);
  }, [input, loading]);

  const doScan = useCallback(async () => {
    setScanning(true);
    setScanResults(null);
    setError("");
    setView("scan");
    try {
      const results = await scanMarket();
      setScanResults(results);
    } catch (e) {
      setError(e.message);
      setView("search");
    }
    setScanning(false);
  }, []);

  const signalColor = (s) => s === "🔥" ? "#f97316" : s === "👀" ? "#facc15" : "#f87171";

  return (
    <div style={{ minHeight: "100vh", background: "#0a0a0f", color: "#e5e7eb", fontFamily: "system-ui, sans-serif", padding: "24px 16px", maxWidth: 480, margin: "0 auto" }}>
      <style>{`
        * { box-sizing: border-box; }
        input::placeholder { color: #4b5563; }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
        @keyframes spin { to { transform: rotate(360deg); } }
        .token-card:hover { background: rgba(255,255,255,0.07) !important; cursor: pointer; }
      `}</style>

      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#f97316", boxShadow: "0 0 12px #f97316", animation: "pulse 2s infinite" }} />
          <span style={{ fontSize: 11, color: "#6b7280", letterSpacing: "0.1em", textTransform: "uppercase", fontFamily: "monospace" }}>Crypto Scanner</span>
        </div>
        <h1 style={{ fontSize: 26, fontWeight: 800, margin: 0, background: "linear-gradient(135deg, #f97316, #fbbf24)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
          Détecteur de<br />Manipulation
        </h1>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 6, marginBottom: 20 }}>
        <button onClick={() => setView("search")} style={{ flex: 1, padding: "10px", borderRadius: 10, border: "none", fontWeight: 700, fontSize: 12, cursor: "pointer", background: view === "search" ? "#f97316" : "rgba(255,255,255,0.05)", color: view === "search" ? "white" : "#6b7280" }}>
          🔍 Analyser
        </button>
        <button onClick={() => { setView("scan"); if (!scanResults && !scanning) doScan(); }} style={{ flex: 1, padding: "10px", borderRadius: 10, border: "none", fontWeight: 700, fontSize: 12, cursor: "pointer", background: view === "scan" ? "#f97316" : "rgba(255,255,255,0.05)", color: view === "scan" ? "white" : "#6b7280" }}>
          📡 Scanner
        </button>
        <button onClick={() => setView("guide")} style={{ flex: 1, padding: "10px", borderRadius: 10, border: "none", fontWeight: 700, fontSize: 12, cursor: "pointer", background: view === "guide" ? "#f97316" : "rgba(255,255,255,0.05)", color: view === "guide" ? "white" : "#6b7280" }}>
          📖 Guide
        </button>
        <button onClick={() => setView("watchlist")} style={{ flex: 1, padding: "10px", borderRadius: 10, border: "none", fontWeight: 700, fontSize: 12, cursor: "pointer", background: view === "watchlist" ? "#f97316" : "rgba(255,255,255,0.05)", color: view === "watchlist" ? "white" : "#6b7280", position: "relative" }}>
          ⭐{watchlist.length > 0 ? ` ${watchlist.length}` : ""}
        </button>
      </div>

      {/* Search view */}
      {view === "search" && (
        <>
          <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
            <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === "Enter" && analyze()}
              placeholder="Symbole: RAVE, COAI, BTC..."
              style={{ flex: 1, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10, padding: "12px 16px", color: "#e5e7eb", fontSize: 15, outline: "none" }} />
            <button onClick={() => analyze()} disabled={loading} style={{ background: loading ? "rgba(249,115,22,0.3)" : "#f97316", border: "none", borderRadius: 10, padding: "12px 20px", color: "white", fontWeight: 700, fontSize: 14, cursor: loading ? "not-allowed" : "pointer" }}>
              {loading ? "⏳" : "GO"}
            </button>
          </div>

          {loading && (
            <div style={{ padding: "24px 0" }}>
              {ANALYSIS_STEPS.map((s, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", opacity: i <= step ? 1 : 0.25, transition: "opacity 0.5s" }}>
                  <div style={{ width: 28, height: 28, borderRadius: "50%", flexShrink: 0, background: i < step ? "rgba(74,222,128,0.15)" : i === step ? "rgba(249,115,22,0.15)" : "rgba(255,255,255,0.05)", border: i < step ? "1px solid #4ade80" : i === step ? "1px solid #f97316" : "1px solid rgba(255,255,255,0.1)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, animation: i === step ? "spin 1.2s linear infinite" : "none", color: i < step ? "#4ade80" : i === step ? "#f97316" : "#6b7280" }}>
                    {i < step ? "✓" : "⚙"}
                  </div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: i === step ? "#e5e7eb" : "#6b7280" }}>{s.label}</div>
                    {s.sub && <div style={{ fontSize: 11, color: "#4b5563" }}>{s.sub}</div>}
                  </div>
                </div>
              ))}
              <div style={{ fontSize: 11, color: "#4b5563", marginTop: 8, paddingLeft: 40 }}>~30-40 secondes</div>
            </div>
          )}

          {error && <div style={{ background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.3)", borderRadius: 10, padding: "12px 16px", color: "#f87171", fontSize: 13, marginBottom: 12 }}>⚠️ {error}</div>}

          {result && !loading && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {/* Token header */}
              <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16, padding: "18px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={{ fontSize: 22, fontWeight: 800, fontFamily: "monospace" }}>{result.symbol}</div>
                  <div style={{ fontSize: 13, color: "#6b7280" }}>{result.name}</div>
                  {result.tokenAgeDays != null && <div style={{ fontSize: 11, color: "#4b5563", marginTop: 2 }}>Créé il y a {result.tokenAgeDays} jours</div>}
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 18, fontWeight: 700, fontFamily: "monospace" }}>{fmtPrice(result.price)}</div>
                  {result.priceChange24h != null && <div style={{ fontSize: 13, fontWeight: 600, color: result.priceChange24h >= 0 ? "#4ade80" : "#f87171" }}>{result.priceChange24h >= 0 ? "+" : ""}{parseFloat(result.priceChange24h).toFixed(1)}% 24h</div>}
                </div>
              </div>

              {/* Verdict */}
              <div style={{ background: `${result.verdict.color}18`, border: `1px solid ${result.verdict.color}44`, borderRadius: 16, padding: "18px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={{ fontSize: 10, color: "#6b7280", letterSpacing: "0.1em", textTransform: "uppercase", fontFamily: "monospace", marginBottom: 4 }}>Verdict global</div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: result.verdict.color }}>{result.verdict.label}</div>
                  <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>Score {result.score}/5 · funding rate non inclus</div>
                </div>
                <ScoreBar value={Math.round(result.score)} max={5} />
              </div>

              {/* Metrics */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <Metric label="VOL/LIQ" value={result.volLiqRatio ? `${result.volLiqRatio.toFixed(0)}x` : null} sub={`${fmt(result.volume24h)} / ${fmt(result.liquidity)}`} good={result.volLiqRatio >= 10} bad={result.volLiqRatio != null && result.volLiqRatio < 5} tip="Volume / liquidité disponible. ≥10x = signal fort de manipulation ou FOMO. RAVE était à 40x avant l'explosion." />
                <Metric label="Float" value={result.floatPct ? `${result.floatPct.toFixed(0)}%` : null} sub="en circulation" good={result.floatPct <= 25} bad={result.floatPct > 50} tip="% de tokens qui circulent vraiment. ≤25% = l'équipe contrôle la majorité et peut déclencher un pump." />
                <Metric label="Market Cap" value={fmt(result.marketCap)} sub="idéal: 1M–50M$" good={result.marketCap >= 1e6 && result.marketCap <= 50e6} bad={result.marketCap > 100e6} tip="Zone idéale : 1M–50M$. RAVE était à ~3M$ avant d'exploser à 3B$." />
                <div style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, padding: "14px 16px", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
                  <div style={{ fontSize: 10, color: "#9ca3af", letterSpacing: "0.1em", textTransform: "uppercase", fontFamily: "monospace", marginBottom: 6 }}>Funding Rate</div>
                  <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 8, lineHeight: 1.4 }}>Très négatif = beaucoup de shorts = squeeze potentiel.</div>
                  <a href={result.coinglassUrl} target="_blank" rel="noreferrer" style={{ background: "#f97316", borderRadius: 8, padding: "7px 10px", color: "white", textDecoration: "none", textAlign: "center", fontSize: 12, fontWeight: 700 }}>📊 Coinglass →</a>
                </div>
              </div>

              {/* Narrative */}
              {result.narrative && (
                <div style={{ background: `${result.narrative.verdictColor || "#6b7280"}12`, border: `1px solid ${result.narrative.verdictColor || "#6b7280"}33`, borderRadius: 16, padding: "18px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                    <div>
                      <div style={{ fontSize: 10, color: "#6b7280", letterSpacing: "0.1em", textTransform: "uppercase", fontFamily: "monospace", marginBottom: 4 }}>Narratif</div>
                      <div style={{ fontSize: 18, fontWeight: 800, color: result.narrative.verdictColor }}>{result.narrative.verdict}</div>
                    </div>
                    <div style={{ width: 52, height: 52, borderRadius: "50%", flexShrink: 0, background: `${result.narrative.verdictColor}22`, border: `2px solid ${result.narrative.verdictColor}66`, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
                      <div style={{ fontSize: 18, fontWeight: 800, color: result.narrative.verdictColor, lineHeight: 1 }}>{result.narrative.score}</div>
                      <div style={{ fontSize: 9, color: "#6b7280" }}>/10</div>
                    </div>
                  </div>
                  <div style={{ fontSize: 13, color: "#e5e7eb", fontWeight: 600, marginBottom: 8 }}>{result.narrative.oneLiner}</div>
                  <div style={{ fontSize: 12, color: "#9ca3af", lineHeight: 1.7 }}>{result.narrative.summary}</div>
                  {result.narrative.redFlag && result.narrative.redFlagDetail && (
                    <div style={{ marginTop: 10, padding: "10px 12px", background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.3)", borderRadius: 8, fontSize: 12, color: "#f87171" }}>⚠️ {result.narrative.redFlagDetail}</div>
                  )}
                </div>
              )}

              {/* Signals */}
              <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16, padding: "18px" }}>
                <div style={{ fontSize: 10, color: "#6b7280", letterSpacing: "0.1em", textTransform: "uppercase", fontFamily: "monospace", marginBottom: 10 }}>Signaux détaillés</div>
                <Signal label="Volume qui explose" signal={result.signals.volumeExplosion} description={result.volLiqRatio ? `VOL/LIQ: ${result.volLiqRatio.toFixed(0)}x (idéal ≥10x)` : "Données insuffisantes"} tip="Ratio élevé = le token tourne beaucoup par rapport à ce qui est disponible. RAVE était à 40x avant l'explosion." />
                <Signal label="Low float" signal={result.signals.lowFloat} description={result.floatPct ? `${result.floatPct.toFixed(0)}% en circulation (idéal ≤25%)` : "Données insuffisantes"} tip="Peu de tokens = l'équipe contrôle et peut déclencher un pump. RAVE avait 24% en circulation." />
                <Signal label="Market cap zone" signal={result.signals.mcapZone} description={result.marketCap ? `${fmt(result.marketCap)} (zone: 1M–50M$)` : "Données insuffisantes"} tip="Petit mcap = peu d'argent pour bouger le prix. RAVE était à 3M$ avant x1000." />
                <Signal label="Token mature" signal={result.signals.notTooNew} description={result.tokenAgeDays != null ? `${result.tokenAgeDays} jours (idéal: ≥30j)` : "Âge inconnu"} tip="Token récent = souvent un scam. 30j+ = a survécu aux premières ventes." />
                <Signal label="Narratif" signal={result.signals.narrative} description={`${result.narrative?.score || 0}/10 — ${result.narrative?.oneLiner || "Indisponible"}`} tip="Narratif réel = pump qui dure. Sans narratif = dump rapide." />
              </div>

              {/* Manual checks */}
              <div style={{ background: "rgba(249,115,22,0.06)", border: "1px solid rgba(249,115,22,0.2)", borderRadius: 12, padding: "14px 16px" }}>
                <div style={{ fontSize: 11, color: "#f97316", fontWeight: 700, marginBottom: 8, textTransform: "uppercase" }}>✋ À vérifier manuellement</div>
                <div style={{ fontSize: 12, color: "#9ca3af", lineHeight: 1.8 }}>
                  <div><strong style={{ color: "#e5e7eb" }}>📊 Funding rate</strong> → Coinglass <span style={{ color: "#6b7280" }}>(très négatif = carburant squeeze)</span></div>
                  <div><strong style={{ color: "#e5e7eb" }}>🫧 Supply concentré</strong> → Bubblemaps <span style={{ color: "#6b7280" }}>(grosses bulles = équipe contrôle)</span></div>
                  <div><strong style={{ color: "#e5e7eb" }}>𝕏 Hype en cours</strong> → X live <span style={{ color: "#6b7280" }}>(KOLs qui en parlent ?)</span></div>
                </div>
              </div>

              {/* Links */}
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {[
                  { label: "🫧 Bubblemaps", href: result.bubblemapsUrl },
                  { label: "📊 DEXScreener", href: result.dexUrl },
                  { label: "📈 Coinglass", href: result.coinglassUrl },
                  { label: "𝕏 Live X", href: `https://x.com/search?q=%24${result.symbol}&src=typed_query&f=live` },
                  ...(result.coingeckoUrl ? [{ label: "🦎 CoinGecko", href: result.coingeckoUrl }] : []),
                ].map((l, i) => (
                  <a key={i} href={l.href} target="_blank" rel="noreferrer" style={{ flex: 1, minWidth: 80, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, padding: "10px 6px", color: "#e5e7eb", textDecoration: "none", textAlign: "center", fontSize: 11, fontWeight: 600 }}>{l.label}</a>
                ))}
              </div>

              <div style={{ fontSize: 11, color: "#4b5563", textAlign: "center", paddingBottom: 16 }}>Pas un conseil financier. DYOR.</div>
            </div>
          )}
        </>
      )}

      {/* Scan view */}
      {view === "scan" && (
        <>
          {scanning && (
            <div style={{ textAlign: "center", padding: "40px 0", color: "#6b7280" }}>
              <div style={{ fontSize: 40, animation: "spin 1.5s linear infinite", display: "inline-block", marginBottom: 16 }}>📡</div>
              <div style={{ fontSize: 14, color: "#9ca3af", marginBottom: 4 }}>Scan du marché en cours...</div>
              <div style={{ fontSize: 12, color: "#4b5563" }}>Analyse des trending tokens (~30s)</div>
            </div>
          )}

          {error && <div style={{ background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.3)", borderRadius: 10, padding: "12px 16px", color: "#f87171", fontSize: 13, marginBottom: 12 }}>⚠️ {error}</div>}

          {scanResults && !scanning && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                <div style={{ fontSize: 13, color: "#6b7280" }}>{scanResults.length} tokens trouvés · Clique pour analyser</div>
                <button onClick={doScan} style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, padding: "6px 12px", color: "#9ca3af", fontSize: 11, cursor: "pointer", fontWeight: 600 }}>🔄 Rescanner</button>
              </div>

              {scanResults.map((t, i) => (
                <div key={i} className="token-card" onClick={() => analyze(t.symbol)}
                  style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 14, padding: "16px", transition: "background 0.2s" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{ fontSize: 22 }}>{t.signal}</div>
                      <div>
                        <div style={{ fontSize: 16, fontWeight: 800, fontFamily: "monospace", color: "#e5e7eb" }}>{t.symbol}</div>
                        <div style={{ fontSize: 11, color: "#6b7280" }}>{t.name}</div>
                      </div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 14, fontWeight: 700, fontFamily: "monospace" }}>{fmtPrice(t.price)}</div>
                      {t.priceChange24h != null && (
                        <div style={{ fontSize: 12, fontWeight: 600, color: t.priceChange24h >= 0 ? "#4ade80" : "#f87171" }}>
                          {t.priceChange24h >= 0 ? "+" : ""}{parseFloat(t.priceChange24h).toFixed(1)}%
                        </div>
                      )}
                    </div>
                  </div>

                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
                    {[
                      { label: "MCAP", val: fmt(t.marketCap) },
                      { label: "VOL/LIQ", val: t.volLiqRatio ? `${parseFloat(t.volLiqRatio).toFixed(0)}x` : null, good: t.volLiqRatio >= 10, bad: t.volLiqRatio < 5 },
                      { label: "FLOAT", val: t.floatPct != null ? `${parseFloat(t.floatPct).toFixed(0)}%` : null, good: t.floatPct <= 25, bad: t.floatPct > 50 },
                      { label: "AGE", val: t.tokenAgeDays ? `${t.tokenAgeDays}j` : null },
                    ].filter(p => p.val).map((p, j) => (
                      <div key={j} style={{ fontSize: 11, padding: "3px 8px", borderRadius: 6, background: p.good ? "rgba(74,222,128,0.08)" : p.bad ? "rgba(248,113,113,0.08)" : "rgba(255,255,255,0.06)", color: "#9ca3af", fontFamily: "monospace", border: p.good ? "1px solid rgba(74,222,128,0.2)" : p.bad ? "1px solid rgba(248,113,113,0.2)" : "1px solid transparent" }}>
                        {p.label}: <strong style={{ color: p.good ? "#4ade80" : p.bad ? "#f87171" : "#e5e7eb" }}>{p.val}</strong>
                      </div>
                    ))}
                  </div>

                  <div style={{ fontSize: 12, color: signalColor(t.signal), fontWeight: 500 }}>→ {t.reason}</div>

                  <div style={{ marginTop: 10, fontSize: 11, color: "#f97316", fontWeight: 600, textAlign: "right" }}>
                    Analyser en détail →
                  </div>
                </div>
              ))}

              <div style={{ fontSize: 11, color: "#4b5563", textAlign: "center", paddingBottom: 16 }}>
                Clique sur un token pour lancer l'analyse complète. Pas un conseil financier.
              </div>
            </div>
          )}
        </>
      )}

      {/* Guide view */}
      {view === "guide" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

          {/* DEXScreener config */}
          <div style={{ background: "rgba(249,115,22,0.06)", border: "1px solid rgba(249,115,22,0.2)", borderRadius: 16, padding: "18px" }}>
            <div style={{ fontSize: 11, color: "#f97316", fontWeight: 700, marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              ⚙️ Configuration DEXScreener
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {[
                { label: "Rank", value: "Trending 6H", tip: "6H = activité soutenue depuis plusieurs heures. 1H pour surveiller en journée. Jamais 5min (trop de bruit)" },
                { label: "Sort pairs", value: "Most Volume", tip: "Les tokens qui bougent vraiment" },
                { label: "Market Cap", value: "1M$ → 50M$", tip: "Zone idéale pour un pump x10-x100" },
                { label: "Liquidity", value: "100K$ → 500K$", tip: "Assez liquide pour trader mais pas trop" },
                { label: "Volume", value: "Min 1M$", tip: "Élimine les tokens morts" },
                { label: "Pair Age", value: "Min 7 jours", tip: "Élimine les scams de 24h" },
                { label: "TXNS", value: "Min 500", tip: "Activité réelle, pas du volume artificiel" },
              ].map((item, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "#e5e7eb" }}>{item.label}</div>
                    <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>{item.tip}</div>
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#f97316", fontFamily: "monospace", textAlign: "right", flexShrink: 0, marginLeft: 12 }}>{item.value}</div>
                </div>
              ))}
            </div>
          </div>

          {/* VOL/LIQ ratio guide */}
          <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16, padding: "18px" }}>
            <div style={{ fontSize: 11, color: "#6b7280", fontWeight: 700, marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              📊 Lire le ratio VOL/LIQ
            </div>
            <div style={{ fontSize: 12, color: "#9ca3af", lineHeight: 1.7, marginBottom: 12 }}>
              VOL ÷ LIQ = combien de fois le token a été échangé par rapport à ce qui est disponible. Si VOL &lt; LIQ → token mort, passe au suivant.
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {[
                { ratio: "< 1x", signal: "❌", label: "Token mort", color: "#f87171", bg: "rgba(248,113,113,0.08)" },
                { ratio: "1x — 5x", signal: "😴", label: "Rien d'exceptionnel", color: "#6b7280", bg: "rgba(255,255,255,0.03)" },
                { ratio: "5x — 10x", signal: "👀", label: "Quelque chose commence", color: "#facc15", bg: "rgba(250,204,21,0.08)" },
                { ratio: "10x — 50x", signal: "🔥", label: "Signal fort — creuse", color: "#f97316", bg: "rgba(249,115,22,0.08)" },
                { ratio: "> 50x", signal: "💥", label: "Manipulation probable", color: "#c084fc", bg: "rgba(192,132,252,0.08)" },
              ].map((row, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderRadius: 8, background: row.bg }}>
                  <span style={{ fontSize: 16, minWidth: 24 }}>{row.signal}</span>
                  <div style={{ fontFamily: "monospace", fontSize: 12, fontWeight: 700, color: row.color, minWidth: 70 }}>{row.ratio}</div>
                  <div style={{ fontSize: 12, color: "#9ca3af" }}>{row.label}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Float guide */}
          <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16, padding: "18px" }}>
            <div style={{ fontSize: 11, color: "#6b7280", fontWeight: 700, marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              🫧 Lire le Float (sur CoinGecko)
            </div>
            <div style={{ fontSize: 12, color: "#9ca3af", lineHeight: 1.7, marginBottom: 12 }}>
              Float = Offre en circulation ÷ Offre totale × 100. Plus c'est bas, plus l'équipe contrôle le supply et peut déclencher un pump.
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {[
                { range: "≤ 25%", signal: "✅", label: "Low float — setup idéal", color: "#4ade80", bg: "rgba(74,222,128,0.08)" },
                { range: "25% — 40%", signal: "⚠️", label: "Acceptable", color: "#facc15", bg: "rgba(250,204,21,0.08)" },
                { range: "40% — 80%", signal: "❌", label: "Trop distribué", color: "#f87171", bg: "rgba(248,113,113,0.08)" },
                { range: "100%", signal: "💀", label: "Tout circule — pas de levier", color: "#6b7280", bg: "rgba(255,255,255,0.03)" },
              ].map((row, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderRadius: 8, background: row.bg }}>
                  <span style={{ fontSize: 16, minWidth: 24 }}>{row.signal}</span>
                  <div style={{ fontFamily: "monospace", fontSize: 12, fontWeight: 700, color: row.color, minWidth: 70 }}>{row.range}</div>
                  <div style={{ fontSize: 12, color: "#9ca3af" }}>{row.label}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Quick checklist */}
          <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16, padding: "18px" }}>
            <div style={{ fontSize: 11, color: "#6b7280", fontWeight: 700, marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              ✅ Checklist rapide — 3 secondes par token
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {[
                { q: "VOL > LIQ ?", oui: "Continue", non: "Passe au suivant ❌" },
                { q: "VOL/LIQ > 5x ?", oui: "Intéressant 👀", non: "Passe au suivant ❌" },
                { q: "MCAP entre 1M-50M$ ?", oui: "Continue", non: "Trop gros ou trop petit ❌" },
                { q: "Buys > Sells ?", oui: "Quelqu'un accumule 🔥", non: "Distribution en cours ❌" },
                { q: "Age > 7 jours ?", oui: "Continue", non: "Trop récent, probable scam ❌" },
              ].map((item, i) => (
                <div key={i} style={{ padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#e5e7eb", marginBottom: 4 }}>→ {item.q}</div>
                  <div style={{ display: "flex", gap: 16, fontSize: 11 }}>
                    <span style={{ color: "#4ade80" }}>✓ OUI : {item.oui}</span>
                    <span style={{ color: "#f87171" }}>✗ NON : {item.non}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Workflow */}
          <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16, padding: "18px" }}>
            <div style={{ fontSize: 11, color: "#6b7280", fontWeight: 700, marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              🔄 Workflow quotidien
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {[
                { step: "1", label: "DEXScreener", action: "Trending + filtres → repère les tokens avec VOL >> LIQ", time: "5 min" },
                { step: "2", label: "Bubblemaps", action: "Grosses bulles connectées ? → équipe contrôle le supply", time: "1 min" },
                { step: "3", label: "Scanner", action: "Lance l'analyse complète → score /5 + narratif", time: "40 sec" },
                { step: "4", label: "Coinglass", action: "Funding rate négatif ? → shorts en place = squeeze potentiel", time: "30 sec" },
                { step: "5", label: "X / Twitter", action: "KOLs en parlent ? Narratif qui monte ?", time: "2 min" },
              ].map((item, i) => (
                <div key={i} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                  <div style={{ width: 24, height: 24, borderRadius: "50%", background: "rgba(249,115,22,0.2)", border: "1px solid rgba(249,115,22,0.4)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: "#f97316", flexShrink: 0 }}>{item.step}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "#e5e7eb" }}>{item.label}</div>
                      <div style={{ fontSize: 11, color: "#4b5563" }}>{item.time}</div>
                    </div>
                    <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>{item.action}</div>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 12, padding: "10px 12px", background: "rgba(249,115,22,0.06)", borderRadius: 8, fontSize: 12, color: "#9ca3af" }}>
              ⏱ Total : ~10 minutes par session. Fais-le matin et soir.
            </div>
          </div>

          <div style={{ fontSize: 11, color: "#4b5563", textAlign: "center", paddingBottom: 16 }}>Pas un conseil financier. DYOR.</div>
        </div>
      )}
    </div>
  );
}
