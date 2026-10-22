# Torobche: one image = API + built front end + read-only SQLite built from the hackathon dataset.
# The dataset zip is not in git; the deploy script puts it at deploy/dataset.zip in the build context.

FROM python:3.12-slim AS data
WORKDIR /build
COPY data/build_db.py backend/scripts/make_app_db.py ./
COPY deploy/dataset.zip ./dataset.zip
RUN python -c "import zipfile; zipfile.ZipFile('dataset.zip').extractall('dataset')" \
 && python -I build_db.py --dataset dataset --db torob.db \
 && python -I make_app_db.py torob.db app.db \
 && rm -rf dataset dataset.zip torob.db

FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 \
    DB_PATH=/app/data/app.db STATIC_DIR=/app/frontend/dist \
    LLM_PROVIDER=boxapi LLM_FALLBACK_PROVIDER=none
WORKDIR /app
COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt
COPY data/build_db.py data/build_db.py
COPY backend/app backend/app
COPY frontend/dist frontend/dist
COPY --from=data /build/app.db data/app.db
WORKDIR /app/backend
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=4)"
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*", "--timeout-keep-alive", "30"]
