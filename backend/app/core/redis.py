from functools import lru_cache

from arq import ArqRedis, create_pool
from arq.connections import RedisSettings
from redis.asyncio import Redis

from app.config import settings


@lru_cache
def redis_client() -> Redis:
    return Redis.from_url(settings.redis_url, decode_responses=True)


def arq_settings() -> RedisSettings:
    return RedisSettings.from_dsn(settings.redis_url)


async def arq_pool() -> ArqRedis:
    return await create_pool(arq_settings())
