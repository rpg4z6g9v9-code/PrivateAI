#!/usr/bin/env python3
"""
PrivateAI Security Fuzzer — Test Harness
========================================
Feeds attack payloads to the running PrivateAI app and captures results.

When the app is running on iPhone + connected to dev machine:
  python3 privateai_test_harness.py --app-url http://localhost:8000 --payloads payloads.json

Captures:
  - API response (allowed/blocked)
  - Threat level classification
  - Security triggers
  - Network logs (security proof panel)
  - Response times
  - Gaps (payload should have been blocked but wasn't)
"""

import json
import time
import argparse
import sys
from typing import Dict, List, Optional, Any
from dataclasses import asdict
import urllib.request
import urllib.error
from datetime import datetime


class AppTestHarness:
    """Harness for testing payloads against live app."""

    def __init__(self, app_url: str, timeout: int = 5):
        """
        Initialize harness.
        
        Args:
            app_url: Base URL of running app (e.g., http://localhost:8000)
            timeout: Request timeout in seconds
        """
        self.app_url = app_url.rstrip("/")
        self.timeout = timeout
        self.results = []

    def _send_payload(self, payload_content: str, ring_level: int) -> Dict[str, Any]:
        """
        Send a payload to the app and capture response.
        
        Expected app endpoint: POST /security/analyze
        Request body: {"content": str, "ring_level": int}
        Response body: {"allowed": bool, "threatLevel": str, "triggers": [str]}
        """
        endpoint = f"{self.app_url}/security/analyze"
        
        request_body = json.dumps({
            "content": payload_content,
            "ring_level": ring_level,
        }).encode("utf-8")

        try:
            start_time = time.time()
            
            request = urllib.request.Request(
                endpoint,
                data=request_body,
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                response_time_ms = int((time.time() - start_time) * 1000)
                response_body = json.loads(response.read().decode("utf-8"))
                
                return {
                    "success": True,
                    "status_code": response.status,
                    "response_time_ms": response_time_ms,
                    "allowed": response_body.get("allowed", None),
                    "threat_level": response_body.get("threatLevel", "unknown"),
                    "triggers": response_body.get("triggers", []),
                    "error": None,
                }
        
        except urllib.error.URLError as e:
            return {
                "success": False,
                "status_code": None,
                "response_time_ms": None,
                "allowed": None,
                "threat_level": None,
                "triggers": [],
                "error": f"URLError: {str(e)}",
            }
        except json.JSONDecodeError as e:
            return {
                "success": False,
                "status_code": None,
                "response_time_ms": None,
                "allowed": None,
                "threat_level": None,
                "triggers": [],
                "error": f"JSONDecodeError: {str(e)}",
            }
        except Exception as e:
            return {
                "success": False,
                "status_code": None,
                "response_time_ms": None,
                "allowed": None,
                "threat_level": None,
                "triggers": [],
                "error": f"{type(e).__name__}: {str(e)}",
            }

    def test_payloads(self, payloads: List[Dict[str, Any]], verbose: bool = True) -> List[Dict[str, Any]]:
        """
        Test all payloads against app.
        
        Args:
            payloads: List of payload dicts (from payloads.json)
            verbose: Print progress
            
        Returns:
            List of result dicts
        """
        results = []
        total = len(payloads)

        for idx, payload in enumerate(payloads):
            if verbose:
                print(f"[{idx + 1}/{total}] Testing {payload['category']:20} ... ", end="", flush=True)

            # Send payload
            app_response = self._send_payload(payload["content"], payload["ring_level"])

            # Determine if gap detected
            expected_block = payload.get("expected_block", True)
            actually_blocked = app_response.get("allowed") == False
            gap_detected = expected_block != actually_blocked

            result = {
                "payload_id": payload["id"],
                "category": payload["category"],
                "ring_level": payload["ring_level"],
                "obfuscation_level": payload["obfuscation_level"],
                "content_preview": payload["content"][:100],
                "expected_block": expected_block,
                "actually_blocked": actually_blocked,
                "threat_level": app_response.get("threat_level"),
                "triggers": app_response.get("triggers", []),
                "response_time_ms": app_response.get("response_time_ms"),
                "app_response_success": app_response.get("success"),
                "app_response_error": app_response.get("error"),
                "gap_detected": gap_detected,
                "timestamp": datetime.now().isoformat(),
            }

            results.append(result)

            # Status indicator
            if verbose:
                if gap_detected:
                    print(f"⚠️  GAP (expected: {expected_block}, got: {actually_blocked})")
                elif actually_blocked:
                    print("✅ BLOCKED")
                else:
                    print("❌ LEAKED")

            time.sleep(0.1)  # Rate limit

        self.results = results
        return results

    def save_results(self, filepath: str):
        """Save test results to JSON file."""
        output = {
            "metadata": {
                "tested_at": datetime.now().isoformat(),
                "total_payloads": len(self.results),
                "gaps_detected": sum(1 for r in self.results if r["gap_detected"]),
            },
            "results": self.results,
        }
        with open(filepath, "w") as f:
            json.dump(output, f, indent=2)
        print(f"\n✅ Results saved → {filepath}")

    def summarize(self):
        """Print summary of results."""
        if not self.results:
            print("No results to summarize.")
            return

        total = len(self.results)
        blocked = sum(1 for r in self.results if r["actually_blocked"])
        leaked = total - blocked
        gaps = sum(1 for r in self.results if r["gap_detected"])

        print("\n" + "=" * 70)
        print("FUZZER RESULTS SUMMARY")
        print("=" * 70)
        print(f"Total payloads tested: {total}")
        print(f"Successfully blocked: {blocked} ({blocked/total*100:.1f}%)")
        print(f"Leaked through: {leaked} ({leaked/total*100:.1f}%)")
        print(f"Security gaps detected: {gaps} ({gaps/total*100:.1f}%)")

        # By category
        by_category = {}
        for result in self.results:
            cat = result["category"]
            if cat not in by_category:
                by_category[cat] = {"total": 0, "blocked": 0, "gaps": 0}
            by_category[cat]["total"] += 1
            if result["actually_blocked"]:
                by_category[cat]["blocked"] += 1
            if result["gap_detected"]:
                by_category[cat]["gaps"] += 1

        print("\nBy category:")
        for cat in sorted(by_category.keys()):
            stats = by_category[cat]
            block_rate = stats["blocked"] / stats["total"] * 100
            print(f"  {cat:20} {stats['blocked']:3}/{stats['total']:3} blocked ({block_rate:5.1f}%)  |  {stats['gaps']} gaps")

        # Top gaps
        gaps_list = [r for r in self.results if r["gap_detected"]]
        if gaps_list:
            print("\n⚠️  TOP SECURITY GAPS (should have been blocked):")
            for gap in gaps_list[:10]:
                print(f"  [{gap['category']}] {gap['content_preview']}")
                print(f"    Ring: {gap['ring_level']}, Obfuscation: {gap['obfuscation_level']}")


def main():
    parser = argparse.ArgumentParser(description="PrivateAI Security Fuzzer — Test Harness")
    parser.add_argument("--app-url", required=True, help="App endpoint (e.g., http://localhost:8000)")
    parser.add_argument("--payloads", default="payloads.json", help="Payload file")
    parser.add_argument("--output", default="test_results.json", help="Output results file")
    parser.add_argument("--timeout", type=int, default=5, help="Request timeout (seconds)")
    parser.add_argument("--limit", type=int, default=None, help="Test only first N payloads")
    parser.add_argument("--category", help="Test only payloads from specific category")
    parser.add_argument("--quiet", action="store_true", help="Suppress progress output")

    args = parser.parse_args()

    # Load payloads
    print(f"[*] Loading payloads from {args.payloads}...")
    try:
        with open(args.payloads, "r") as f:
            payload_data = json.load(f)
        payloads = payload_data["payloads"]
    except FileNotFoundError:
        print(f"❌ Payload file not found: {args.payloads}")
        sys.exit(1)
    except json.JSONDecodeError:
        print(f"❌ Invalid JSON in {args.payloads}")
        sys.exit(1)

    # Filter payloads
    if args.category:
        payloads = [p for p in payloads if p["category"] == args.category]
        print(f"  Filtered to category '{args.category}': {len(payloads)} payloads")
    else:
        print(f"  Loaded {len(payloads)} payloads")

    if args.limit:
        payloads = payloads[:args.limit]
        print(f"  Limited to first {args.limit} payloads")

    # Test
    print(f"\n[*] Connecting to app at {args.app_url}...")
    harness = AppTestHarness(args.app_url, timeout=args.timeout)

    try:
        print(f"[*] Testing {len(payloads)} payloads...")
        harness.test_payloads(payloads, verbose=not args.quiet)
    except KeyboardInterrupt:
        print("\n\n⏸️  Interrupted by user")

    # Results
    harness.save_results(args.output)
    harness.summarize()


if __name__ == "__main__":
    main()
