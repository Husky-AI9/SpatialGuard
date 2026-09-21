FROM node:22-bookworm-slim AS web-build

WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/spatial-view/package.json packages/spatial-view/package.json
COPY spatialguard/apps/web/package.json spatialguard/apps/web/package.json
RUN npm ci

COPY packages/spatial-view packages/spatial-view
COPY packages/contracts packages/contracts
COPY packages/sdk-typescript packages/sdk-typescript
COPY spatialguard/apps/web spatialguard/apps/web
RUN npm run build --workspace spatialguard-web

FROM python:3.11-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app/spatialguard/services/api:/app/services/api:/app/packages/sdk-python

WORKDIR /app

COPY requirements.lock ./requirements.lock
RUN python -m pip install --no-cache-dir --upgrade pip \
    && python -m pip install --no-cache-dir -r requirements.lock

COPY services/api/twinforge services/api/twinforge
COPY packages/sdk-python packages/sdk-python
COPY spatialguard/services/api spatialguard/services/api
COPY --from=web-build /app/spatialguard/apps/web/dist spatialguard/apps/web/dist

EXPOSE 8010

CMD ["sh", "-c", "python -m uvicorn spatialguard_api.api:create_app --factory --host 0.0.0.0 --port ${PORT:-8010}"]
