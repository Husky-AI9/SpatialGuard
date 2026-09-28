"""Weekly AI insight for Site Analytics, written by Amazon Bedrock.

The model receives only the aggregate numbers shown on the dashboard: visit
counts, hours, zone and camera names, dwell times and layout-change dates. It
never receives images, recordings, tracks or anything about individual people.
It must use only those numbers, and its answer is validated before it is shown.

Configuration (server-side only): ``AWS_BEARER_TOKEN_BEDROCK`` (a Bedrock API
key), ``AWS_REGION`` (default us-west-2) and optionally
``PATHLIGHT_INSIGHT_MODEL`` (default Amazon Nova Pro). Values from the root
``.env`` are used when the environment does not set them.
"""

from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Literal

from pydantic import Field, ValidationError

from .models import Model

DEFAULT_MODEL = "us.amazon.nova-pro-v1:0"
KEYS = ("AWS_BEARER_TOKEN_BEDROCK", "AWS_REGION", "PATHLIGHT_INSIGHT_MODEL")


class InsightUnavailable(RuntimeError):
    pass


class Highlight(Model):
    title: str = Field(min_length=1, max_length=80)
    detail: str = Field(min_length=1, max_length=260)
    trend: Literal["up", "down", "flat", "info"] = "info"


class Insight(Model):
    headline: str = Field(min_length=1, max_length=160)
    summary: str = Field(min_length=1, max_length=600)
    highlights: list[Highlight] = Field(default_factory=list, max_length=4)
    recommendation: str = Field(min_length=1, max_length=320)


def _settings() -> dict[str, str]:
    values = {key: os.environ.get(key, "") for key in KEYS}
    env = Path(__file__).resolve().parents[4] / ".env"
    if env.is_file() and not all(values[key] for key in KEYS[:2]):
        for line in env.read_text(encoding="utf-8").splitlines():
            key, separator, value = line.partition("=")
            key = key.strip()
            if separator and key in KEYS and not values[key]:
                values[key] = value.strip().strip('"').strip("'")
    values["AWS_REGION"] = values["AWS_REGION"] or "us-west-2"
    values["PATHLIGHT_INSIGHT_MODEL"] = values["PATHLIGHT_INSIGHT_MODEL"] or DEFAULT_MODEL
    return values


def status() -> dict:
    settings = _settings()
    return {"available": bool(settings["AWS_BEARER_TOKEN_BEDROCK"]), "model": settings["PATHLIGHT_INSIGHT_MODEL"],
            "provider": "Amazon Bedrock"}


SYSTEM = (
    "You are a retail and workplace foot-traffic analyst writing a short weekly note for a small-business owner. "
    "Use ONLY the numbers in the data you are given. Never invent causes, events, people, or numbers. "
    "You may connect a change to a layout change only if its date is listed in layout_changes, and then say it "
    "coincided rather than caused. Percentages must be computed from the given counts. "
    "Positions are estimates from camera views, so talk about zones and times, not exact spots. "
    "If there is little data, say so plainly and suggest what would help. "
    "Write plainly, in the second person, with no hype, and use the times exactly as given (like 5 PM). "
    "The headline leads with the single most important change in under 80 characters. "
    "The recommendation is ONE specific, low-cost action tied to a named zone, hour or entrance from the data "
    "(for example staffing at the peak hour, signage at a quiet zone, or moving a display toward the busiest zone); "
    "never generic advice such as 'analyze the factors'. Reply with JSON only, matching this shape: "
    '{"headline": str, "summary": str (2-3 sentences), '
    '"highlights": [{"title": str (2-4 words), "detail": str, "trend": "up"|"down"|"flat"|"info"}] (2-4 items), '
    '"recommendation": str}.'
)


def _facts(metrics: dict) -> dict:
    """The aggregate numbers the model may use; nothing else leaves the server."""
    hour = lambda h: None if h is None else ("12 AM" if h == 0 else f"{h} AM" if h < 12 else "12 PM" if h == 12 else f"{h - 12} PM")
    return {
        "site": metrics["site_name"],
        "period": "last 7 days vs the 7 days before",
        "time_zone": metrics["time_zone"],
        "visits": metrics["totals"]["visits"],
        "visits_previous": metrics["totals"]["previous"],
        "change_pct": metrics["totals"]["change_pct"],
        "average_visit_seconds": metrics["totals"]["avg_visit_s"],
        "average_visit_seconds_previous": metrics["totals"]["avg_visit_previous_s"],
        "peak_hour": hour(metrics["totals"]["peak_hour"]),
        "peak_hour_previous": hour(max(range(24), key=lambda h: metrics["hourly"][h]["previous"]))
        if any(h["previous"] for h in metrics["hourly"]) else None,
        "daily": [{"date": d["date"], "visits": d["visits"], "same_day_previous_week": d["previous"]}
                  for d in metrics["daily"]],
        "busiest_hours": sorted(({"hour": hour(h["hour"]), "visits": h["visits"], "previous": h["previous"]}
                                 for h in metrics["hourly"] if h["visits"] or h["previous"]),
                                key=lambda item: -item["visits"])[:6],
        "zones": [{"zone": z["name"], "visits": z["visits"], "previous": z["previous"],
                   "average_dwell_seconds": z["dwell_s"], "average_dwell_seconds_previous": z["dwell_previous_s"]}
                  for z in metrics["zones"][:12]],
        "entrances": [{"camera": e["name"], "visits": e["visits"], "previous": e["previous"]}
                      for e in metrics["entrances"][:8]],
        "data_quality": metrics["quality"],
        "layout_changes": metrics["layout_changes"],
    }


def _json(text: str) -> dict:
    match = re.search(r"\{.*\}", text, re.S)
    if not match:
        raise InsightUnavailable("The AI summary could not be read. Try again.")
    return json.loads(match.group(0))


def generate(metrics: dict, timeout: float = 45) -> dict:
    settings = _settings()
    token = settings["AWS_BEARER_TOKEN_BEDROCK"]
    if not token:
        raise InsightUnavailable("AI insights are not configured on this server.")
    model = settings["PATHLIGHT_INSIGHT_MODEL"]
    body = {
        "system": [{"text": SYSTEM}],
        "messages": [{"role": "user", "content": [{"text": "Data:\n" + json.dumps(_facts(metrics))}]}],
        "inferenceConfig": {"maxTokens": 700, "temperature": 0.2},
    }
    url = (f"https://bedrock-runtime.{settings['AWS_REGION']}.amazonaws.com/model/"
           f"{urllib.parse.quote(model, safe='')}/converse")
    request = urllib.request.Request(url, data=json.dumps(body).encode(), method="POST",
                                     headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            reply = json.load(response)
    except urllib.error.HTTPError as error:
        # Never surface provider bodies; they can echo request details.
        raise InsightUnavailable(f"Amazon Bedrock is unavailable (HTTP {error.code}). Try again later.") from None
    except (urllib.error.URLError, TimeoutError, OSError):
        raise InsightUnavailable("Amazon Bedrock could not be reached. Try again later.") from None
    try:
        text = "".join(part.get("text", "") for part in reply["output"]["message"]["content"])
        raw = _json(text)
        # Keep only the fields the dashboard shows; models sometimes add extras.
        raw = {key: raw.get(key) for key in ("headline", "summary", "highlights", "recommendation") if key in raw}
        raw["highlights"] = [{k: h.get(k) for k in ("title", "detail", "trend") if k in h}
                             for h in (raw.get("highlights") or [])[:4] if isinstance(h, dict)]
        insight = Insight.model_validate(raw)
    except (KeyError, TypeError, ValueError, ValidationError):
        raise InsightUnavailable("The AI summary was incomplete. Try again.") from None
    return {**insight.model_dump(), "model": model, "provider": "Amazon Bedrock",
            "usage": {k: reply.get("usage", {}).get(k) for k in ("inputTokens", "outputTokens")}}
