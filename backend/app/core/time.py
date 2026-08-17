from datetime import UTC, datetime


def as_utc(value: datetime) -> datetime:
    """Normalize database datetimes, including SQLite's timezone-naive values."""
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)
