#!/usr/bin/env python3
"""Offline, single-owner ritrieve worker for scoring and in-memory Mind index.

Protocol: newline JSON {id,op,...}. The process never persists Memory text,
vectors, queries, or raw errors; it only reads the locally installed model.
"""
import hashlib
import json
import math
import os
import sys
from collections import OrderedDict

os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"

MODEL_ID = "richinfoai/ritrieve_zh_v1"
PASSAGE_CACHE_LIMIT = 512
MAX_REQUEST_CHARS = 1_000_000
MAX_INDEX_RECORDS = 30000


def main():
    import numpy as np
    from sentence_transformers import SentenceTransformer

    model = SentenceTransformer(MODEL_ID, local_files_only=True, trust_remote_code=False)
    passage_cache = OrderedDict()
    active = {}
    active_version = None
    staging = None
    staging_version = None

    def encode_passages(texts):
        keys = [hashlib.sha256(text.strip().encode("utf-8")).hexdigest() for text in texts]
        new = OrderedDict((key, text.strip()) for key, text in zip(keys, texts)
                          if key not in passage_cache)
        computed = {}
        if new:
            vectors = model.encode(list(new.values()), normalize_embeddings=True,
                                   batch_size=16, show_progress_bar=False)
            computed = dict(zip(new.keys(), vectors))
        result = []
        for key in keys:
            vector = passage_cache.get(key)
            if vector is None:
                vector = computed[key]
            result.append(vector)
        for key in keys:
            if key in passage_cache:
                passage_cache.move_to_end(key)
            else:
                passage_cache[key] = computed[key]
            while len(passage_cache) > PASSAGE_CACHE_LIMIT:
                passage_cache.popitem(last=False)
        return result

    def encode_query(query):
        return model.encode([query.strip()], normalize_embeddings=True, show_progress_bar=False)[0]

    for raw in sys.stdin:
        request = None
        try:
            if len(raw) > MAX_REQUEST_CHARS:
                raise ValueError("request too large")
            request = json.loads(raw)
            request_id = request["id"]
            op = request.get("op", "score")
            if not isinstance(request_id, str) or len(request_id) > 100:
                raise ValueError("invalid request ID")

            if op == "score":
                query, passages = request["query"], request["passages"]
                if (not isinstance(query, str) or not query.strip()
                    or not isinstance(passages, list) or not 1 <= len(passages) <= 256
                    or any(not isinstance(p, str) or not p.strip() or len(p) > 2000 for p in passages)):
                    raise ValueError("invalid scoring request")
                qvec = encode_query(query)
                vectors = encode_passages(passages)
                scores = [float(np.clip(qvec @ vec, 0, 1)) for vec in vectors]
                if not all(math.isfinite(v) for v in scores):
                    raise ValueError("invalid score")
                result = {"id": request_id, "scores": scores}

            elif op == "begin":
                version = request["version"]
                if not isinstance(version, str) or len(version) != 64:
                    raise ValueError("invalid snapshot version")
                staging, staging_version = {}, version
                result = {"id": request_id, "ok": True}

            elif op == "append":
                if staging is None or request["version"] != staging_version:
                    raise ValueError("no matching staging snapshot")
                rows = request["rows"]
                if (not isinstance(rows, list) or len(rows) > 96
                    or len(staging) + len(rows) > MAX_INDEX_RECORDS):
                    raise ValueError("invalid snapshot batch")
                if any(not isinstance(row, list) or len(row) != 2
                       or not isinstance(row[0], str) or not isinstance(row[1], str)
                       or not row[1].strip() or len(row[1]) > 2000
                       for row in rows):
                    raise ValueError("invalid snapshot row")
                vectors = encode_passages([row[1] for row in rows]) if rows else []
                for row, vector in zip(rows, vectors):
                    if row[0] in staging:
                        raise ValueError("duplicate memory")
                    staging[row[0]] = vector
                result = {"id": request_id, "ok": True}

            elif op == "commit":
                if staging is None or request["version"] != staging_version:
                    raise ValueError("no matching staging snapshot")
                active, active_version = staging, staging_version
                staging, staging_version = None, None
                result = {"id": request_id, "ok": True}

            elif op == "search":
                query = request["query"]
                limit = request.get("limit", 48)
                if (not isinstance(query, str) or not query.strip() or len(query) > 16000
                    or not isinstance(limit, int) or not 1 <= limit <= 48
                    or active_version is None):
                    raise ValueError("snapshot unavailable")
                hits = []
                if active:
                    qvec = encode_query(query)
                    for state_id, vector in active.items():
                        score = float(np.clip(qvec @ vector, 0, 1))
                        if not math.isfinite(score):
                            raise ValueError("invalid score")
                        hits.append((state_id, score))
                    hits.sort(key=lambda row: (-row[1], row[0]))
                result = {"id": request_id, "version": active_version,
                          "hits": hits[:limit], "count": len(active)}

            else:
                raise ValueError("unsupported operation")
        except Exception:
            # Never emit plaintext exceptions or prompts.
            result = {"id": request.get("id", "") if isinstance(request, dict) else "", "error": "UNAVAILABLE"}
        sys.stdout.write(json.dumps(result, separators=(",", ":")) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
