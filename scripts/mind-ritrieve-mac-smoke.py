#!/usr/bin/env python3
"""On-device ritrieve Chinese embedding smoke/latency test (no Claude tokens).

Run AFTER: pnpm setup:runtime-breath-ritrieve
Then: ~/.cache/leileios/ritrieve-venv/bin/python scripts/mind-ritrieve-mac-smoke.py

No real memories, credentials, or network needed. Prints aggregate latency only.
"""
import json
import os
import platform
import statistics
import time

os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"

from sentence_transformers import SentenceTransformer

model_id = "richinfoai/ritrieve_zh_v1"
started = time.perf_counter()
model = SentenceTransformer(model_id, local_files_only=True, trust_remote_code=False)
load_ms = round((time.perf_counter() - started) * 1000)
memory = [
    "她过去因为我说过的话难过",
    "我们曾经约定不再重复同样的争执",
    "昨天跑步前下了一场大雨",
    "喜欢珍珠奶茶和绿茶",
    "小猫喜欢在窗边晒太阳",
    "去年春节一起去看烟花",
    "写代码的时候电脑突然重启",
    "之前发了邮件一直没有得到回复",
    "花园里的玫瑰到了开花季节",
    "曾经因为别人答应的事没做到而失望",
    "换了一台新电脑，键盘更轻",
    "地铁因为暴雨临时停运",
] * 8
started = time.perf_counter()
passages = model.encode(memory, normalize_embeddings=True, batch_size=16,
                        show_progress_bar=False)
index_ms = round((time.perf_counter() - started) * 1000)
latencies = []
selected = []
queries = ["你怎么又这样", "我还是在意之前答应的事", "刚刚窗外下雨了"]
for _ in range(12):
    for query in queries:
        start = time.perf_counter()
        qvec = model.encode([query], normalize_embeddings=True,
                            show_progress_bar=False)[0]
        scores = passages @ qvec
        _ = int(scores.argmax())
        latencies.append((time.perf_counter() - start) * 1000)
for query in queries:
    qvec = model.encode([query], normalize_embeddings=True, show_progress_bar=False)[0]
    scores = passages @ qvec
    selected.append({"query": query, "best_synthetic_memory": memory[int(scores.argmax())]})
latencies.sort()
def pct(p):
    return round(latencies[min(len(latencies)-1, max(0, int(len(latencies) * p + .999) - 1))], 1)
print(json.dumps({
    "device": platform.platform(),
    "model": model_id,
    "embedding_dimensions": int(passages.shape[1]),
    "synthetic_memory_count": len(memory),
    "cold_model_load_ms": load_ms,
    "cold_synthetic_index_ms": index_ms,
    "warm_query_p50_ms": pct(.5),
    "warm_query_p95_ms": pct(.95),
    "hook_local_search_budget_ms": 850,
    "p95_within_local_budget": pct(.95) < 850,
    "example_hits": selected,
    "note": "Synthetic smoke/latency only. No real Mind quality/accuracy claims.",
}, ensure_ascii=False, indent=2))
