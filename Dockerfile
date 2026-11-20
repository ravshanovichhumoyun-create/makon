# For any Docker host (Koyeb, Fly.io, a VPS). Render users can ignore this file.
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PORT=8000
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY backend backend
COPY frontend frontend
EXPOSE 8000
CMD uvicorn --app-dir backend app.main:app --host 0.0.0.0 --port ${PORT}
