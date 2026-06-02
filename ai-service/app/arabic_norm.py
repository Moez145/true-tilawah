"""Arabic text normalisation for matching ASR output against canonical Quranic text."""
import re

import pyarabic.araby as araby

# Characters mapped to a canonical form (or removed)
_TATWEEL = "ـ"
_HAMZA_WASL = "ٱ"
_ALEF_VARIANTS = "أإآٱ"   # أ إ آ ٱ -> ا
_YA_VARIANTS = "ى"                       # ى -> ي
_TA_MARBUTA = "ة"                        # ة -> ه

_RE_NON_ARABIC = re.compile(r"[^؀-ۿ\s]+")


def strip_diacritics(text: str) -> str:
    """Remove all tashkeel/diacritics (incl. superscript/dagger alef U+0670); keep base letters."""
    return araby.strip_diacritics(text)


def canonical(text: str) -> str:
    """Normalise for matching: strip tashkeel, unify Alef/Ya, drop tatweel, lower-case Latin."""
    if not text:
        return ""
    s = strip_diacritics(text)
    s = s.replace(_TATWEEL, "")
    # Normalise Alef / Hamza-Wasl variants
    for ch in _ALEF_VARIANTS:
        s = s.replace(ch, "ا")
    # Normalise Alef Maksura -> Ya
    s = s.replace(_YA_VARIANTS, "ي")
    # Normalise Ta Marbuta -> Ha (a common ASR ambiguity)
    s = s.replace(_TA_MARBUTA, "ه")
    s = s.lower().strip()
    return s
