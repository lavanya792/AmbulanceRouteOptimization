FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

# Install GCC to compile the C algorithms
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    libc6-dev \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application files
COPY api/ ./api/
COPY backend/ ./backend/
COPY data/nodes.csv ./data/nodes.csv
COPY data/edges.csv ./data/edges.csv
COPY frontend/ ./frontend/

# Compile the C algorithms
RUN gcc -std=c11 -O2 -Wall -Wextra \
    -o backend/ambulance_cli \
    backend/main.c \
    backend/graph.c \
    backend/dijkstra.c \
    backend/astar.c \
    backend/bellman_ford.c \
    backend/prim.c \
    backend/kruskal.c \
    -lm

EXPOSE 10000

CMD ["gunicorn", "--bind", "0.0.0.0:10000", "--workers", "2", "--timeout", "120", "api.app:app"]
