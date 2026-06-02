import numpy as np
import torch

from .base import TranscriptionProvider, TranscriptionResult
from app.config import WHISPER_MODEL


class LocalWhisperProvider(TranscriptionProvider):
    def __init__(self, model_name: str = WHISPER_MODEL):
        from transformers import WhisperProcessor, WhisperForConditionalGeneration

        self._device = "cpu"
        print(f"[LocalWhisper] Loading whisper-quran from: {model_name}")
        print(f"[LocalWhisper] Device: {self._device}")

        self._processor = WhisperProcessor.from_pretrained(model_name)
        self._model = WhisperForConditionalGeneration.from_pretrained(
        model_name,
        dtype=torch.float32,
        )
        self._model.to(self._device)
        self._model.eval()

        self._forced_decoder_ids = self._model.generation_config.forced_decoder_ids
        print(f"[LocalWhisper] whisper-quran loaded successfully ✓")

    async def transcribe(self, pcm_float32: np.ndarray, language: str = "ar", initial_prompt: str = None) -> TranscriptionResult:
        try:
            inputs = self._processor(
                pcm_float32,
                sampling_rate=16000,
                return_tensors="pt",
            ).input_features.to(self._device)

            with torch.no_grad():
                predicted_ids = self._model.generate(
                inputs,
                forced_decoder_ids=self._forced_decoder_ids,
                max_new_tokens=80,
                num_beams=3,
                temperature=1.0,
                no_repeat_ngram_size=3,
                repetition_penalty=1.3,
            )

            text = self._processor.batch_decode(
                predicted_ids,
                skip_special_tokens=True,
            )[0].strip()

            print(f"[LocalWhisper] Transcribed: {text}")
            return TranscriptionResult(text=text, confidence=None, raw={"text": text})

        except Exception as e:
            print(f"[LocalWhisper] ERROR: {e}")
            return TranscriptionResult(text="", confidence=None, raw={"error": str(e)})