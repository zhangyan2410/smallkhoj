FROM python:3.12-slim
WORKDIR /app/backend
# Use China PyPI mirror by default; overridable via build-arg / env for other regions.
# Fixes SSL MITM failures behind corporate VPNs and speeds up domestic builds.
ARG PIP_INDEX_URL=https://mirrors.aliyun.com/pypi/simple
ARG PIP_TRUSTED_HOST=mirrors.aliyun.com
ENV PIP_INDEX_URL=${PIP_INDEX_URL} \
    PIP_TRUSTED_HOST=${PIP_TRUSTED_HOST} \
    UV_INDEX_URL=${PIP_INDEX_URL}
COPY backend/ ./
COPY release-artifacts/ /app/release-artifacts/
RUN pip install uv && uv sync
CMD ["uv", "run", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
