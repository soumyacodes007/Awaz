"""Prompts and parsing for agent tests. Pure functions, unit-tested."""

from __future__ import annotations

import json
import re
import uuid

END_TOKEN = "<END>"
MAX_TOOL_TEXT = 1200

# ── Transcript ──────────────────────────────────────────────────────────


def _clip(value) -> str:
    text = (
        value
        if isinstance(value, str)
        else json.dumps(value, ensure_ascii=False, default=str)
    )
    return text if len(text) <= MAX_TOOL_TEXT else text[:MAX_TOOL_TEXT] + "…"


def transcript_from_session(session_data: dict) -> list[dict]:
    """Flatten text-chat turns into transcript items, in the order they happened:
    caller message, agent reply, tool calls (with results), then call end."""
    items: list[dict] = []
    for turn in session_data.get("turns") or []:
        user = (turn.get("user_message") or {}).get("text")
        if user:
            items.append({"role": "user", "text": user})
        agent = (turn.get("assistant_message") or {}).get("text")
        if agent:
            items.append({"role": "agent", "text": agent})
        results = {
            e["payload"].get("tool_call_id"): e["payload"].get("result")
            for e in turn.get("events") or []
            if e.get("type") == "tool_call_result"
            and isinstance(e.get("payload"), dict)
        }
        for event in turn.get("events") or []:
            payload = event.get("payload") or {}
            if event.get("type") == "tool_call_started":
                items.append(
                    {
                        "role": "tool",
                        "name": payload.get("function_name") or "tool",
                        "arguments": payload.get("arguments") or {},
                        "result": _clip(results.get(payload.get("tool_call_id")))
                        if payload.get("tool_call_id") in results
                        else None,
                    }
                )
            elif event.get("type") == "session_end":
                items.append({"role": "end", "text": "Agent ended the call"})
    return items


def transcript_text(items: list[dict]) -> str:
    """Plain-text transcript for the judge."""
    lines = []
    for item in items:
        role = item["role"]
        if role == "agent":
            lines.append(f"AGENT: {item['text']}")
        elif role == "user":
            lines.append(f"CALLER: {item['text']}")
        elif role == "tool":
            args = json.dumps(item.get("arguments") or {}, ensure_ascii=False)
            line = f"[AGENT CALLED TOOL {item['name']}({args})"
            if item.get("result") is not None:
                line += f" → {item['result']}"
            lines.append(line + "]")
        elif role == "end":
            lines.append("[CALL ENDED BY AGENT]")
        elif role == "caller_end":
            lines.append("[CALLER HUNG UP]")
    return "\n".join(lines)


# ── Simulated caller ────────────────────────────────────────────────────

SIMULATOR_SYSTEM = """You are playing a person on a phone call with a company's voice AI agent. You are the CALLER, never the agent.

Your scenario:
{scenario}

How to play it:
- Reply with only the words you would say out loud. One or two short sentences, like real speech on a phone.
- No stage directions, no quotes, no labels like "Caller:", no emojis.
- Follow your scenario: share details when asked, push back where it says to, and say the exact phrases it gives you.
- Don't lead the conversation or answer questions nobody asked. Let the agent do its job.
- Never mention that this is a test, a simulation or a scenario.
- Reply in the language the agent is using unless your scenario says otherwise.
- When the conversation is finished (your goal is done or clearly can't be, or goodbyes were said), reply with exactly {end} and nothing else. Never trade more than one goodbye."""

OPENING_CUE = (
    "(The call has connected and the agent hasn't spoken yet. Say your opening line.)"
)


def simulator_messages(scenario: str, items: list[dict]) -> list[dict]:
    """The conversation from the caller's point of view: agent turns are the
    model's input ("user"), the caller's own lines are its output ("assistant")."""
    messages = [
        {
            "role": "system",
            "content": SIMULATOR_SYSTEM.format(
                scenario=scenario.strip(), end=END_TOKEN
            ),
        }
    ]
    pending_agent: list[str] = []
    for item in items:
        if item["role"] == "agent":
            pending_agent.append(item["text"])
        elif item["role"] == "tool":
            pending_agent.append(f"(The agent is using a tool: {item['name']}.)")
        elif item["role"] == "user":
            if pending_agent:
                messages.append({"role": "user", "content": "\n".join(pending_agent)})
                pending_agent = []
            messages.append({"role": "assistant", "content": item["text"]})
    if pending_agent:
        messages.append({"role": "user", "content": "\n".join(pending_agent)})
    if messages[-1]["role"] != "user":
        messages.append({"role": "user", "content": OPENING_CUE})
    return messages


_FAREWELL = re.compile(
    r"\b(good ?bye|bye|take care|have a (?:great|nice|good|wonderful|lovely) (?:day|evening|one)|see you|talk (?:to you )?soon|alvida|phir milenge)\b",
    re.IGNORECASE,
)


def is_farewell(text: str | None) -> bool:
    return bool(text and _FAREWELL.search(text))


def goodbyes_traded(items: list[dict], caller_line: str) -> bool:
    """The agent's last line and the caller's next one are both goodbyes: the
    call is over. Models keep trading pleasantries otherwise, burning turns."""
    last_agent = next(
        (i.get("text") for i in reversed(items) if i["role"] == "agent"), None
    )
    return is_farewell(last_agent) and is_farewell(caller_line)


def caller_reply(text: str) -> str | None:
    """The caller's line, or None when the simulator ended the call."""
    text = text.strip()
    if END_TOKEN.lower() in text.lower():
        before = text[: text.lower().index(END_TOKEN.lower())].strip()
        return before or None
    # Models sometimes prefix a role label or wrap the line in quotes.
    text = re.sub(r"^(caller|user|me)\s*:\s*", "", text, flags=re.IGNORECASE)
    return text.strip().strip('"').strip() or None


# ── Judge ───────────────────────────────────────────────────────────────

JUDGE_SYSTEM = """You are a strict QA reviewer for voice AI agents. You grade one phone conversation against a list of expected behaviors.

Rules:
- Judge only from the transcript. If the transcript doesn't clearly show a behavior, it fails.
- Tool calls appear in [brackets]; they count as things the agent did.
- Grade every behavior independently.
- Each reasoning is one sentence that cites what the agent said or did (quote short phrases).

Reply with JSON only, no prose:
{"verdicts": [{"id": "<behavior id>", "passed": true or false, "reasoning": "<one sentence>"}]}"""


def judge_messages(
    scenario: str, behaviors: list[dict], items: list[dict]
) -> list[dict]:
    listed = "\n".join(
        f'- id "{b["id"]}": {b.get("name") or ""}. {b.get("description") or ""}'.strip()
        for b in behaviors
    )
    user = (
        f"Caller's scenario (for context):\n{scenario.strip()}\n\n"
        f"Expected behaviors:\n{listed}\n\n"
        f"Transcript:\n{transcript_text(items) or '(no conversation happened)'}"
    )
    return [
        {"role": "system", "content": JUDGE_SYSTEM},
        {"role": "user", "content": user},
    ]


def parse_verdicts(data, behaviors: list[dict]) -> list[dict]:
    """Match the judge's verdicts to behaviors by id, falling back to order.
    A behavior with no verdict fails, so a sloppy judge can't pass a test."""
    raw = data.get("verdicts") if isinstance(data, dict) else data
    raw = [v for v in raw or [] if isinstance(v, dict)]
    by_id = {str(v.get("id")): v for v in raw if v.get("id") is not None}
    out = []
    for i, b in enumerate(behaviors):
        v = by_id.get(str(b["id"])) or (
            raw[i] if i < len(raw) and raw[i].get("id") is None else None
        )
        passed = v is not None and _truthy(v.get("passed"))
        out.append(
            {
                "behavior_id": b["id"],
                "name": b.get("name") or b.get("description") or "",
                "passed": passed,
                "reasoning": (v or {}).get("reasoning")
                or "The judge didn't return a verdict for this behavior.",
            }
        )
    return out


def _truthy(value) -> bool:
    if isinstance(value, str):
        return value.strip().lower() in ("true", "pass", "passed", "yes")
    return value is True


# ── Generating tests ────────────────────────────────────────────────────

GENERATOR_SYSTEM = """You write test cases for a voice AI agent. A test case is a simulated caller plus the behaviors the agent must show.

Write {count} diverse test cases for the agent below:
- Cover the main happy path first, then edge cases: an off-topic or wrong person, an objection or refusal, missing or changing information, a frustrated caller, a language switch if the agent is multilingual.
- One intent per test.
- "scenario" is written to the caller in second person ("You are …"): who they are, what they want, how they behave, and exact phrases to say when it matters (dates, names, numbers).
- 3 to 5 "behaviors" per test. Each is a concrete yes/no check of the AGENT, e.g. "Confirms the appointment date and time before ending the call". Never vague ("handles the call well").
- Each behavior has a short "name" (2–5 words) and a "description" (one sentence).

Reply with JSON only:
{{"tests": [{{"name": "...", "scenario": "...", "behaviors": [{{"name": "...", "description": "..."}}]}}]}}"""


def generator_messages(
    agent_prompt: str, greeting: str | None, tools: list[str], count: int
) -> list[dict]:
    agent = f"System prompt:\n{agent_prompt.strip() or '(empty)'}"
    if greeting:
        agent += f"\n\nFirst message: {greeting}"
    if tools:
        agent += f"\n\nTools it can call: {', '.join(tools)}"
    return [
        {"role": "system", "content": GENERATOR_SYSTEM.format(count=count)},
        {"role": "user", "content": agent},
    ]


def new_behavior_id() -> str:
    return f"b_{uuid.uuid4().hex[:8]}"


def normalize_behaviors(behaviors: list[dict]) -> list[dict]:
    """Give every behavior an id and a name; drop empty ones."""
    out = []
    for b in behaviors or []:
        description = str(b.get("description") or "").strip()
        name = str(b.get("name") or "").strip()
        if not description and not name:
            continue
        out.append(
            {
                "id": str(b.get("id") or new_behavior_id()),
                "name": name[:120] or description[:60],
                "description": description or name,
            }
        )
    return out


def parse_generated(data, limit: int) -> list[dict]:
    raw = data.get("tests") if isinstance(data, dict) else data
    tests = []
    for t in raw or []:
        if not isinstance(t, dict):
            continue
        name = str(t.get("name") or "").strip()[:200]
        scenario = str(t.get("scenario") or "").strip()
        behaviors = normalize_behaviors(t.get("behaviors") or [])
        if name and scenario and behaviors:
            tests.append({"name": name, "scenario": scenario, "behaviors": behaviors})
    return tests[:limit]
