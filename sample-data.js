/* =========================================================
   サンプルOHLC生成（STEP1用・API不要の擬似USD/JPYデータ）
   ランダムウォークで6TF分のローソク足を作る。
   ※本番ではこの部分を Twelve Data の実データに差し替える。
   ========================================================= */
(function (global) {
  // 簡易シード付き乱数（再現性のため）
  function rng(seed) {
    let s = seed % 2147483647;
    if (s <= 0) s += 2147483646;
    return () => (s = (s * 16807) % 2147483647) / 2147483647;
  }

  // 1TF分のローソク足を生成（古い→新しい・平均回帰でbase付近を往復）
  function genCandles(n, basePrice, stepPips, pip, rand) {
    const out = [];
    let price = basePrice;
    const band = stepPips * pip * 8;       // 価格が動ける幅の目安
    for (let i = 0; i < n; i++) {
      // baseから離れるほど戻る力が働く（平均回帰）→ R/S両側にスイングが出る
      const reversion = (basePrice - price) / band * stepPips * pip * 0.5;
      const drift = (rand() - 0.5) * 2 * stepPips * pip + reversion;
      const close = price + drift;
      const wick = stepPips * pip * (0.3 + rand() * 0.7);
      const high = Math.max(price, close) + wick * rand();
      const low = Math.min(price, close) - wick * rand();
      out.push({ high, low, close });
      price = close;
    }
    return out;
  }

  // 6TF分まとめて生成。各足のボラ幅を変えて自然なS/Rが出るようにする
  function generate(seed) {
    const pip = 0.01;          // USD/JPY
    const base = 157.00;
    const rand = rng(seed || Date.now() % 100000);
    // 足ごとに「1本あたりの値動き幅(pips)」を変える
    const cfg = {
      "1m": 2.5, "5m": 4, "15m": 7, "1h": 12, "4h": 25, "1d": 50,
    };
    const rates = {};
    for (const tf of ["1m", "5m", "15m", "1h", "4h", "1d"]) {
      rates[tf] = genCandles(300, base, cfg[tf], pip, rand);
    }
    // 現在値＝1m最新closeに微小ノイズ
    const cur = rates["1m"][rates["1m"].length - 1].close;
    return { rates, currentPrice: cur };
  }

  global.SampleData = { generate };
})(window);
