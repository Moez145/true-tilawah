from app.quran_index import load_quran
import json

print("Downloading/loading Quran data (this uses your existing load_quran logic)...")
quran = load_quran()

total = sum(len(v) for v in quran.values())
print(f"Loaded {len(quran)} surahs, {total} verses total.")

with open("quran_data.json", "w", encoding="utf-8") as f:
    json.dump(quran, f, ensure_ascii=False)

print("Saved to quran_data.json")
