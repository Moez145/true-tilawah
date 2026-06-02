"""Quran loader, normaliser, and inverted index builder.

Pure functions — no module-level mutable state. Callers pass `quran` dicts
explicitly to `build_index`, and the loader returns a fresh dict each call.
"""
import re
from collections import defaultdict

import requests


# ─────────────────────────────────────────────────────────────────
# Surah names lookup (verbatim from legacy lines 50-76)
# ─────────────────────────────────────────────────────────────────
SURAH_NAMES: dict[int, str] = {
    1:"Al-Fatihah",2:"Al-Baqarah",3:"Al-Imran",4:"An-Nisa",5:"Al-Maidah",
    6:"Al-Anam",7:"Al-Araf",8:"Al-Anfal",9:"At-Tawbah",10:"Yunus",
    11:"Hud",12:"Yusuf",13:"Ar-Rad",14:"Ibrahim",15:"Al-Hijr",16:"An-Nahl",
    17:"Al-Isra",18:"Al-Kahf",19:"Maryam",20:"Ta-Ha",21:"Al-Anbiya",
    22:"Al-Hajj",23:"Al-Muminun",24:"An-Nur",25:"Al-Furqan",26:"Ash-Shuara",
    27:"An-Naml",28:"Al-Qasas",29:"Al-Ankabut",30:"Ar-Rum",31:"Luqman",
    32:"As-Sajdah",33:"Al-Ahzab",34:"Saba",35:"Fatir",36:"Ya-Sin",
    37:"As-Saffat",38:"Sad",39:"Az-Zumar",40:"Ghafir",41:"Fussilat",
    42:"Ash-Shura",43:"Az-Zukhruf",44:"Ad-Dukhan",45:"Al-Jathiya",
    46:"Al-Ahqaf",47:"Muhammad",48:"Al-Fath",49:"Al-Hujurat",50:"Qaf",
    51:"Adh-Dhariyat",52:"At-Tur",53:"An-Najm",54:"Al-Qamar",55:"Ar-Rahman",
    56:"Al-Waqia",57:"Al-Hadid",58:"Al-Mujadila",59:"Al-Hashr",
    60:"Al-Mumtahina",61:"As-Saf",62:"Al-Jumua",63:"Al-Munafiqun",
    64:"At-Taghabun",65:"At-Talaq",66:"At-Tahrim",67:"Al-Mulk",68:"Al-Qalam",
    69:"Al-Haqqah",70:"Al-Maarij",71:"Nuh",72:"Al-Jinn",73:"Al-Muzzammil",
    74:"Al-Muddathir",75:"Al-Qiyamah",76:"Al-Insan",77:"Al-Mursalat",
    78:"An-Naba",79:"An-Naziat",80:"Abasa",81:"At-Takwir",82:"Al-Infitar",
    83:"Al-Mutaffifin",84:"Al-Inshiqaq",85:"Al-Buruj",86:"At-Tariq",
    87:"Al-Ala",88:"Al-Ghashiyah",89:"Al-Fajr",90:"Al-Balad",91:"Ash-Shams",
    92:"Al-Lail",93:"Ad-Duha",94:"Ash-Sharh",95:"At-Tin",96:"Al-Alaq",
    97:"Al-Qadr",98:"Al-Bayyina",99:"Az-Zalzalah",100:"Al-Adiyat",
    101:"Al-Qariah",102:"At-Takathur",103:"Al-Asr",104:"Al-Humazah",
    105:"Al-Fil",106:"Quraysh",107:"Al-Maun",108:"Al-Kawthar",
    109:"Al-Kafirun",110:"An-Nasr",111:"Al-Masad",112:"Al-Ikhlas",
    113:"Al-Falaq",114:"An-Nas",
}


# ─────────────────────────────────────────────────────────────────
# Arabic normalisation (verbatim from legacy lines 131-147)
# ─────────────────────────────────────────────────────────────────
_DIAC = re.compile(
    r"[؀-؅ؐ-ًؚ-ٟ"
    r"ٰۖ-ۜ۟-۪ۤۧۨ-ۭ"
    r"ࣔ-ࣣ࣡-ࣿ]"
)


def normalize(text: str) -> str:
    t = _DIAC.sub("", text)
    t = re.sub(r"[۠ۥۦ۝۞ٕؗٔ]", "", t)
    t = re.sub(r"[آأإٱٲٳٵٰ]", "ا", t)
    t = re.sub(r"ة", "ه", t)
    t = re.sub(r"ى", "ي", t)
    t = re.sub(r"[ﻻﻼﻷﻸﻵﻶ]", "لا", t)
    t = re.sub(r"ـ", "", t)
    t = re.sub(r"[ۖ-ۤۧ-ۭ]", "", t)
    t = re.sub(r"[ؤئ]", "ء", t)
    return re.sub(r"\s+", " ", t).strip()


# ─────────────────────────────────────────────────────────────────
# Quran loader (verbatim from legacy lines 153-195)
# ─────────────────────────────────────────────────────────────────
def load_quran() -> dict[int, dict[int, str]]:
    """Returns {surah: {ayah: text}}. Tries HuggingFace, then CDN, then embedded fallback."""
    qt: dict = {}
    try:
        from datasets import load_dataset
        ds = load_dataset("nazimali/quran", split="train", trust_remote_code=True)
        for row in ds:
            s, a = int(row["surah"]), int(row["ayah"])
            t = row.get("arabic-text-uthmani") or row.get("arabic-text-simple", "")
            qt.setdefault(s, {})[a] = t
        print(f"   HuggingFace: {sum(len(v) for v in qt.values())} verses")
    except Exception as e:
        print(f"   HuggingFace failed: {e}")

    if not qt:
        try:
            r = requests.get(
                "https://cdn.jsdelivr.net/npm/quran-json@3.1.2/dist/quran.json",
                timeout=30,
            )
            for surah in r.json():
                sn = surah["id"]
                qt[sn] = {v["id"]: v["text"] for v in surah["verses"]}
            print(f"   CDN: {sum(len(v) for v in qt.values())} verses")
        except Exception as e:
            print(f"   CDN failed: {e}")

    if not qt:
        # Minimal embedded fallback
        qt = {
            1:  {1:"بِسۡمِ ٱللَّهِ ٱلرَّحۡمَـٰنِ ٱلرَّحِيمِ",2:"ٱلۡحَمۡدُ لِلَّهِ رَبِّ ٱلۡعَـٰلَمِينَ",
                 3:"ٱلرَّحۡمَـٰنِ ٱلرَّحِيمِ",4:"مَـٰلِكِ يَوۡمِ ٱلدِّينِ",
                 5:"إِيَّاكَ نَعۡبُدُ وَإِيَّاكَ نَسۡتَعِينُ",6:"ٱهۡدِنَا ٱلصِّرَٰطَ ٱلۡمُسۡتَقِيمَ",
                 7:"صِرَٰطَ ٱلَّذِينَ أَنۡعَمۡتَ عَلَيۡهِمۡ غَيۡرِ ٱلۡمَغۡضُوبِ عَلَيۡهِمۡ وَلَا ٱلضَّآلِّينَ"},
            112:{1:"قُلۡ هُوَ ٱللَّهُ أَحَدٌ",2:"ٱللَّهُ ٱلصَّمَدُ",
                 3:"لَمۡ يَلِدۡ وَلَمۡ يُولَدۡ",4:"وَلَمۡ يَكُن لَّهُۥ كُفُوًا أَحَدُۢ"},
            113:{1:"قُلۡ أَعُوذُ بِرَبِّ ٱلۡفَلَقِ",2:"مِن شَرِّ مَا خَلَقَ",
                 3:"وَمِن شَرِّ غَاسِقٍ إِذَا وَقَبَ",4:"وَمِن شَرِّ ٱلنَّفَّـٰثَـٰتِ فِي ٱلۡعُقَدِ",
                 5:"وَمِن شَرِّ حَاسِدٍ إِذَا حَسَدَ"},
            114:{1:"قُلۡ أَعُوذُ بِرَبِّ ٱلنَّاسِ",2:"مَلِكِ ٱلنَّاسِ",3:"إِلَـٰهِ ٱلنَّاسِ",
                 4:"مِن شَرِّ ٱلۡوَسۡوَاسِ ٱلۡخَنَّاسِ",5:"ٱلَّذِي يُوَسۡوِسُ فِي صُدُورِ ٱلنَّاسِ",
                 6:"مِنَ ٱلۡجِنَّةِ وَٱلنَّاسِ"},
        }
    return qt


# ─────────────────────────────────────────────────────────────────
# Inverted index builder (verbatim from legacy lines 198-209)
# ─────────────────────────────────────────────────────────────────
def build_index(quran: dict[int, dict[int, str]]) -> tuple[list, dict[str, set[int]]]:
    """
    Build verse_index and inverted index from a quran dict.

    Returns:
      - verse_index: list of (surah, ayah, original_text, norm_text, norm_words)
      - inverted: dict mapping norm_word → set of indices into verse_index
    """
    vn = []
    inv = defaultdict(set)
    for sn in sorted(quran):
        for an in sorted(quran[sn]):
            text = quran[sn][an]
            n = normalize(text)
            ws = n.split()
            vn.append((sn, an, text, n, ws))
            for w in ws:
                inv[w].add(len(vn) - 1)
    return vn, dict(inv)
