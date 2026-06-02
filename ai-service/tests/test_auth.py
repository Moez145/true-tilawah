from app.auth import check_bearer_token


def test_correct_token_passes(monkeypatch):
    monkeypatch.setattr("app.auth.AI_SERVICE_AUTH_TOKEN", "secret123")
    assert check_bearer_token("Bearer secret123") is True


def test_wrong_token_fails(monkeypatch):
    monkeypatch.setattr("app.auth.AI_SERVICE_AUTH_TOKEN", "secret123")
    assert check_bearer_token("Bearer nope") is False


def test_missing_prefix_fails(monkeypatch):
    monkeypatch.setattr("app.auth.AI_SERVICE_AUTH_TOKEN", "secret123")
    assert check_bearer_token("secret123") is False


def test_no_configured_token_allows_all(monkeypatch):
    monkeypatch.setattr("app.auth.AI_SERVICE_AUTH_TOKEN", "")
    assert check_bearer_token(None) is True
    assert check_bearer_token("anything") is True
