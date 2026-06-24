/* =========================================================
   sr.json 生成スクリプト（GitHub Actionsで5分ごとに実行）
   Twelve DataからUSD/JPYの6TF OHLCを取得 → S/R計算 → sr.json出力
   APIキーは環境変数 TWELVEDATA_KEY から読む（公開しない）
   ローカル実行例: TWELVEDATA_KEY=xxxx node build-sr.js
   ========================================================= */
const https = require("https");
const fs = require("fs");
const SREngine = require("./sr-engine.js");

const SYMBOL = "USD/JPY";
const OUTPUT = 300;
// 自前TFラベル → Twelve Dataのinterval表記
const TF_MAP = { "1m": "1min", "5m": "5min", "15m": "15min", "1h": "1h", "4h": "4h", "1d": "1day" };

const KEY = process.env.TWELVEDATA_KEY;
if (!KEY) { console.error("環境変数 TWELVEDATA_KEY が未設定です"); process.exit(1); }

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(new Error("JSON parse error: " + data.slice(0, 200))); }
      });
    }).on("error", reject);
  });
}

async function fetchTf(label) {
  const interval = TF_MAP[label];
  const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(SYMBOL)}&interval=${interval}&outputsize=${OUTPUT}&apikey=${KEY}`;
  const j = await fetchJson(url);
  if (j.status !== "ok" || !Array.isArray(j.values)) {
    throw new Error(`${label} 取得失敗: ${j.message || JSON.stringify(j).slice(0, 150)}`);
  }
  // Twelve Dataは新しい→古い順。古い→新しいに反転して数値化
  return j.values.slice().reverse().map((v) => ({
    high: parseFloat(v.high),
    low: parseFloat(v.low),
    close: parseFloat(v.close),
  }));
}

(async () => {
  try {
    const ratesByTf = {};
    for (const label of SREngine.TF_ORDER) {
      ratesByTf[label] = await fetchTf(label);
      await new Promise((r) => setTimeout(r, 200)); // レート制限に配慮（8req/分）
    }
    const m1 = ratesByTf["1m"];
    const currentPrice = m1 && m1.length ? m1[m1.length - 1].close : null;

    const result = SREngine.getSrLines(SYMBOL, ratesByTf, currentPrice);
    result.updated = new Date().toISOString();

    fs.writeFileSync("sr.json", JSON.stringify(result));
    console.log(`sr.json 生成完了 price=${result.price} conf=${result.confluence.length} @ ${result.updated}`);
  } catch (e) {
    console.error("生成エラー:", e.message);
    process.exit(1);
  }
})();
