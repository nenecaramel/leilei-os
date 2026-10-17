#!/usr/bin/env python3
"""Local newline-delimited scoring worker for richinfoai/ritrieve_zh_v1.

Started only by the Mac daemon. No server, telemetry or remote inference.
Install the model once via scripts/setup-runtime-breath-ritrieve.sh.
"""

import hashlib
import json
import math
import os
import sys
from collections import OrderedDict

MODEL_ID = "richinfoai/ritrieve_zh_v1"
CACHE_LIMIT = 512
MAX_REQUEST_CHARS = 1_000_000


def main():
    # Never let a production Hook silently fetch weights over the network.
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    from sentence_transformers import SentenceTransformer

    model = SentenceTransformer(MODEL_ID, local_files_only=True, trust_remote_code=False)
    cache = OrderedDict()

    for raw in sys.stdin:
        request = None
        try:
            if len(raw) > MAX_REQUEST_CHARS:
                raise ValueError("request too large")
            request = json.loads(raw)
            request_id = request["id"]
            query = request["query"]
            passages = request["passages"]
            if (
                not isinstance(request_id, str)
                or not isinstance(query, str)
                or not query.strip()
                or not isinstance(passages, list)
                or not 1 <= len(passages) <= 256
                or any(not isinstance(p, str) or not p.strip() or len(p) > 2000 for p in passages)
            ):
                raise ValueError("invalid request")

            keys = [hashlib.sha256(p.strip().encode("utf-8")).hexdigest() for p in passages]
            missing = OrderedDict(
                (key, passage.strip())
                for key, passage in zip(keys, passages)
                if key not in cache
            )
            # Ritrieve is a symmetric encoder: no E5 query:/passage: prefixes.
            vectors = model.encode(
                [query.strip(), *missing.values()],
                normalize_embeddings=True,
                batch_size=16,
                show_progress_bar=False,
            )
            query_vector = vectors[0]
            new_vectors = {
                key: vector
                for (key, _), vector in zip(missing.items(), vectors[1:])
            }
            scores = []
            for key in keys:
                passage_vector = new_vectors.get(key)
                if passage_vector is None:
                    passage_vector = cache[key]
                cosine = float(query_vector @ passage_vector)
                if not math.isfinite(cosine):
                    raise ValueError("invalid cosine")
                scores.append(max(0.0, min(1.0, cosine)))

            for key in keys:
                if key in cache:
                    cache.move_to_end(key)
                else:
                    cache[key] = new_vectors[key]
                while len(cache) > CACHE_LIMIT:
                    cache.popitem(last=False)

            result = {"id": request_id, "scores": scores}
        except Exception:
            # Do not echo prompts, Memory text or exception details.
            result = {"id": request.get("id", "") if isinstance(locals().get("request"), dict) else "", "scores": None}
        sys.stdout.write(json.dumps(result, separators=(",", ":")) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
