"""Regression tests for Kokoro's text and prosody preparation."""

from __future__ import annotations

import importlib.util
import unicodedata
import unittest
from pathlib import Path


DAEMON = Path(__file__).with_name("kokoro-daemon.py")
SPEC = importlib.util.spec_from_file_location("kokoro_daemon", DAEMON)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("could not load kokoro daemon")
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class KokoroTextPreparationTests(unittest.TestCase):
    def test_removes_visual_markup_but_keeps_sentence_prosody(self) -> None:
        prepared = MODULE.spoken_text(
            "## **Hola**, ¿cómo estás? ¡Qué alegría! Esto es increíble…"
        )
        self.assertEqual(prepared, "Hola, cómo estás? Qué alegría! Esto es increíble…")

    def test_removes_standalone_accent_marks_without_deaccenting_letters(self) -> None:
        prepared = MODULE.spoken_text("La palabra está aquí. C´omo estás?")
        self.assertEqual(prepared, "La palabra está aquí. Como estás?")

    def test_drops_code_and_urls(self) -> None:
        prepared = MODULE.spoken_text(
            "Consulta [la guía](https://example.com), no `npm run test`."
        )
        self.assertEqual(prepared, "Consulta la guía, no npm run test.")

    def test_normalizes_decomposed_diacritics(self) -> None:
        decomposed = unicodedata.normalize("NFD", "La canción está aquí.")
        self.assertEqual(MODULE.spoken_text(decomposed), "La canción está aquí.")

    def test_preserves_currency_math_and_negative_numbers(self) -> None:
        text = "El saldo es -$12.50; x = -2."
        self.assertEqual(MODULE.spoken_text(text), text)


class KokoroGenerationBoundaryTests(unittest.TestCase):
    def test_generate_sends_prepared_nfc_text_to_phonemizer(self) -> None:
        class Samples:
            size = 1

        class FakePhonemizer:
            received: str | None = None

            def __call__(self, text: str) -> tuple[str, None]:
                self.received = text
                return "prepared phonemes", None

        class FakeModel:
            received: tuple[object, dict[str, object]] | None = None

            def create(self, phonemes: object, **kwargs: object) -> tuple[Samples, int]:
                self.received = (phonemes, kwargs)
                return Samples(), 24_000

        previous_model = MODULE.model
        previous_phonemizers = MODULE.phonemizers
        phonemizer = FakePhonemizer()
        model = FakeModel()
        MODULE.model = model
        MODULE.phonemizers = {"es": phonemizer}
        try:
            decomposed = unicodedata.normalize("NFD", "Está bien, ¿sí? ¡Claro!")
            MODULE.generate(decomposed, "es-DO", "feminine", "conversational")
        finally:
            MODULE.model = previous_model
            MODULE.phonemizers = previous_phonemizers
        self.assertEqual(phonemizer.received, "Está bien, sí? Claro!")
        self.assertIsNotNone(model.received)
        assert model.received is not None
        self.assertEqual(model.received[0], "prepared phonemes")
        self.assertTrue(model.received[1]["is_phonemes"])


if __name__ == "__main__":
    unittest.main()
