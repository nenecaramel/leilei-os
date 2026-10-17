#!/usr/bin/env python3
"""Offline worker protocol regression with stub embeddings, no Hugging Face fetch.

Run: python3 tests/mind-ritrieve-worker-protocol.py
Tests the REAL Python worker source, not real ritrieve model accuracy/latency.
"""
import json
import os
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory

FAKE_NUMPY = """
def clip(value, low, high):
    return max(low, min(high, value))
def median(values):
    values = sorted(values)
    n = len(values)
    return values[n // 2] if n % 2 else (values[n//2 - 1] + values[n//2]) / 2
"""
FAKE_ST = """
import hashlib
class Vector:
    def __init__(self, text):
        data = hashlib.sha256(text.encode('utf-8')).digest()
        self.values = [float(x) for x in data[:16]]
        size = sum(x*x for x in self.values) ** .5
        self.values = [x/size for x in self.values]
    def __matmul__(self, other):
        return sum(a*b for a,b in zip(self.values, other.values))
class SentenceTransformer:
    def __init__(self, name, **kwargs):
        assert name == 'richinfoai/ritrieve_zh_v1'
        assert kwargs.get('local_files_only') is True
    def encode(self, texts, **kwargs):
        return [Vector(t) for t in texts]
"""
worker = Path(__file__).resolve().parents[1] / "scripts" / "mind-ritrieve-worker.py"
checks = []

with TemporaryDirectory() as directory:
    p = Path(directory)
    (p / "numpy.py").write_text(FAKE_NUMPY, encoding="utf-8")
    (p / "sentence_transformers.py").write_text(FAKE_ST, encoding="utf-8")
    env = dict(os.environ, PYTHONPATH=directory)
    process = subprocess.Popen([sys.executable, str(worker)], stdin=subprocess.PIPE,
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                               text=True, bufsize=1, env=env)
    counter = 0
    def send(op, **params):
        global counter
        counter += 1
        assert process.stdin and process.stdout
        process.stdin.write(json.dumps({"id":str(counter),"op":op,**params},ensure_ascii=False)+"\n")
        process.stdin.flush()
        line = process.stdout.readline()
        assert line, "worker exited early"
        reply = json.loads(line)
        assert reply["id"] == str(counter)
        return reply
    def check(label, condition):
        assert condition, label
        checks.append(label)
    try:
        a, b = "a"*64, "b"*64
        check("search before commit", "error" in send("search",query="承诺"))
        check("begin snapshot", send("begin",version=a).get("ok"))
        check("reject duplicate IDs in one page", "error" in send("append",version=a,
              rows=[["m1","苹果"],["m1","梨"]]))
        check("atomic staging after rejection", send("commit",version=a).get("ok")
              and send("search",query="梨")["count"] == 0)
        check("begin new snapshot", send("begin",version=b).get("ok"))
        check("append valid rows", send("append",version=b,rows=[["m1","承诺"],["m2","天气"]]).get("ok"))
        check("old snapshot still active", send("search",query="承诺")["version"] == a)
        check("reject duplicate across pages", "error" in send("append",version=b,rows=[["m1","其他"]]))
        check("commit and rank", send("commit",version=b).get("ok")
              and send("search",query="承诺")["hits"][0][0] == "m1")
        check("pair scoring", send("score",query="承诺",passages=["承诺","天气"])["scores"][0] > .99)
        check("reject blank query", "error" in send("score",query=" ",passages=["承诺"]))
        check("reject too-long text", send("begin",version="c"*64).get("ok")
              and "error" in send("append",version="c"*64,rows=[["m3","a"*2001]]))
        check("reject invalid search limit", "error" in send("search",query="你好",limit=49))
        check("atomic deletion", send("begin",version=a).get("ok")
              and send("append",version=a,rows=[["m1","承诺"]]).get("ok")
              and send("commit",version=a).get("ok")
              and send("search",query="天气")["count"] == 1)
        print(json.dumps({"passed":len(checks),"cases":checks,"actual_model_loaded":False},
                         ensure_ascii=False,indent=2))
    finally:
        process.kill()
        process.communicate(timeout=5)
