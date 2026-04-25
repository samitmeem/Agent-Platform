def greet(name: str) -> str:
    return f"Hello, {name}!"


SUCCESS_REPLACEMENT = """
def greet(name: str) -> str:
    return f"Hi there, {name}!"
"""

FAILURE_REPLACEMENT = """
def greet(name: str) -> str:
    return 123
"""
