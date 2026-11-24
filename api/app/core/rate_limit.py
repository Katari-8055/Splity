"""Small in-process sliding-window rate limiter.

Fine for a single API process. Swap for a Redis-backed limiter when the API
runs with several workers.
"""

import time
from collections import defaultdict, deque

from fastapi import Request

from app.core.config import get_settings
from app.core.errors import TooManyRequests


class SlidingWindowLimiter:
    def __init__(self, limit: int, window_seconds: int):
        self.limit = limit
        self.window = window_seconds
        self._hits: dict[str, deque[float]] = defaultdict(deque)

    def hit(self, key: str) -> bool:
        now = time.monotonic()
        hits = self._hits[key]
        while hits and now - hits[0] > self.window:
            hits.popleft()
        if len(hits) >= self.limit:
            return False
        hits.append(now)
        return True

    def reset(self) -> None:
        self._hits.clear()


_settings = get_settings()
login_limiter = SlidingWindowLimiter(_settings.login_rate_limit, _settings.login_rate_window_seconds)


async def limit_login(request: Request) -> None:
    client = request.client.host if request.client else "unknown"
    if not login_limiter.hit(client):
        raise TooManyRequests("Too many login attempts. Please try again in 15 minutes.")
