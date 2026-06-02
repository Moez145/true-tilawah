from fastapi import FastAPI, WebSocket, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from app.lifespan import lifespan, STATE
from app.ws_handler import handle_ws_evaluate

app = FastAPI(title="True Tilawah AI", version="4.0.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.get("/health")
def health():
    return {
        "status": "ready" if STATE["ready"] else "loading",
        "verses_loaded": sum(len(v) for v in (STATE["quran"] or {}).values()),
    }


@app.websocket("/ws/evaluate")
async def ws_evaluate(ws: WebSocket):
    await handle_ws_evaluate(ws)


if __name__ == "__main__":
    import os
    import uvicorn
    uvicorn.run("app.main:app", host="0.0.0.0", port=int(os.getenv("PORT", "8000")))
