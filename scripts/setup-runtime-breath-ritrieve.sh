#!/usr/bin/env bash
set -euo pipefail

# Install public model dependencies only; do not read or write Mind records.
# macOS / Apple Silicon: Python 3.11/3.12 have current binary ML wheels.
# Fail early instead of accidentally creating the venv from system Python 3.9.
ROOT="${HOME}/.cache/leileios"
VENV="${ROOT}/ritrieve-venv"
if [[ -n "${LEILEI_MIND_SETUP_PYTHON:-}" ]]; then
  PYTHON="${LEILEI_MIND_SETUP_PYTHON}"
elif command -v python3.12 >/dev/null 2>&1; then
  PYTHON="$(command -v python3.12)"
elif command -v python3.11 >/dev/null 2>&1; then
  PYTHON="$(command -v python3.11)"
else
  printf 'ritrieve requires Python 3.11 or 3.12 (Python 3.9 cannot install this ML stack reliably).\n' >&2
  printf 'Install: brew install python@3.12\nThen rerun this script.\n' >&2
  exit 2
fi

SELECTED_VERSION="$("${PYTHON}" -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')"
case "${SELECTED_VERSION}" in
  3.11|3.12) ;;
  *)
    printf 'Unsupported Python %s at %s. Set LEILEI_MIND_SETUP_PYTHON to Python 3.11/3.12.\n' "${SELECTED_VERSION}" "${PYTHON}" >&2
    exit 2
    ;;
esac
printf '[ritrieve] Python %s: %s\n' "${SELECTED_VERSION}" "${PYTHON}"
mkdir -p "${ROOT}"

# A previous install may have left a broken 3.9 venv. Repair only the fixed
# ritrieve-specific venv, without touching any other project Python installs.
if [[ -x "${VENV}/bin/python" ]] && "${VENV}/bin/python" -c \
  'import sys; raise SystemExit(sys.version_info[:2] != tuple(map(int, sys.argv[1].split("."))))' \
  "${SELECTED_VERSION}" >/dev/null 2>&1; then
  printf '[ritrieve] Reusing compatible venv.\n'
else
  printf '[ritrieve] Creating/rebuilding isolated venv at %s\n' "${VENV}"
  "${PYTHON}" -m venv --clear "${VENV}"
fi

"${VENV}/bin/python" -m pip install --disable-pip-version-check --timeout 120 --retries 8 --upgrade pip
# Binary wheels only: never backtrack into building ancient scikit-learn / NumPy
# from source just because a dependency resolution or network request failed.
"${VENV}/bin/python" -m pip install --disable-pip-version-check --timeout 120 --retries 8 \
  --only-binary=:all: 'sentence-transformers==5.1.2' 'scikit-learn>=1.5,<2'

"${VENV}/bin/python" - <<'PY'
import sys
from sentence_transformers import SentenceTransformer

print(f"[ritrieve] Python {sys.version.split()[0]} — loading the public model...")
model = SentenceTransformer("richinfoai/ritrieve_zh_v1", trust_remote_code=False)
vectors = model.encode(
    ["语义检索准备完成", "本地记忆可以被检索"],
    normalize_embeddings=True,
    show_progress_bar=False,
)
assert vectors.shape == (2, 1792), f"unexpected shape: {vectors.shape}"
print("[ritrieve] Ready: 1792-dimensional normalized embeddings.")
PY
printf '\n[ritrieve] Optional next command:\n  %s/bin/python scripts/mind-ritrieve-mac-smoke.py\n' "${VENV}"
