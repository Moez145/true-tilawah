# True Tilawah: AI-Powered Quranic Recitation & Tajweed Assistant

> **True Tilawah** is an advanced, AI-driven mobile application and Intelligent Tutoring System (ITS) designed to assist individuals in learning, practicing, and improving their Quranic recitation and *Tajweed* in real-time.

---

## 🚀 Project Overview

Reciting the Holy Quran with correct phonetics and *Tajweed* rules is a foundational religious practice. However, traditional learning relies heavily on one-on-one instruction from qualified human tutors (*Qaris*), creating financial, geographic, and scheduling barriers. 

True Tilawah bridges this gap by functioning as a $24/7$ digital practice companion. It leverages state-of-the-art **Automatic Speech Recognition (ASR)** and **Natural Language Processing (NLP)** to listen to a user's recitation, compare it in real-time against the canonical Uthmani text corpus, detect errors (mispronunciations, omissions, extra words, and *Tajweed* violations), and provide immediate visual and audio corrections.

---

## 🛠️ System Architecture & Technology Stack

The system is engineered using a scalable, cloud-native three-tier architecture:

* **Mobile Frontend:** React Native (Expo) thick client handling UI rendering, audio capture, and live WebSocket communication.
* **Backend Core:** Node.js & Express.js managing REST APIs, JWT authentication, and bi-directional WebSocket streams.
* **AI Processing Layer:** Python (FastAPI/Uvicorn) hosting a fine-tuned OpenAI Whisper ASR model, RapidFuzz NLP alignment engine, and Tajweed verification logic.
* **Database & Storage:** MySQL (via Prisma ORM) for user metrics, session histories, and verified Uthmani script data.

---

## 📂 Project Repository Structure

```text
true-tilawah/
│
├── frontend/               # React Native mobile application
│   ├── src/                # UI components, screens, and navigation
│   └── .env.example        # Frontend environment variables template
│
├── backend/                # Node.js Express server & WebSocket gateway
│   ├── src/                # Controllers, routes, models, and sockets
│   ├── public/audio/       # Master Qari audio files (e.g., 001.mp3)
│   └── prisma/             # Database schema and seed scripts
│
├── ai-service/             # Python AI processing service
│   ├── app/                # FastAPI application and inference logic
│   ├── models/             # Local fine-tuned Whisper model files
│   └── requirements.txt    # Python dependencies
│
└── README.md               # Project documentation
```

---

## ⚙️ Local Installation & Setup Guide

### Prerequisites
Ensure you have the following installed on your development machine:
* **Node.js** (v18.x or higher)
* **Python** (v3.10 or v3.11)
* **MySQL** (v8.0 or higher)
* **Git** & **ffmpeg** (added to system PATH)

---

### Step 1: Clone the Repository
```bash
git clone https://github.com/WamiqRahim/True-Tilawah.git
cd True-Tilawah
```

---

### Step 2: Database Setup
Open your MySQL terminal and create the application database:
```sql
CREATE DATABASE true_tilawah CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
EXIT;
```

---

### Step 3: Backend Setup
Navigate to the `backend/` directory, install dependencies, and configure your environment:
```bash
cd backend
npm install
```

Create a `.env` file inside `backend/`:
```env
DATABASE_URL="mysql://root:YOUR_PASSWORD@localhost:3306/true_tilawah"
JWT_SECRET="your_secure_jwt_secret_key"
JWT_REFRESH_SECRET="your_secure_refresh_secret_key"
NODE_ENV="development"
PORT=5000
CORS_ORIGIN="*"
AI_SERVICE_HOST="localhost"
AI_SERVICE_PORT=8000
```

Initialize the Prisma schema and seed the Quran dataset (~6,236 Ayahs):
```bash
npx prisma db push
npm run seed:tajweed
npm run seed:quran
```

Start the backend development server:
```bash
npm run dev
```

---

### Step 4: AI Service Setup
Open a new terminal window, navigate to `ai-service/`, and install Python dependencies:
```bash
cd ai-service
pip install -r requirements.txt
pip install transformers accelerate safetensors pyarabic uvicorn
```

Create a `.env` file inside `ai-service/`:
```env
TRANSCRIPTION_PROVIDER="local_whisper"
WHISPER_MODEL="models/whisper-quran"
PORT=8000
```

Start the AI service:
```bash
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

---

### Step 5: Frontend Mobile App Setup
Open a third terminal window, navigate to `frontend/`, and install dependencies:
```bash
cd frontend
npm install
```

Find your local PC's IPv4 address (e.g., `192.168.1.5` via `ipconfig` or `ifconfig`). Create a `.env` file inside `frontend/`:
```env
EXPO_PUBLIC_API_BASE_URL="http://192.168.1.5:5000/api"
EXPO_PUBLIC_WS_AUDIO_URL="ws://192.168.1.5:5000/ws/audio"
```

Start the Expo development server:
```bash
npx expo start --clear
```
Scan the generated QR code using the **Expo Go** app on your mobile device (ensure your phone and PC are connected to the same Wi-Fi network).

---

## 📱 User Guide & Key Features

1. **Onboarding & Authentication:** Launch the app, grant microphone and storage permissions, and register/sign in securely.
2. **Quran Reading Mode:** Browse all 114 Surahs with original Uthmani typography, English/Urdu translations, and bookmarking tools.
3. **Interactive Recitation Practice:** Select a Surah and verse range, tap the microphone button, and recite aloud. 
4. **Real-Time Feedback:** 
   * **Visual Highlights:** Correctly spoken words turn **Green**; mistakes, omissions, or extra words turn **Red**.
   * **Automated Audio Correction:** The app pauses briefly on critical errors to play master audio corrections (recited by Sheikh Mishary Alafasy) before resuming your session.
5. **Progress Analytics:** View session summaries, accuracy percentage scores, daily streaks, and long-term error trends on your personal dashboard.

---

## 👥 Authors & Project Team

* **Wamiq Rahim** (Team Leader & Backend Architect) — `L1F22BSCS0006`
* **Moez Ahmad** (AI / ML / NLP Engineer) — `L1F22BSCS0010`
* **Saad Rafiq** (Frontend & Mobile UI Developer) — `L1F22BSCS0044`

* **Project Supervisor:** Mr. Hafiz Usama Ishtiaq  
* **Institution:** Faculty of Information Technology & Computer Science, University of Central Punjab (UCP), Lahore, Pakistan.

---

## 📄 License
This project was developed as a Bachelor of Science in Computer Science (BSCS) Final Year Project (FYP). All rights reserved.