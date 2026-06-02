import pytest

from app.pipeline import MistakeStateMachine


@pytest.fixture
def sm():
    return MistakeStateMachine(timeout_sec=2.0)


def _payload(correct: str) -> dict:
    return {"type": "MISPRONUNCIATION", "incorrect": "x", "correct": correct,
            "tajweedRule": None, "severity": None, "tip": None}


def test_register_first_mistake_emits(sm):
    events = sm.register_mistake(ayah=23, position=3, payload=_payload("ريب"), now=0.0)
    assert [e["type"] for e in events] == ["partial_mistake"]
    assert events[0]["ayah"] == 23
    assert events[0]["word_index"] == 3


def test_same_position_suppresses_re_emission(sm):
    sm.register_mistake(ayah=23, position=3, payload=_payload("ريب"), now=0.0)
    events = sm.register_mistake(ayah=23, position=3, payload=_payload("ريب"), now=0.5)
    assert events == []


def test_repeated_correctly_emits_word_corrected(sm):
    sm.register_mistake(ayah=23, position=3, payload=_payload("ريب"), now=0.0)
    events = sm.on_locked_word(ayah=23, position=3, locked_normalised="ريب", now=0.5)
    assert [e["type"] for e in events] == ["word_corrected"]
    assert events[0]["word_index"] == 3


def test_moved_on_emits_acknowledged(sm):
    sm.register_mistake(ayah=23, position=3, payload=_payload("ريب"), now=0.0)
    # user said the NEXT expected word at position 4 → ack the pending at 3
    events = sm.on_locked_word(ayah=23, position=4, locked_normalised="مما", now=0.4)
    assert any(e["type"] == "mistake_acknowledged" and e["word_index"] == 3 for e in events)


def test_timeout_emits_acknowledged(sm):
    sm.register_mistake(ayah=23, position=3, payload=_payload("ريب"), now=0.0)
    events = sm.sweep(now=2.5)   # > timeout
    assert [e["type"] for e in events] == ["mistake_acknowledged"]


def test_reset_ayah_clears_pending(sm):
    sm.register_mistake(ayah=23, position=3, payload=_payload("ريب"), now=0.0)
    sm.reset_ayah(23)
    events = sm.sweep(now=10.0)
    assert events == []
