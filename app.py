from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)

class ImageData(BaseModel):
    image: str

@app.post("/recognize")
async def recognize(data: ImageData):
    return {
        "name": "Куртка зимняя мужская",
        "weight": "1.2 кг",
        "color": "чёрный",
        "material": "полиэстер",
        "barcode": "1234567890123",
        "confidence": 0.95
    }