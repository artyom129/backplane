from app.core.logging import configure_logging
from app.core.redis import arq_settings
from app.workers.tasks import deliver_webhook, execute_job

configure_logging()


class WorkerSettings:
    functions = [deliver_webhook, execute_job]
    redis_settings = arq_settings()
    max_jobs = 20
    job_timeout = 90
    keep_result = 3_600
    health_check_interval = 30
