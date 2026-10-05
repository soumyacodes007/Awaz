from api.services.agent_tests import prompts
from api.services.agent_tests.llm import clean_reply, parse_json

SESSION = {
    "turns": [
        {
            "user_message": None,
            "assistant_message": {"text": "Namaste, Sharma Dental."},
            "events": [],
        },
        {
            "user_message": {"text": "I want a cleaning on Tuesday"},
            "assistant_message": {"text": "Booked for Tuesday 3 PM."},
            "events": [
                {
                    "type": "tool_call_started",
                    "payload": {
                        "function_name": "book",
                        "tool_call_id": "c1",
                        "arguments": {"day": "Tue"},
                    },
                },
                {
                    "type": "tool_call_result",
                    "payload": {
                        "function_name": "book",
                        "tool_call_id": "c1",
                        "result": {"ok": True},
                    },
                },
                {"type": "session_end", "payload": {"reason": "end_call"}},
            ],
        },
    ]
}
BEHAVIORS = [
    {"id": "b1", "name": "Greets", "description": "Greets the caller"},
    {"id": "b2", "name": "Books", "description": "Books the slot"},
]


def test_transcript_keeps_order_tools_and_end():
    items = prompts.transcript_from_session(SESSION)
    assert [i["role"] for i in items] == ["agent", "user", "agent", "tool", "end"]
    assert items[3]["name"] == "book" and items[3]["arguments"] == {"day": "Tue"}
    assert items[3]["result"] == '{"ok": true}'
    text = prompts.transcript_text(items)
    assert (
        "CALLER: I want a cleaning on Tuesday" in text
        and "[CALL ENDED BY AGENT]" in text
    )


def test_simulator_sees_agent_as_user_and_itself_as_assistant():
    items = prompts.transcript_from_session(SESSION)
    msgs = prompts.simulator_messages("You want a cleaning.", items)
    assert msgs[0]["role"] == "system" and "You want a cleaning." in msgs[0]["content"]
    assert [m["role"] for m in msgs[1:]] == ["user", "assistant", "user"]
    assert msgs[1]["content"] == "Namaste, Sharma Dental."
    assert "using a tool: book" in msgs[3]["content"]


def test_simulator_opens_when_agent_is_silent():
    msgs = prompts.simulator_messages("x", [])
    assert msgs[-1] == {"role": "user", "content": prompts.OPENING_CUE}


def test_caller_reply_handles_end_labels_and_quotes():
    assert prompts.caller_reply("<END>") is None
    assert prompts.caller_reply("Thanks, bye! <END>") == "Thanks, bye!"
    assert prompts.caller_reply('Caller: "Yes, Tuesday works"') == "Yes, Tuesday works"


def test_verdicts_match_by_id_and_missing_ones_fail():
    out = prompts.parse_verdicts(
        {"verdicts": [{"id": "b2", "passed": "true", "reasoning": "It booked."}]},
        BEHAVIORS,
    )
    assert out[0]["passed"] is False and "didn't return" in out[0]["reasoning"]
    assert out[1] == {
        "behavior_id": "b2",
        "name": "Books",
        "passed": True,
        "reasoning": "It booked.",
    }


def test_verdicts_fall_back_to_order_without_ids():
    out = prompts.parse_verdicts(
        [{"passed": True, "reasoning": "a"}, {"passed": False, "reasoning": "b"}],
        BEHAVIORS,
    )
    assert [v["passed"] for v in out] == [True, False]


def test_parse_json_strips_think_and_fences():
    assert clean_reply("<think>hmm</think> Hello") == "Hello"
    assert parse_json('<think>x</think>Sure:\n```json\n{"a": 1}\n```') == {"a": 1}
    assert parse_json('[{"a": 1}, {"b": 2}]') == [{"a": 1}, {"b": 2}]


def test_generated_tests_are_normalized_and_filtered():
    data = {
        "tests": [
            {
                "name": "Happy path",
                "scenario": "You are…",
                "behaviors": [{"description": "Confirms the date"}],
            },
            {"name": "", "scenario": "x", "behaviors": [{"name": "a"}]},
            {"name": "No behaviors", "scenario": "x", "behaviors": []},
        ]
    }
    tests = prompts.parse_generated(data, 5)
    assert len(tests) == 1
    b = tests[0]["behaviors"][0]
    assert b["id"].startswith("b_") and b["name"] == "Confirms the date"


def test_parse_json_skips_braces_in_leaked_reasoning():
    reply = 'Thinking: the set {a, b} matters.\n{"verdicts": [{"id": "b1", "passed": true}]}'
    assert parse_json(reply, prefer="verdicts") == {
        "verdicts": [{"id": "b1", "passed": True}]
    }


def test_goodbyes_traded_ends_the_call():
    items = [{"role": "agent", "text": "Booked! Have a great day!"}]
    assert prompts.goodbyes_traded(items, "Thanks, bye!")
    assert not prompts.goodbyes_traded(items, "Wait, one more question")
    assert not prompts.goodbyes_traded(
        [{"role": "agent", "text": "What time works?"}], "Goodbye"
    )
