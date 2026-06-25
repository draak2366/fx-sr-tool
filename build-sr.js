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
    datetime: v.datetime,
    open: parseFloat(v.open),
    high: parseFloat(v.high),
    low: parseFloat(v.low),
    close: parseFloat(v.close),
  }));
}

// チャート用の時刻表記（Lightweight Charts）
// 日足は "YYYY-MM-DD"、それ以外はUTC unix秒
function toChartTime(label, dt) {
  if (label === "1d") return dt.slice(0, 10);
  return Math.floor(new Date(dt.replace(" ", "T") + "Z").getTime() / 1000);
}

const CANDLE_N = 120;
// 各TFの更新間隔（5分スロット単位）。1m/5m=毎回、15m=15分、1h=60分、4h=4h、1d=6h
const REFRESH_EVERY = { "1m": 1, "5m": 1, "15m": 3, "1h": 12, "4h": 48, "1d": 72 };

// いま取得すべきTFを時計（UTC）から判定。cron遅延に強い
function dueTfs() {
  const now = new Date();
  const slot = Math.floor((now.getUTCHours() * 60 + now.getUTCMinutes()) / 5);
  const due = {};
  for (const tf of SREngine.TF_ORDER) due[tf] = slot % REFRESH_EVERY[tf] === 0;
  return due;
}

(async () => {
  try {
    const due = dueTfs();

    // 前回のローソク足を読む（再利用用）
    let prev = {};
    try { prev = JSON.parse(fs.readFileSync("candles.json", "utf8")); } catch (e) {}

    const ratesByTf = {};   // S/R計算用 {high,low,close}[]（古→新）
    const candlesOut = {};  // 出力用（チャート形式）
    const fetched = [];

    for (const label of SREngine.TF_ORDER) {
      const cache = Array.isArray(prev[label]) ? prev[label] : null;
      if (due[label] || !cache || !cache.length) {
        // 取得対象：APIから取り直す
        const rows = await fetchTf(label); // {datetime,open,high,low,close}[] 古→新
        ratesByTf[label] = rows.map((v) => ({ high: v.high, low: v.low, close: v.close }));
        candlesOut[label] = rows.slice(-CANDLE_N).map((v) => ({
          time: toChartTime(label, v.datetime),
          open: v.open, high: v.high, low: v.low, close: v.close,
        }));
        fetched.push(label);
        await new Promise((r) => setTimeout(r, 200)); // 8req/分に配慮
      } else {
        // 間引き対象：前回のローソク足を再利用
        ratesByTf[label] = cache.map((v) => ({ high: v.high, low: v.low, close: v.close }));
        candlesOut[label] = cache;
      }
    }

    const m1 = ratesByTf["1m"];
    const currentPrice = m1 && m1.length ? m1[m1.length - 1].close : null;

    const result = SREngine.getSrLines(SYMBOL, ratesByTf, currentPrice);
    result.updated = new Date().toISOString();

    fs.writeFileSync("sr.json", JSON.stringify(result));
    console.log(`sr.json 生成完了 price=${result.price} conf=${result.confluence.length} 取得=[${fetched.join(",")}] @ ${result.updated}`);

    const candles = Object.assign({ updated: result.updated }, candlesOut);
    fs.writeFileSync("candles.json", JSON.stringify(candles));
    console.log(`candles.json 生成完了 (各TF最大${CANDLE_N}本)`);
  } catch (e) {
    console.error("生成エラー:", e.message);
    process.exit(1);
  }
})();
