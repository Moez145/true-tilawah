# True Tilawah VAD API — Integration Guide

## How it works

```
Your app sends audio
       ↓
  ffmpeg decodes to 16kHz PCM
       ↓
  Silero VAD splits speech from silence
  [████speech████]  [silence]  [████speech████]
       ↓                              ↓
  Whisper transcribes each segment
  "بسم الله الرحمن الرحيم"     "الحمد لله رب العالمين"
       ↓
  Segments joined → verse detection via RapidFuzz
       ↓
  Word-by-word comparison + Tajweed errors
       ↓
  JSON report for every verse recited
```

---

## Run

```bash
pip install -r requirements.txt
apt-get install -y ffmpeg
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

---

## Endpoints

| Method | Path | Use case |
|--------|------|----------|
| GET | `/health` | Check if ready |
| GET | `/surahs` | List all surahs |
| GET | `/verse/1/1` | Get a specific verse |
| POST | `/evaluate` | **Upload audio → full report** |
| POST | `/evaluate/stream` | Send raw PCM bytes directly |
| WS | `/ws/evaluate` | Real-time streaming |

---

## POST /evaluate — main endpoint

### React Native example
```javascript
import AudioRecorderPlayer from 'react-native-audio-recorder-player';

const recorder = new AudioRecorderPlayer();
const BASE_URL = 'http://your-server:8000';

async function recordAndEvaluate() {
  // Start recording
  const path = await recorder.startRecorder();

  // Stop after user finishes reciting (e.g. button press)
  await recorder.stopRecorder();

  // Send to API
  const formData = new FormData();
  formData.append('file', {
    uri:  path,
    type: 'audio/mp4',
    name: 'recitation.m4a',
  });

  const res = await fetch(`${BASE_URL}/evaluate`, {
    method: 'POST',
    body:   formData,
  });

  const result = await res.json();
  /*
  result = {
    success: true,
    transcript: "بسم الله الرحمن الرحيم الحمد لله...",
    vad_segments: 3,          // how many speech utterances VAD found
    total_verses: 7,
    correct_verses: 6,
    average_similarity: 0.87,
    grade: "Good",
    verses: [
      {
        surah: 1, ayah: 1,
        surah_name: "Al-Fatihah",
        correct_verse: "بِسۡمِ ٱللَّهِ ٱلرَّحۡمَـٰنِ ٱلرَّحِيمِ",
        you_recited: "بسم الله الرحمن الرحيم",
        similarity: 0.95,
        verdict: "correct",
        correct_words: 4, missing_words: 0, extra_words_count: 0,
        word_diff: [
          { status: "correct", word: "بسم" },
          { status: "correct", word: "الله" },
          { status: "correct", word: "الرحمن" },
          { status: "correct", word: "الرحيم" }
        ],
        tajweed_errors: [],
        audio_url: "https://everyayah.com/data/Alafasy_128kbps/001001.mp3"
      },
      ...more verses
    ]
  }
  */

  return result;
}
```

### Flutter example
```dart
import 'package:http/http.dart' as http;
import 'package:path/path.dart';

Future<Map<String, dynamic>> evaluateRecitation(String audioPath) async {
  final url = Uri.parse('http://your-server:8000/evaluate');
  final request = http.MultipartRequest('POST', url);

  request.files.add(await http.MultipartFile.fromPath(
    'file',
    audioPath,
    filename: basename(audioPath),
  ));

  final response = await request.send();
  final body = await response.stream.bytesToString();
  return jsonDecode(body);
}
```

---

## WebSocket /ws/evaluate — real-time streaming

```javascript
// For apps that want live feedback as user recites
const ws = new WebSocket('ws://your-server:8000/ws/evaluate');

ws.onopen = () => {
  console.log('Connected — start sending audio chunks');
};

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);

  if (msg.type === 'verse_detected') {
    // A verse was just detected and evaluated in real-time
    console.log(`Verse: ${msg.verses[0]?.surah_name} ${msg.verses[0]?.ayah}`);
    console.log(`Verdict: ${msg.verses[0]?.verdict}`);
  }

  if (msg.type === 'final_report') {
    // Full report when user sends "STOP"
    console.log('Final grade:', msg.grade);
    console.log('All verses:', msg.verses);
  }
};

// Send audio chunks (float32 PCM at 16kHz mono)
function sendAudioChunk(float32Array) {
  ws.send(float32Array.buffer);
}

// Finalise
function stopRecording() {
  ws.send('STOP');
}
```

---

## Response fields explained

```
verdict:
  "correct"         → similarity >= 75%  ✅
  "words_missing"   → you skipped words  ⚠️
  "extra_words"     → you added words    ⚠️
  "mispronunciation"→ wrong pronunciation ❌

word_diff[].status:
  "correct"  → word matched exactly
  "missing"  → word in Quran but not in your recitation
  "extra"    → word in your recitation but not in Quran

tajweed_errors[]:
  rule:     "Qalqala" | "Madd" | "Ghunna"
  severity: "high" | "medium" | "low"
  tip:      Human-readable correction guidance

grade:
  "Excellent"                  → avg similarity >= 90%
  "Good"                       → avg >= 75%
  "Needs Practice"             → avg >= 55%
  "Needs Significant Practice" → avg < 55%

vad_segments:
  Number of distinct speech utterances VAD detected.
  Higher = more pauses between verses (normal for recitation).
```

---

## VAD tuning (in main.py)

```python
SILENCE_THRESHOLD = 1.0   # seconds of silence to end an utterance
                           # increase if VAD cuts off too early
                           # decrease if it merges separate verses

MIN_SPEECH_SECS   = 0.5   # ignore utterances shorter than this
                           # increase to filter out short noise/coughs
```
