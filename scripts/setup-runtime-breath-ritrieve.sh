#!/usr/bin/env bash
set -euo pipefail

# Public model download and Python dependencies only. No Mind records are read.
ROOT="${HOME}/.cache/leileios"
VENV="${ROOT}/ritrieve-venv"
PYTHON="${LEILEI_MIND_SETUP_PYTHON:-python3}"

"${PYTHON}" -m venv "${VENV}"
"${VENV}/bin/python" -m pip install --upgrade pip
"${VENV}/bin/python" -m pip install 'sentence-transformers==5.1.2'
"${VENV}/bin/python" - <<'PY'
from sentence_transformers import SentenceTransformer

model = SentenceTransformer("richinfoai/ritrieve_zh_v1", trust_remote_code=False)
vectors = model.encode(
    ["语义检索准备完成", "本地记忆可以被检索"],
    normalize_embeddings=True,
    show_progress_bar=False,
)
assert vectors.shape == (2, 1792), f"unexpected shape: {vectors.shape}"
print("ritrieve ready: 1792-dimensional normalized embeddings")
PY
printf '\nTo use after benchmarks, set LEILEI_MIND_EMBEDDING_PROVIDER=ritrieve for the Mac daemon.\n'
