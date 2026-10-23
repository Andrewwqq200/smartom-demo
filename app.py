import base64
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from fastapi.staticfiles import StaticFiles
from PIL import Image
import io
from pydantic import BaseModel

import database
from vision import barcode_reader_ready, decode_barcodes, dominant_color_name, render_barcode_image


class RecognizeRequest(BaseModel):
    image: str
    weight_grams: int = 0


class ProductIn(BaseModel):
    name: str
    category: str = ""
    color: str = ""
    size: str = ""
    material: str = ""
    weight_grams: int = 0
    barcode: str = ""
    price: float | None = None
    description: str = ""
    confidence: float = 0
    match_type: str = "manual"
    catalog_id: int | None = None
    image: str = ""


def _blank_card(weight_grams: int, color: str) -> dict:
    return {
        "name": "Новый товар",
        "category": "",
        "color": color,
        "size": "",
        "material": "",
        "weight_grams": weight_grams,
        "barcode": "",
        "price": None,
        "description": "",
        "catalog_id": None,
        "confidence": 0.35,
        "match_type": "none",
    }


def _card_from_catalog(item: dict, weight_grams: int, confidence: float, match_type: str, color: str) -> dict:
    return {
        "name": item["name"],
        "category": item["category"],
        "color": item["color"] or color,
        "size": item["size"],
        "material": item["material"],
        "weight_grams": weight_grams,
        "barcode": item["barcode"] or "",
        "price": item["price"],
        "description": item["description"],
        "catalog_id": item["id"],
        "confidence": confidence,
        "match_type": match_type,
    }


def _decode_image(payload: str) -> bytes:
    raw = payload.strip()
    if not raw:
        raise HTTPException(status_code=400, detail="Пустой снимок")
    if raw.startswith("data:") and "," in raw:
        raw = raw.split(",", 1)[1]
    try:
        decoded = base64.b64decode(raw, validate=False)
    except Exception as error:
        raise HTTPException(status_code=400, detail="Снимок не удалось прочитать") from error
    if not decoded:
        raise HTTPException(status_code=400, detail="Пустой снимок")
    if len(decoded) > 8_000_000:
        raise HTTPException(status_code=400, detail="Снимок больше 8 МБ")
    try:
        Image.open(io.BytesIO(decoded)).load()
    except Exception as error:
        raise HTTPException(status_code=400, detail="Файл не похож на изображение") from error
    return decoded


def _save_jpeg(image_bytes: bytes) -> str:
    name = f"{uuid.uuid4().hex}.jpg"
    image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    image.save(database.IMAGE_DIR / name, "JPEG", quality=85)
    return name


def _public_intake(row: dict) -> dict:
    item = dict(row)
    image_file = item.get("image_file") or ""
    item["image_url"] = f"/images/{image_file}" if image_file else ""
    return item


def _format_weight(grams: int) -> str:
    return f"{grams / 1000:.2f} кг".replace(".", ",")


def recognize_image(image_bytes: bytes, weight_grams: int) -> dict:
    color = dominant_color_name(image_bytes)
    barcodes = decode_barcodes(image_bytes) if barcode_reader_ready() else []
    barcode = barcodes[0] if barcodes else ""
    steps = [f"Вес с весов: {_format_weight(weight_grams)}" if weight_grams > 0 else "Вес с весов не пришёл"]
    steps.append(f"Цвет по снимку: {color}")

    if not barcode_reader_ready():
        steps.append("Модуль чтения штрихкода не установлен")
    elif barcode:
        steps.append(f"Штрихкод прочитан: {barcode}")
    else:
        steps.append("Штрихкод на снимке не найден")

    catalog_item = database.find_catalog_by_barcode(barcode) if barcode else None
    candidates: list[dict] = []

    if catalog_item:
        card = _card_from_catalog(catalog_item, weight_grams, 0.97, "barcode", color)
        steps.append("Такой товар уже есть в каталоге")
        if color != (catalog_item["color"] or ""):
            steps.append(f"В карточку записан цвет из каталога: {catalog_item['color']}")
        steps.append("Карточка заполнена из каталога")
        found = True
        match = "barcode"
    elif barcode:
        card = _blank_card(weight_grams, color)
        card["barcode"] = barcode
        card["confidence"] = 0.8
        card["match_type"] = "new_barcode"
        steps.append("Штрихкод новый: в каталоге такого товара нет")
        found = False
        match = "new_barcode"
    else:
        candidates = database.find_catalog_by_color(color)
        if len(candidates) == 1:
            card = _card_from_catalog(candidates[0], weight_grams, 0.58, "color", color)
            steps.append("В каталоге один товар такого цвета — проверьте, он ли это")
            found = False
            match = "color"
        elif len(candidates) > 1:
            card = _blank_card(weight_grams, color)
            card["confidence"] = 0.42
            card["match_type"] = "color"
            steps.append("Несколько товаров такого цвета. Выберите нужный или заполните карточку сами")
            found = False
            match = "color"
        else:
            card = _blank_card(weight_grams, color)
            steps.append("В каталоге совпадений нет. Заполните новую карточку")
            found = False
            match = "none"

    return {
        "found": found,
        "match": match,
        "detected_color": color,
        "barcode": barcode,
        "steps": steps,
        "card": card,
        "candidates": candidates,
    }


def _store_card(payload: ProductIn, image_bytes: bytes | None, match_type: str | None = None) -> dict:
    card = payload.model_dump()
    if match_type:
        card["match_type"] = match_type
    if not card["name"].strip() or card["name"].strip() == "Новый товар":
        raise HTTPException(status_code=400, detail="Укажите название товара")
    catalog_id = database.upsert_catalog(card)
    card["catalog_id"] = catalog_id
    image_file = _save_jpeg(image_bytes) if image_bytes else ""
    return database.add_intake(card, image_file)


@asynccontextmanager
async def lifespan(_: FastAPI):
    database.init_db()
    yield


database.init_db()

app = FastAPI(title="СмартОм", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)
app.mount("/images", StaticFiles(directory=database.IMAGE_DIR), name="images")


@app.get("/health")
def health():
    return {"ok": True, "barcode_reader": barcode_reader_ready()}


@app.get("/catalog")
def catalog():
    return database.list_catalog()


@app.get("/catalog/search")
def catalog_search(barcode: str = ""):
    item = database.find_catalog_by_barcode(barcode)
    return {"item": item}


@app.get("/catalog/{item_id}/barcode.png")
def catalog_barcode(item_id: int):
    item = database.get_catalog_item(item_id)
    if item is None or not item.get("barcode"):
        raise HTTPException(status_code=404, detail="Штрихкод не найден")
    return Response(content=render_barcode_image(item["barcode"]), media_type="image/png")


@app.get("/products")
def products():
    return [_public_intake(row) for row in database.list_intakes()]


@app.post("/recognize")
def recognize(data: RecognizeRequest):
    if data.weight_grams < 0 or data.weight_grams > 100_000:
        raise HTTPException(status_code=400, detail="Неправдоподобный вес")
    image_bytes = _decode_image(data.image)
    result = recognize_image(image_bytes, data.weight_grams)
    saved = None
    if result["match"] == "barcode":
        saved = database.add_intake(result["card"], _save_jpeg(image_bytes))
        result["steps"].append("Карточка автоматически передана в базу приёмки")
    result["saved"] = _public_intake(saved) if saved else None
    return result


@app.post("/products")
def create_product(data: ProductIn):
    image_bytes = _decode_image(data.image) if data.image else None
    saved = _store_card(data, image_bytes)
    return _public_intake(saved)


@app.put("/products/{intake_id}")
def edit_product(intake_id: int, data: ProductIn):
    if not data.name.strip() or data.name.strip() == "Новый товар":
        raise HTTPException(status_code=400, detail="Укажите название товара")
    card = data.model_dump()
    catalog_id = database.upsert_catalog(card)
    card["catalog_id"] = catalog_id
    image_file = None
    if data.image:
        image_file = _save_jpeg(_decode_image(data.image))
    updated = database.update_intake(intake_id, card, image_file)
    if updated is None:
        raise HTTPException(status_code=404, detail="Запись приёмки не найдена")
    return _public_intake(updated)
