# roombapy-prime needs Python 3.11+.
FROM python:3.12-slim

# git: roombapy-prime installs from a git tag. Removed after install to keep the
# image lean. psycopg[binary] ships a manylinux wheel, so no libpq/build-essential.
RUN apt-get update \
    && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt \
    && apt-get purge -y git && apt-get autoremove -y

COPY poller.py ./

# Unbuffered stdout so `docker compose logs` shows lines as they happen.
ENV PYTHONUNBUFFERED=1

CMD ["python", "poller.py"]
