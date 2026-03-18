FROM python:3.11-slim AS base

WORKDIR /app

# System deps + Blender 4.2 headless
# libgl1-mesa-glx → libgl1 / libegl1-mesa → libegl1 on Debian Trixie+
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl xz-utils libxi6 libxxf86vm1 libxfixes3 libxrender1 \
    libgl1 libglib2.0-0 libegl1 libxkbcommon0 \
    libsm6 libice6 libx11-6 libxext6 && \
    curl -L https://mirror.clarkson.edu/blender/release/Blender4.2/blender-4.2.0-linux-x64.tar.xz \
    | tar xJ -C /opt/ && \
    ln -s /opt/blender-4.2.0-linux-x64/blender /usr/local/bin/blender && \
    rm -rf /var/lib/apt/lists/*

# Software rendering (no GPU required)
ENV LIBGL_ALWAYS_SOFTWARE=1

# Python deps
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# App code
COPY . .

# Non-root user
RUN useradd -m -r appuser && chown -R appuser:appuser /app
USER appuser

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

ENV PORT=8000
CMD ["sh", "-c", "uvicorn api.main:app --host 0.0.0.0 --port ${PORT} --workers 2"]
