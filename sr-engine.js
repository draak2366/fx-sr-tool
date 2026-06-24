/* =========================================================
   S/Rライン検出エンジン（sr_lines.py の忠実なJS移植）
   スイング高安 → クラスタ化 → R1/R2・S1/S2・接触 → ★ランク → 合流
   MT5依存を排除し、OHLC配列を入力として動く純粋関数。
   ========================================================= */
(function (global) {
  const TF_ORDER = ["1m", "5m", "15m", "1h", "4h", "1d"];
  const ZONE_PIPS = { "1m": 3.0, "5m": 5.0, "15m": 8.0, "1h": 10.0, "4h": 15.0, "1d": 15.0 };
  const TOUCH_PIPS = 3.0;       // 現在価格±この幅以内なら「接触中」
  const CONF_ZONE_PIPS = 12.0;  // 別足のラインがこの幅以内なら「合流」
  const SR_DECAY = 0.015;       // タッチの直近性減衰

  function pipUnit(symbol) {
    return symbol.includes("JPY") ? 0.01 : 0.0001;
  }

  // 前後w本より高い高値/低い安値を [price, idxFromEnd] で集める（idx=0が最新）
  function swings(highs, lows, w) {
    const pts = [];
    const n = highs.length;
    for (let i = w; i < n - w; i++) {
      const h = highs[i], l = lows[i];
      const idx = n - 1 - i;
      let isHigh = true, isLow = true;
      for (let k = 1; k <= w; k++) {
        if (!(h >= highs[i - k] && h >= highs[i + k])) isHigh = false;
        if (!(l <= lows[i - k] && l <= lows[i + k])) isLow = false;
      }
      if (isHigh) pts.push([h, idx]);
      if (isLow) pts.push([l, idx]);
    }
    return pts;
  }

  function mkCluster(pts) {
    const prices = pts.map(p => p[0]);
    const idxs = pts.map(p => p[1]);
    const strength = idxs.reduce((s, i) => s + Math.exp(-SR_DECAY * i), 0);
    return {
      price: prices.reduce((a, b) => a + b, 0) / prices.length,
      touches: pts.length,
      strength: strength,
      last_idx: Math.min(...idxs),
    };
  }

  function cluster(points, zone) {
    if (!points.length) return [];
    points = points.slice().sort((a, b) => a[0] - b[0]);
    const clusters = [];
    let cur = [points[0]];
    for (let i = 1; i < points.length; i++) {
      const p = points[i];
      if (p[0] - cur[cur.length - 1][0] <= zone) cur.push(p);
      else { clusters.push(mkCluster(cur)); cur = [p]; }
    }
    clusters.push(mkCluster(cur));
    return clusters;
  }

  function rank(strength) {
    if (strength >= 2.5) return 3;
    if (strength >= 1.2) return 2;
    return 1;
  }

  function round(v, digits) {
    const f = Math.pow(10, digits);
    return Math.round(v * f) / f;
  }

  /**
   * @param symbol "USD/JPY"
   * @param ratesByTf { "1m":[{high,low,close}...], ... } 各300本程度・古い→新しい順
   * @param currentPrice 省略時は1m最新closeを使用
   * @param swingW スイング幅(既定3)
   */
  function getSrLines(symbol, ratesByTf, currentPrice, swingW) {
    swingW = swingW || 3;
    const pip = pipUnit(symbol);
    const digits = pip >= 0.001 ? 3 : 5;

    let cur = currentPrice;
    if (cur == null) {
      const m1 = ratesByTf["1m"];
      cur = (m1 && m1.length) ? m1[m1.length - 1].close : 0;
    }
    if (!cur) return { symbol, price: null, timeframes: {}, confluence: [] };

    // pass1: 各時間足のライン
    const tfClusters = {};
    for (const label of TF_ORDER) {
      const rates = ratesByTf[label];
      if (!rates || rates.length < 30) { tfClusters[label] = null; continue; }
      const highs = rates.map(r => r.high);
      const lows = rates.map(r => r.low);
      const sw = swings(highs, lows, swingW);
      tfClusters[label] = cluster(sw, (ZONE_PIPS[label] || 8.0) * pip);
    }

    // pass2: 合流（全足のラインを価格で束ねる）
    const allLines = [];
    for (const label of TF_ORDER) {
      const cls = tfClusters[label];
      if (!cls) continue;
      for (const c of cls) allLines.push({ price: c.price, tf: label });
    }
    allLines.sort((a, b) => a.price - b.price);
    const groups = [];
    let g = [];
    for (const ln of allLines) {
      if (g.length && ln.price - g[g.length - 1].price <= CONF_ZONE_PIPS * pip) g.push(ln);
      else { if (g.length) groups.push(g); g = [ln]; }
    }
    if (g.length) groups.push(g);

    function confOf(price) {
      for (const grp of groups) {
        if (grp[0].price - 1e-9 <= price && price <= grp[grp.length - 1].price + 1e-9) {
          return new Set(grp.map(x => x.tf)).size;
        }
      }
      return 1;
    }

    const confluence = [];
    for (const grp of groups) {
      const tfs = [...new Set(grp.map(x => x.tf))].sort((a, b) => TF_ORDER.indexOf(a) - TF_ORDER.indexOf(b));
      if (tfs.length >= 2) {
        const gp = grp.reduce((s, x) => s + x.price, 0) / grp.length;
        confluence.push({
          price: round(gp, digits),
          dist: round(Math.abs(gp - cur) / pip, 1),
          side: cur >= gp ? "S" : "R",
          tfs: tfs, count: tfs.length,
        });
      }
    }
    confluence.sort((a, b) => (b.count - a.count) || (a.dist - b.dist));

    function fmt(c) {
      return {
        price: round(c.price, digits),
        dist: round(Math.abs(c.price - cur) / pip, 1),
        touches: c.touches,
        rank: rank(c.strength),
        conf: confOf(c.price),
      };
    }

    const out = {};
    for (const label of TF_ORDER) {
      const cls = tfClusters[label];
      if (!cls) { out[label] = null; continue; }
      let touchLine = null;
      const nearest = cls.reduce((a, b) => Math.abs(b.price - cur) < Math.abs(a.price - cur) ? b : a);
      if (Math.abs(nearest.price - cur) <= TOUCH_PIPS * pip) touchLine = nearest;
      const res = cls.filter(c => c.price > cur && c !== touchLine).sort((a, b) => a.price - b.price);
      const sup = cls.filter(c => c.price < cur && c !== touchLine).sort((a, b) => b.price - a.price);
      let touchOut = null;
      if (touchLine) {
        touchOut = fmt(touchLine);
        touchOut.side = cur >= touchLine.price ? "S" : "R";
      }
      out[label] = {
        touch: touchOut,
        r2: res.length > 1 ? fmt(res[1]) : null,
        r1: res.length > 0 ? fmt(res[0]) : null,
        s1: sup.length > 0 ? fmt(sup[0]) : null,
        s2: sup.length > 1 ? fmt(sup[1]) : null,
      };
    }

    return { symbol, price: round(cur, digits), timeframes: out, confluence: confluence.slice(0, 6) };
  }

  global.SREngine = { getSrLines, pipUnit, TF_ORDER };
})(typeof window !== "undefined" ? window : globalThis);

// Node(GitHub Actions)からも使えるようにエクスポート
if (typeof module !== "undefined" && module.exports) {
  module.exports = (typeof window !== "undefined" ? window : globalThis).SREngine;
}
