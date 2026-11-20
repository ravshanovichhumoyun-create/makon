import json
from pathlib import Path

import pytest

from app.services.parser import parse

CASES = json.loads((Path(__file__).parent / "parser_cases.json").read_text(encoding="utf-8"))


@pytest.mark.parametrize("case", CASES, ids=[c["text"][:30] or "empty" for c in CASES])
def test_parser_case(case):
    result = parse(case["text"], case.get("custom"))
    if case["amount"] is None:
        assert result is None
        return
    assert result is not None
    assert result["amount"] == case["amount"]
    if "type" in case:
        assert result["type"] == case["type"]
    if "category" in case:
        assert (result["category_id"] or result["category_key"]) == case["category"]
    if "note" in case:
        assert result["note"] == case["note"]
