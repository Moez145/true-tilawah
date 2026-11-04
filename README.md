True Tilawah: AI-Powered Quranic Recitation & Tajweed AssistantTrue Tilawah is an advanced, AI-driven mobile application and Intelligent Tutoring System (ITS) designed to assist individuals in learning, practicing, and improving their Quranic recitation and Tajweed in real-time.🚀 Project OverviewReciting the Holy Quran with correct phonetics and Tajweed rules is a foundational religious practice. However, traditional learning relies heavily on one-on-one instruction from qualified human tutors (Qaris), creating financial, geographic, and scheduling barriers.True Tilawah bridges this gap by functioning as a $24/7$ digital practice companion. It leverages state-of-the-art Automatic Speech Recognition (ASR) and Natural Language Processing (NLP) to listen to a user's recitation, compare it in real-time against the canonical Uthmani text corpus, detect errors (mispronunciations, omissions, extra words, and Tajweed violations), and provide immediate visual and audio corrections.🛠️ System Architecture & Technology StackThe system is engineered using a scalable, cloud-native three-tier architecture:Mobile Frontend: React Native (Expo) thick client handling UI rendering, audio capture, and live WebSocket communication.Backend Core: Node.js & Express.js managing REST APIs, JWT authentication, and bi-directional WebSocket streams.AI Processing Layer: Python (FastAPI/Uvicorn) hosting a fine-tuned OpenAI Whisper ASR model, RapidFuzz NLP alignment engine, and Tajweed verification logic.Database & Storage: MySQL (via Prisma ORM) for user metrics, session histories, and verified Uthmani script data.📂 Project Repository Structuretrue-tilawah/
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
⚙️ Local Installation & Setup GuidePrerequisitesEnsure you have the following installed on your development machine:Node.js (v18.x or higher)Python (v3.10 or v3.11)MySQL (v8.0 or higher)Git & ffmpeg (added to system PATH)Step 1: Clone the Repositorygit clone (https://github.com/Moez145/true-tilawah)
cd True-Tilawah
Step 2: Database SetupOpen your MySQL terminal and create the application database:CREATE DATABASE true_tilawah CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
EXIT;
Step 3: Backend SetupNavigate to the backend/ directory, install dependencies, and configure your environment:cd backend
npm install
Create a .env file inside backend/:DATABASE_URL="mysql://root:YOUR_PASSWORD@localhost:3306/true_tilawah"
JWT_SECRET="your_secure_jwt_secret_key"
JWT_REFRESH_SECRET="your_secure_refresh_secret_key"
NODE_ENV="development"
PORT=5000
CORS_ORIGIN="*"
AI_SERVICE_HOST="localhost"
AI_SERVICE_PORT=8000
Initialize the Prisma schema and seed the Quran dataset (~6,236 Ayahs):npx prisma db push
npm run seed:tajweed
npm run seed:quran
Start the backend development server:npm run dev
Step 4: AI Service SetupOpen a new terminal window, navigate to ai-service/, and install Python dependencies:cd ai-service
pip install -r requirements.txt
pip install transformers accelerate safetensors pyarabic uvicorn
Create a .env file inside ai-service/:TRANSCRIPTION_PROVIDER="local_whisper"
WHISPER_MODEL="models/whisper-quran"
PORT=8000
Start the AI service:uvicorn app.main:app --host 0.0.0.0 --port 8000
Step 5: Frontend Mobile App SetupOpen a third terminal window, navigate to frontend/, and install dependencies:cd frontend
npm install
Find your local PC's IPv4 address (e.g., 192.168.1.5 via ipconfig or ifconfig). Create a .env file inside frontend/:EXPO_PUBLIC_API_BASE_URL="http://192.168.1.5:5000/api"
EXPO_PUBLIC_WS_AUDIO_URL="ws://192.168.1.5:5000/ws/audio"
Start the Expo development server:npx expo start --clear
Scan the generated QR code using the Expo Go app on your mobile device (ensure your phone and PC are connected to the same Wi-Fi network).📱 User Guide & Key FeaturesOnboarding & Authentication: Launch the app, grant microphone and storage permissions, and register/sign in securely.Quran Reading Mode: Browse all 114 Surahs with original Uthmani typography, English/Urdu translations, and bookmarking tools.Interactive Recitation Practice: Select a Surah and verse range, tap the microphone button, and recite aloud.Real-Time Feedback:Visual Highlights: Correctly spoken words turn Green; mistakes, omissions, or extra words turn Red.Automated Audio Correction: The app pauses briefly on critical errors to play master audio corrections (recited by Sheikh Mishary Alafasy) before resuming your session.Progress Analytics: View session summaries, accuracy percentage scores, daily streaks, and long-term error trends on your personal dashboard.👥 Authors & Project TeamWamiq Rahim (Team Leader & Backend Architect) — L1F22BSCS0006Moez Ahmad (AI / ML / NLP Engineer) — L1F22BSCS0010Saad Rafiq (Frontend & Mobile UI Developer) — L1F22BSCS0044Project Supervisor: Mr. Hafiz Usama IshtiaqInstitution: Faculty of Information Technology & Computer Science, University of Central Punjab (UCP), Lahore, Pakistan.📄 LicenseThis project was developed as a Bachelor of Science in Computer Science (BSCS) Final Year Project (FYP). All rights reserved.
