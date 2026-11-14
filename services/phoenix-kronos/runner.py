#!/usr/bin/env python3
"""Isolated token-free Kronos CPU inference. No exchange credentials or orders."""
import json
import math
import os
import sys
from pathlib import Path

ROOT = Path(os.environ.get("PHOENIX_KRONOS_HOME", Path.home() / ".phoenix" / "kronos"))
sys.path.insert(0, str(ROOT / "source"))
MODEL = os.environ.get("PHOENIX_KRONOS_MODEL", "mini")
if MODEL not in ("mini", "small"):
    raise ValueError("Unsupported model")
INTERVALS = {"15m": 15, "1h": 60, "4h": 240, "1d": 1440}

def load():
    import torch
    from model import Kronos, KronosTokenizer, KronosPredictor
    torch.set_num_threads(min(2, os.cpu_count() or 1))
    tokenizer = KronosTokenizer.from_pretrained("NeoQuasar/Kronos-Tokenizer-" + ("2k" if MODEL == "mini" else "base"))
    model = Kronos.from_pretrained("NeoQuasar/Kronos-" + MODEL)
    model.eval()
    tokenizer.eval()
    return KronosPredictor(model, tokenizer, device="cpu", max_context=512 if MODEL == "small" else 2048)

def forecast(predictor, request):
    import pandas as pd
    symbol, interval, candles = request.get("symbol"), request.get("interval"), request.get("candles")
    if not isinstance(symbol, str) or not symbol.endswith("USDT") or len(symbol) > 20:
        raise ValueError("Invalid symbol")
    if interval not in INTERVALS or not isinstance(candles, list) or not 48 <= len(candles) <= 512:
        raise ValueError("Invalid input")
    rows, times, previous = [], [], -1
    for candle in candles:
        if not isinstance(candle, dict):
            raise ValueError("Invalid candle")
        t = candle.get("closeTime")
        if not isinstance(t, (int, float)) or not math.isfinite(t) or t <= previous:
            raise ValueError("Invalid timestamp")
        previous = t
        values = [candle.get(key) for key in ("open", "high", "low", "close", "volume")]
        if any(not isinstance(v, (int, float)) or not math.isfinite(v) for v in values):
            raise ValueError("Invalid OHLCV")
        o, h, l, c, v = values
        if min(o, h, l, c) <= 0 or v < 0 or h < max(o, c) or l > min(o, c):
            raise ValueError("Invalid candle bounds")
        rows.append([o, h, l, c, v, v * c])
        times.append(t)
    df = pd.DataFrame(rows, columns=["open", "high", "low", "close", "volume", "amount"])
    xs = pd.Series(pd.to_datetime(times, unit="ms", utc=True)).dt.tz_localize(None)
    step = pd.Timedelta(minutes=INTERVALS[interval])
    ys = pd.Series(pd.date_range(xs.iloc[-1] + step, periods=6, freq=step))
    result = predictor.predict(df=df, x_timestamp=xs, y_timestamp=ys, pred_len=6,
                               T=1.0, top_p=0.9, sample_count=1, verbose=False)
    closes = result["close"].astype(float).to_numpy()
    lows = result["low"].astype(float).to_numpy()
    if len(closes) != 6 or any(not math.isfinite(float(x)) or x <= 0 for x in closes):
        raise ValueError("Bad prediction")
    if any(not math.isfinite(float(x)) or x <= 0 for x in lows):
        raise ValueError("Bad lows")
    base = float(df["close"].iloc[-1])
    return {"source": "kronos", "model": MODEL, "symbol": symbol, "interval": interval,
            "horizonBars": 6, "baseClose": base, "projectedClose": float(closes[-1]),
            "projectedReturnPct": float((closes[-1] / base - 1) * 100),
            "maxDownsidePct": float((min(lows) / base - 1) * 100),
            "forecastAt": int(times[-1])}

def main():
    try:
        predictor = load()
    except Exception:
        print(json.dumps({"ready": False, "error": "model-unavailable"}), flush=True)
        return 1
    print(json.dumps({"ready": True, "model": MODEL}), flush=True)
    for line in sys.stdin:
        data = None
        try:
            data = json.loads(line)
            payload = forecast(predictor, data)
            print(json.dumps({"id": data.get("id"), "forecast": payload}, allow_nan=False), flush=True)
        except Exception:
            print(json.dumps({"id": data.get("id") if isinstance(data, dict) else None,
                              "error": "invalid-or-unavailable-forecast"}), flush=True)
    return 0

if __name__ == "__main__":
    sys.exit(main())
