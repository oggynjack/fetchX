import os
import sys
import redis
from rq import SimpleWorker

# Redis connection
REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6381")
redis_conn = redis.from_url(REDIS_URL)

# Get unique worker name from PM2 process name or PID
worker_name = os.environ.get("PM2_PROCESS_NAME", f"fetchx-worker-{os.getpid()}")

if __name__ == "__main__":
    worker = SimpleWorker(
        queues=["default"],
        connection=redis_conn,
        name=worker_name,
    )
    print(f"[fetchX Worker] Started: {worker_name}")
    worker.work()
