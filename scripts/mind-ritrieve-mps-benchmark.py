#!/usr/bin/env python3
"""Offline, local Apple Silicon MPS vs CPU benchmark for existing ritrieve.

No personal Memory, private queries, Railway, database, Hook, app config,
or production model/device change. Uses the already downloaded public model.

Run:
  ~/.cache/leileios/ritrieve-venv/bin/python scripts/mind-ritrieve-mps-benchmark.py
"""
import gc
import json
import os
import time

os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"

import numpy as np
import torch
from sentence_transformers import SentenceTransformer

MODEL_ID = "richinfoai/ritrieve_zh_v1"
SIZES = (64, 128, 256)
BATCH_SIZE = 16
EMBEDDING_DIM = 1792


def synthetic_passages(count):
    # Varied lengths; full new passages per query, not a warmed text cache.
    return [
        ("第%d条模拟记录：公共交通、植物栽培、面包发酵、图书馆旧书、"
         "日常体育活动和历史档案保存。" % i)
        + ("本句仅用于本地模型性能测量，不是真实私人记忆。" * (i % 4))
        for i in range(count)
    ]


def encode(model, texts, device):
    if device == "mps":
        torch.mps.synchronize()
    start = time.perf_counter()
    vectors = model.encode(
        texts,
        normalize_embeddings=True,
        batch_size=BATCH_SIZE,
        show_progress_bar=False,
        convert_to_numpy=True,
    )
    if device == "mps":
        torch.mps.synchronize()
    elapsed = (time.perf_counter() - start) * 1000
    if vectors.shape != (len(texts), EMBEDDING_DIM):
        raise RuntimeError("UNEXPECTED_EMBEDDING_DIMENSIONS")
    if not np.isfinite(vectors).all():
        raise RuntimeError("INVALID_EMBEDDINGS")
    return vectors, round(elapsed, 1)


def report(**fields):
    print(json.dumps(fields, ensure_ascii=False), flush=True)


def main():
    if not torch.backends.mps.is_built() or not torch.backends.mps.is_available():
        report(stage="MPS_UNAVAILABLE", note="This Mac/PyTorch runtime has no usable Apple Metal MPS backend. No app setting changed.")
        return

    data = {size: synthetic_passages(size) for size in SIZES}
    started = time.perf_counter()
    model = SentenceTransformer(
        MODEL_ID, device="cpu", local_files_only=True, trust_remote_code=False
    )
    encode(model, ["公开模型CPU预热"], "cpu")
    report(stage="CPU_READY", startup_ms=round((time.perf_counter()-started)*1000))
    cpu_vectors = {}
    cpu_latency = {}
    for size in SIZES:
        cpu_vectors[size], cpu_latency[size] = encode(model, data[size], "cpu")
        report(stage="MEASUREMENT", device="cpu", candidates=size,
               cold_encode_ms=cpu_latency[size], batch_size=BATCH_SIZE)

    started = time.perf_counter()
    try:
        model.to(torch.device("mps"))
        encode(model, ["公开模型MPS预热"], "mps")
    except Exception:
        report(stage="MPS_MODEL_UNAVAILABLE", note="The current model cannot run correctly on the local MPS backend. CPU defaults unchanged.")
        return
    report(stage="MPS_READY", switch_and_warmup_ms=round((time.perf_counter()-started)*1000))

    for size in SIZES:
        try:
            mps_vectors, mps_latency = encode(model, data[size], "mps")
        except Exception:
            report(stage="MPS_INFERENCE_FAILED", candidates=size,
                   note="No production configuration changed.")
            return
        pairwise = np.sum(cpu_vectors[size] * mps_vectors, axis=1)
        max_deviation = float(np.max(np.abs(pairwise-1.0)))
        # Do not recommend a backend with materially different scores.
        passes_consistency = max_deviation <= 0.01
        report(
            stage="COMPARISON",
            candidates=size,
            batch_size=BATCH_SIZE,
            cpu_ms=cpu_latency[size],
            mps_ms=mps_latency,
            speedup_x=round(cpu_latency[size]/max(0.1,mps_latency), 2),
            max_cosine_deviation=round(max_deviation, 6),
            cosine_consistency_pass=passes_consistency,
            mps_within_1000ms=mps_latency <= 1000,
        )
    report(stage="RITRIEVE_MPS_BENCHMARK_FINISHED",
           note="Synthetic raw encoding only. Does not include E5, Hook, Railway, or quality labels.")
    del model
    gc.collect()


if __name__ == "__main__":
    main()
