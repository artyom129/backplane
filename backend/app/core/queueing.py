"""Queue jobs only after the rows they point at are committed.

A worker that picks up a job before the producing transaction commits finds no
row and drops the work. Producers register jobs on the session and publish them
with ``commit_and_enqueue`` once the commit has succeeded.
"""

from typing import Any

from arq import ArqRedis
from sqlalchemy.ext.asyncio import AsyncSession

_PENDING_KEY = "backplane_pending_jobs"


def defer_job(session: AsyncSession, function: str, *args: Any, **kwargs: Any) -> None:
    session.info.setdefault(_PENDING_KEY, []).append((function, args, kwargs))


def pending_jobs(session: AsyncSession) -> list[tuple[str, tuple[Any, ...], dict[str, Any]]]:
    return list(session.info.get(_PENDING_KEY, []))


async def commit_and_enqueue(session: AsyncSession, queue: ArqRedis) -> None:
    await session.commit()
    jobs = session.info.pop(_PENDING_KEY, [])
    for function, args, kwargs in jobs:
        await queue.enqueue_job(function, *args, **kwargs)
