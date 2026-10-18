#!/usr/bin/env python3
"""Tune the EXISTING local ritrieve encode batch_size on synthetic data.

No Memory files, user content, database, Hook or Railway interaction.
Uses the same public, already installed local model and offline loading.
No runtime defaults/settings are changed by this script.

Run:
  ~/.cache/leileios/ritrieve-venv/bin/python scripts/mind-ritrieve-batch-tuning.py
"""
import json
import os
import statistics
import time

os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"

import numpy as np
from sentence_transformers import SentenceTransformer

MODEL_ID = "richinfoai/ritrieve_zh_v1"
SIZES = (128, 256)
BATCH_SIZES = (16, 32, 64)
ROUNDS = 2


def passages(count):
    # Unique records, like a first-seen candidate pool (not repeated boilerplate).
    # Use varied lengths; actual Memory can be considerably longer.
    return [
        ("第%d条模拟档案：今年的公共交通、植物种植、烘焙发酵、公共图书馆和"
         "体育活动安排都需要记录。每项记录用不同编号和分类标签。" % i)
        + ("这些是纯测试资料，不能当作真实记忆。" * (i % 4))
        for i in range(count)
    ]


def timed_encode(model, texts, batch_size):
    begin = time.perf_counter()
    result = model.encode(
        texts,
        normalize_embeddings=True,
        batch_size=batch_size,
        show_progress_bar=False,
        convert_to_numpy=True,
    )
    elapsed_ms = (time.perf_counter() - begin) * 1000.0
    if result.shape != (len(texts), 1792):
        raise RuntimeError("UNEXPECTED_EMBEDDING_SHAPE")
    if not np.isfinite(result).all():
        raise RuntimeError("NONFINITE_EMBEDDINGS")
    return result, elapsed_ms


def main():
    began = time.perf_counter()
    model = SentenceTransformer(
        MODEL_ID, local_files_only=True, trust_remote_code=False
    )
    timed_encode(model, ["公开模型已就绪"], 16)
    print(json.dumps({
        "stage": "MODEL_READY",
        "warmup_ms": round((time.perf_counter() - began) * 1000),
    }), flush=True)

    for count in SIZES:
        examples = passages(count)
        runs = {batch: [] for batch in BATCH_SIZES}
        baseline = None
        for repetition in range(ROUNDS):
            # Rotate trial order to reduce first-iteration / thermal bias.
            sizes = BATCH_SIZES if repetition % 2 == 0 else tuple(reversed(BATCH_SIZES))
            for batch in sizes:
                encoded, elapsed = timed_encode(model, examples, batch)
                if baseline is None:
                    baseline = encoded.copy()
                    deviation = 0.0
                else:
                    # Compare cosine similarity of normalized output on the SAME
                    # text and model; no user labels or content displayed.
                    reference = np.sum(baseline * encoded, axis=1)
                    deviation = float(np.max(np.abs(reference - 1.0)))
                    if deviation > 0.005:
                        raise RuntimeError("MODEL_SCORE_DRIFT")
                runs[batch].append(elapsed)
                print(json.dumps({
                    "stage": "TRIAL",
                    "candidates": count,
                    "batch_size": batch,
                    "round": repetition + 1,
                    "encode_ms": round(elapsed, 1),
                    "max_cosine_deviation": round(deviation, 6),
                }), flush=True)
        for batch in BATCH_SIZES:
            print(json.dumps({
                "stage": "SUMMARY",
                "candidates": count,
                "batch_size": batch,
                "runs": ROUNDS,
                "mean_ms": round(statistics.mean(runs[batch]), 1),
                "max_ms": round(max(runs[batch]), 1),
                "note": "Synthetic passages; compare measured speed, not assumed defaults",
            }), flush=True)
    print("RITRIEVE_BATCH_TUNING_FINISHED", flush=True)


if __name__ == "__main__":
    main()
