from demo_module import greet


def test_greet_mentions_name() -> None:
    value = greet("Sam")
    assert isinstance(value, str)
    assert "Sam" in value
