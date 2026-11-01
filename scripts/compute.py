"""Aggregate Claude Code activity from ~/.claude/projects transcripts.

Prints one JSON summary on stdout. Per-file results are cached by
(mtime, size) so only new or changed transcripts are re-read.
"""

import json
import os
import sys
from collections import defaultdict
from datetime import date, datetime, timedelta

HOME = os.path.expanduser("~")
PROJECTS = os.path.join(HOME, ".claude", "projects")
CACHE_DIR = os.path.join(HOME, ".cache", "claude-stats-mod")
CACHE = os.path.join(CACHE_DIR, "files-v2.json")


# Cache reads dominate: every turn re-reads the whole conversation from cache.
USAGE_FIELDS = [
    ("input_tokens", "input"),
    ("output_tokens", "output"),
    ("cache_creation_input_tokens", "cacheWrite"),
    ("cache_read_input_tokens", "cacheRead"),
]


def local_day_hour(ts):
    try:
        t = datetime.fromisoformat(ts.replace("Z", "+00:00")).astimezone()
    except (ValueError, AttributeError):
        return None, None
    return t.date().isoformat(), t.hour


def scan_file(path):
    days = defaultdict(lambda: [0, 0, 0])  # messages, tool calls, tokens
    models = defaultdict(int)
    hours = defaultdict(int)
    kinds = defaultdict(int)
    seen = set()
    first = last = None
    with open(path, "rb") as f:
        for raw in f:
            try:
                row = json.loads(raw)
            except ValueError:
                continue
            kind = row.get("type")
            if kind not in ("user", "assistant"):
                continue
            day, hour = local_day_hour(row.get("timestamp"))
            if day is None:
                continue
            msg = row.get("message") or {}
            if kind == "user":
                content = msg.get("content")
                if row.get("isMeta") or (
                    isinstance(content, list)
                    and all(isinstance(b, dict) and b.get("type") == "tool_result" for b in content)
                ):
                    continue
                days[day][0] += 1
                hours[hour] += 1
            else:
                tools = sum(
                    1 for b in msg.get("content") or [] if isinstance(b, dict) and b.get("type") == "tool_use"
                )
                days[day][1] += tools
                mid = msg.get("id")
                if mid in seen:
                    continue
                seen.add(mid)
                days[day][0] += 1
                usage = msg.get("usage") or {}
                tokens = 0
                for field, kind_name in USAGE_FIELDS:
                    n = usage.get(field) or 0
                    kinds[kind_name] += n
                    tokens += n
                days[day][2] += tokens
                model = msg.get("model")
                if model and not model.startswith("<"):
                    models[model] += tokens
            ts = row.get("timestamp")
            first = ts if first is None or ts < first else first
            last = ts if last is None or ts > last else last
    return {"days": days, "models": models, "hours": hours, "kinds": kinds, "first": first, "last": last}


def load_cache():
    try:
        with open(CACHE) as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def save_cache(cache):
    os.makedirs(CACHE_DIR, exist_ok=True)
    tmp = CACHE + ".tmp"
    with open(tmp, "w") as f:
        json.dump(cache, f)
    os.replace(tmp, CACHE)


def streaks(active):
    if not active:
        return 0, 0
    ordered = sorted(date.fromisoformat(d) for d in active)
    longest = run = 1
    for a, b in zip(ordered, ordered[1:]):
        run = run + 1 if b - a == timedelta(days=1) else 1
        longest = max(longest, run)
    today = date.today()
    cur = 0
    d = today if today in ordered else today - timedelta(days=1)
    s = set(ordered)
    while d in s:
        cur += 1
        d -= timedelta(days=1)
    return cur, longest


def main():
    old = load_cache()
    cache = {}
    for root, _dirs, files in os.walk(PROJECTS):
        for name in files:
            if not name.endswith(".jsonl"):
                continue
            path = os.path.join(root, name)
            try:
                st = os.stat(path)
            except OSError:
                continue
            key = [st.st_mtime, st.st_size]
            hit = old.get(path)
            if hit and hit["key"] == key:
                cache[path] = hit
                continue
            try:
                res = scan_file(path)
            except OSError:
                continue
            # A top-level transcript is a session; subagent files are not.
            res["isSession"] = os.path.dirname(os.path.dirname(path)) == PROJECTS
            res["key"] = key
            cache[path] = res
    save_cache(cache)

    days = defaultdict(lambda: {"messages": 0, "sessions": 0, "tools": 0, "tokens": 0})
    models = defaultdict(int)
    hours = defaultdict(int)
    kinds = defaultdict(int)
    sessions = 0
    longest = {"messages": 0, "date": None}
    first = None
    for res in cache.values():
        msgs = 0
        for day, (m, t, k) in res["days"].items():
            days[day]["messages"] += m
            days[day]["tools"] += t
            days[day]["tokens"] += k
            msgs += m
        for model, k in res["models"].items():
            models[model] += k
        for h, n in res["hours"].items():
            hours[int(h)] += n
        for kind_name, n in res["kinds"].items():
            kinds[kind_name] += n
        if res["first"] and (first is None or res["first"] < first):
            first = res["first"]
        if res["isSession"] and msgs:
            sessions += 1
            start, _ = local_day_hour(res["first"])
            if start:
                days[start]["sessions"] += 1
            # Resumed sessions span weeks of wall clock, so rank by messages.
            if msgs > longest["messages"]:
                longest = {"messages": msgs, "date": start}

    active = [d for d, v in days.items() if v["messages"]]
    cur, best = streaks(active)
    out = {
        "computedAt": datetime.now().astimezone().isoformat(timespec="seconds"),
        "daily": {d: days[d] for d in sorted(days)},
        "models": dict(sorted(models.items(), key=lambda kv: -kv[1])),
        "hours": [hours.get(h, 0) for h in range(24)],
        "totalSessions": sessions,
        "totalMessages": sum(v["messages"] for v in days.values()),
        "totalTokens": sum(v["tokens"] for v in days.values()),
        "tokenBreakdown": {k: kinds.get(k, 0) for _, k in USAGE_FIELDS},
        "activeDays": len(active),
        "currentStreak": cur,
        "longestStreak": best,
        "longestSession": longest,
        "firstSession": first,
    }
    json.dump(out, sys.stdout)


if __name__ == "__main__":
    main()
