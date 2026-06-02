FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg git curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt requirements-local-whisper.txt ./
RUN pip install --no-cache-dir -r requirements.txt -r requirements-local-whisper.txt

COPY . .

RUN python -m scripts.convert_tarteel_model
RUN python -m scripts.build_word_timing_index

ENV PORT=8000 \
    STREAM_CHUNK_SEC=0.5 \
    STREAM_WINDOW_SEC=4.0 \
    STREAM_LOCK_IN_RUNS=2 \
    VAD_SILENCE_THRESHOLD_SEC=0.7 \
    PENDING_CORRECTION_TIMEOUT_SEC=2.0 \
    TRANSCRIPTION_PROVIDER=tarteel

EXPOSE 8000

CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
