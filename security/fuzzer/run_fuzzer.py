#!/usr/bin/env python3
"""
run_fuzzer.py — PrivateAI Security Fuzzer
Feeds payloads to /security/analyze and reports gaps.

Usage:
    python3 run_fuzzer.py                         # default: localhost:8000
    python3 run_fuzzer.py --url http://host:8000  # custom URL
    python3 run_fuzzer.py --category medical      # filter by category
"""

import json
import sys
import urllib.request
import urllib.error
import argparse
from pathlib import Path

def analyze(url, payload_text, ring_level=0, endpoint="/security/analyze", field="content", agent=None):
    if endpoint == "/kg/ingest":
        body = {field: payload_text}
    elif endpoint == "/agent/dispatch":
        body = {field: payload_text}
        if agent:
            body["agent"] = agent
    elif endpoint == "/delegate/parse":
        body = {"tag": payload_text}
    else:
        body = {"content": payload_text, "ring_level": ring_level}
    data = json.dumps(body).encode()
    req = urllib.request.Request(
        f"{url}{endpoint}",
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST"
    )
    with urllib.request.urlopen(req, timeout=5) as resp:
        return json.loads(resp.read())

def run(url, payloads, category_filter=None):
    results = {"pass": [], "fail_false_negative": [], "fail_false_positive": []}

    filtered = [p for p in payloads if not category_filter or p["category"] == category_filter]
    print(f"\n{'='*60}")
    print(f"  PrivateAI Security Fuzzer — {len(filtered)} payloads")
    print(f"  Target: {url}")
    print(f"{'='*60}\n")

    for p in filtered:
        ring = p.get("ring_level", 0)
        endpoint = p.get("endpoint", "/security/analyze")
        field = p.get("field", "content")
        agent = p.get("agent", None)
        try:
            result = analyze(url, p["payload"], ring, endpoint, field, agent)
        except Exception as e:
            print(f"  [ERROR] {p['id']}: {e}")
            continue

        # /delegate/parse returns {valid: bool}; all others return {allowed: bool}
        if endpoint == "/delegate/parse":
            blocked = not result.get("valid", True)
        else:
            blocked = not result["allowed"]
        expected_block = p["should_block"]

        if blocked == expected_block:
            results["pass"].append(p["id"])
            status = "✓"
        elif expected_block and not blocked:
            results["fail_false_negative"].append({**p, "result": result})
            status = "✗ MISSED"   # should have blocked, didn't
        else:
            results["fail_false_positive"].append({**p, "result": result})
            status = "! FALSE+"   # blocked something benign

        print(f"  [{status:8}] {p['id']:12} {p['category']:20} {p['payload'][:50]!r}")

    # Summary
    total = len(filtered)
    passed = len(results["pass"])
    fn = len(results["fail_false_negative"])
    fp = len(results["fail_false_positive"])

    print(f"\n{'='*60}")
    print(f"  RESULTS: {passed}/{total} passed")
    print(f"  False negatives (gaps): {fn}  ← payloads that slipped through")
    print(f"  False positives:        {fp}  ← benign messages wrongly blocked")
    print(f"{'='*60}\n")

    if results["fail_false_negative"]:
        print("GAPS — PAYLOADS THAT SLIPPED THROUGH:")
        for item in results["fail_false_negative"]:
            print(f"  [{item['id']}] {item['payload']!r}")
            print(f"    triggers: {item['result'].get('triggers', [])}")
        print()

    if results["fail_false_positive"]:
        print("FALSE POSITIVES — BENIGN MESSAGES WRONGLY BLOCKED:")
        for item in results["fail_false_positive"]:
            print(f"  [{item['id']}] {item['payload']!r}")
            print(f"    triggers: {item['result'].get('triggers', [])}")
        print()

    return fn == 0

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://localhost:8000")
    parser.add_argument("--category", default=None, help="Filter by category")
    parser.add_argument("--payloads", default=Path(__file__).parent / "payloads.json")
    args = parser.parse_args()

    payloads = json.loads(Path(args.payloads).read_text())
    ok = run(args.url, payloads, args.category)
    sys.exit(0 if ok else 1)
