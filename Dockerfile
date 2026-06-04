# Multi-stage build for Data Conversion Studio
# Stage 1: build frontend assets
FROM node:20-bullseye AS frontend-builder
WORKDIR /src
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend ./frontend
WORKDIR /src/frontend
RUN npm run build

# Stage 2: build Python backend image
FROM python:3.12-slim AS runtime
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        build-essential \
        python3-dev \
        unixodbc-dev \
        curl \
        ca-certificates \
        gnupg \
    && curl -sSL https://packages.microsoft.com/keys/microsoft.asc | tee /etc/apt/trusted.gpg.d/microsoft.asc > /dev/null \
    && curl -sSL https://packages.microsoft.com/config/debian/12/prod.list > /etc/apt/sources.list.d/mssql-release.list \
    && apt-get update \
    && ACCEPT_EULA=Y apt-get install -y --no-install-recommends msodbcsql18 \
    && rm -rf /var/lib/apt/lists/*

COPY api/requirements.txt ./api/requirements.txt
RUN pip install --no-cache-dir -r api/requirements.txt

COPY api ./api
COPY static ./static

# Copy built frontend from previous stage to backend static assets
COPY --from=frontend-builder /src/static ./static

EXPOSE 8000
ENTRYPOINT ["uvicorn", "api.main:app", "--host", "0.0.0.0", "--port", "8000"]
