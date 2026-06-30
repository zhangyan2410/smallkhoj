FROM python:3.12-slim
WORKDIR /app/backend
COPY backend/ ./
COPY release-artifacts/ /app/release-artifacts/
RUN pip install uv && uv sync
CMD ["uv", "run", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
