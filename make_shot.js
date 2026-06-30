/* =========================================================
   投稿スロットの「カード画像＋ツイート本文」を生成して shots/ に保存
   GitHub Actionが各セッション時刻に実行。当日分を固定名で上書き（循環）。
   出力: shots/slotN.png（画像） / shots/slotN.txt（本文・リンクなし＋補助注記）
   ※X APIは使わない（投稿はあくまで手動）。課金ゼロ。
   ========================================================= */
const fs = require("fs");

const SITE = "https://usdjpy-sr-lines.netlify.app";
const f3 = (n) => (n == null ? "—" : Number(n).toFixed(3));

// UTC時刻 → スロット番号（0-6→1 東京 / 7-11→2 ロンドン / 12→3 重複 / 13+→4 NY）
function currentSlot() {
  const h = new Date().getUTCHours();
  return h < 7 ? 1 : h < 12 ? 2 : h < 13 ? 3 : 4;
}

function jstParts() {
  const j = new Date(Date.now() + 9 * 3600 * 1000);
  return {
    mmdd: `${j.getUTCMonth() + 1}/${j.getUTCDate()}`,
    hhmm: `${String(j.getUTCHours()).padStart(2, "0")}:${String(j.getUTCMinutes()).padStart(2, "0")}`,
  };
}

function footLabel(n) { return n >= 2 ? `${n}足合流` : `${n}足`; }
function pick(d) {
  const price = d.price, confs = d.confluence || [], h1 = (d.timeframes && d.timeframes["1h"]) || {};
  const r = confs.filter((c) => c.side === "R" && c.price > price).sort((a, b) => a.price - b.price)[0];
  const s = confs.filter((c) => c.side === "S" && c.price < price).sort((a, b) => b.price - a.price)[0];
  const strong = confs.slice().sort((a, b) => b.count - a.count)[0];
  return {
    price,
    R: r ? { price: r.price, label: footLabel(r.count) } : (h1.r1 ? { price: h1.r1.price, label: footLabel(h1.r1.conf) } : null),
    S: s ? { price: s.price, label: footLabel(s.count) } : (h1.s1 ? { price: h1.s1.price, label: footLabel(h1.s1.conf) } : null),
    strong: strong ? { price: strong.price, n: strong.count, side: strong.side } : null,
  };
}

function cardHtml(d) {
  const { mmdd, hhmm } = jstParts(), L = pick(d);
  const rTxt = L.R ? `${f3(L.R.price)}　<span class="tag">${L.R.label}</span>` : "—";
  const sTxt = L.S ? `${f3(L.S.price)}　<span class="tag">${L.S.label}</span>` : "—";
  const strong = L.strong ? `${f3(L.strong.price)}（${L.strong.n}足合流・${L.strong.side === "R" ? "抵抗" : "支持"}）` : "—";
  return `<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8"><style>
  *{margin:0;padding:0;box-sizing:border-box}html,body{width:1200px;height:675px;overflow:hidden}
  body{font-family:"Noto Sans CJK JP","Noto Sans JP",sans-serif;color:#e7ecf5;
    background:radial-gradient(1100px 650px at 80% -10%,rgba(59,130,246,.20),transparent 60%),linear-gradient(135deg,#0e1420 0%,#141d2e 55%,#0b1320 100%)}
  .wrap{position:absolute;inset:0;padding:54px 64px;display:flex;flex-direction:column;justify-content:space-between}
  .top{display:flex;align-items:center;justify-content:space-between}
  .badge{font-size:30px;font-weight:800;color:#3b82f6;display:flex;align-items:center;gap:12px}
  .badge .dot{width:14px;height:14px;border-radius:50%;background:#26c281}
  .time{font-size:26px;color:#aeb9cc;font-weight:700}
  .pw{text-align:center}.pl{font-size:24px;color:#8a97ad}.price{font-size:96px;font-weight:900;line-height:1.05}
  .rows{display:flex;flex-direction:column;gap:16px}
  .row{display:flex;align-items:center;gap:20px;background:rgba(29,39,64,.55);border:1px solid #26324a;border-radius:16px;padding:18px 26px}
  .row .k{font-size:30px;font-weight:800;width:150px}.row.r .k{color:#ff5d6c}.row.s .k{color:#26c281}
  .row .v{font-size:42px;font-weight:900}
  .row .tag{font-size:22px;font-weight:800;color:#0e1420;background:#3b82f6;border-radius:8px;padding:4px 12px}
  .strong{font-size:26px;color:#f5b942;font-weight:800;text-align:center}
  .foot{display:flex;align-items:center;justify-content:space-between}
  .url{font-size:28px;color:#8a97ad;font-weight:800}.free{font-size:24px;font-weight:800;color:#0e1420;background:#f5b942;padding:8px 18px;border-radius:10px}
  </style></head><body><div class="wrap">
    <div class="top"><div class="badge"><span class="dot"></span>USD/JPY ライン速報</div><div class="time">${mmdd} ${hhmm} JST</div></div>
    <div class="pw"><div class="pl">現在値</div><div class="price">${f3(L.price)}</div></div>
    <div class="rows">
      <div class="row r"><span class="k">🔴 抵抗</span><span class="v">${rTxt}</span></div>
      <div class="row s"><span class="k">🟢 支持</span><span class="v">${sTxt}</span></div>
    </div>
    <div class="strong">🔗 強合流ゾーン ${strong}</div>
    <div class="foot"><span class="url">usdjpy-sr-lines.netlify.app</span><span class="free">無料・全6時間足</span></div>
  </div></body></html>`;
}

function tweetText(d) {
  const { mmdd, hhmm } = jstParts(), L = pick(d);
  const lines = [`【USD/JPY ライン速報】${mmdd} ${hhmm} JST`, `現在値 ${f3(L.price)}`];
  if (L.R) lines.push(`🔴抵抗 ${f3(L.R.price)}（${L.R.label}）`);
  if (L.S) lines.push(`🟢支持 ${f3(L.S.price)}（${L.S.label}）`);
  if (L.strong) lines.push(`🔗強合流 ${f3(L.strong.price)}（${L.strong.n}足）`);
  lines.push("", "※分析の補助・目安です。投資は自己責任で", "", "#ドル円 #USDJPY #FX #為替");
  return lines.join("\n");
}

(async () => {
  const d = JSON.parse(fs.readFileSync("sr.json", "utf8"));
  const slot = process.env.SLOT ? parseInt(process.env.SLOT, 10) : currentSlot();
  fs.mkdirSync("shots", { recursive: true });

  const { chromium } = require("playwright");
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 675 }, deviceScaleFactor: 1 });
  await page.setContent(cardHtml(d), { waitUntil: "load" });
  await page.screenshot({ path: `shots/slot${slot}.png` });
  await browser.close();

  fs.writeFileSync(`shots/slot${slot}.txt`, tweetText(d));
  // 最終更新の目印
  fs.writeFileSync(`shots/slot${slot}.meta`, new Date().toISOString());
  console.log(`shots/slot${slot}.png / .txt 生成完了`);
})().catch((e) => { console.error("エラー:", e.message); process.exit(1); });
