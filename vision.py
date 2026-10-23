import io
from PIL import Image, ImageDraw, ImageFont, ImageOps

try:
    import zxingcpp
except ImportError:  # pragma: no cover - зависит от окружения
    zxingcpp = None

# Коды EAN-13: https://en.wikipedia.org/wiki/International_Article_Number
_L = {
    "0": "0001101",
    "1": "0011001",
    "2": "0010011",
    "3": "0111101",
    "4": "0100011",
    "5": "0110001",
    "6": "0101111",
    "7": "0111011",
    "8": "0110111",
    "9": "0001011",
}
_G = {
    "0": "0100111",
    "1": "0110011",
    "2": "0011011",
    "3": "0100001",
    "4": "0011101",
    "5": "0111001",
    "6": "0000101",
    "7": "0010001",
    "8": "0001001",
    "9": "0010111",
}
_R = {
    "0": "1110010",
    "1": "1100110",
    "2": "1101100",
    "3": "1000010",
    "4": "1011100",
    "5": "1001110",
    "6": "1010000",
    "7": "1000100",
    "8": "1001000",
    "9": "1110100",
}
_PARITY = {
    "0": "LLLLLL",
    "1": "LLGLGG",
    "2": "LLGGLG",
    "3": "LLGGGL",
    "4": "LGLLGG",
    "5": "LGGLLG",
    "6": "LGGGLL",
    "7": "LGLGLG",
    "8": "LGLGGL",
    "9": "LGGLGL",
}

_NAMED_COLORS = [
    ("чёрный", (25, 25, 25)),
    ("белый", (245, 245, 245)),
    ("серый", (140, 140, 140)),
    ("красный", (190, 40, 40)),
    ("синий", (35, 70, 170)),
    ("голубой", (90, 175, 220)),
    ("зелёный", (40, 140, 70)),
    ("жёлтый", (230, 200, 50)),
    ("оранжевый", (220, 120, 40)),
    ("коричневый", (120, 75, 40)),
    ("бежевый", (210, 185, 155)),
    ("розовый", (220, 140, 170)),
    ("фиолетовый", (120, 60, 160)),
]


def ean13_check_digit(first_twelve: str) -> str:
    if len(first_twelve) != 12 or not first_twelve.isdigit():
        raise ValueError("Для контрольной цифры нужны 12 цифр")
    total = 0
    for index, char in enumerate(first_twelve):
        number = int(char)
        total += number if index % 2 == 0 else number * 3
    return str((10 - (total % 10)) % 10)


def ean13_with_check(first_twelve: str) -> str:
    return first_twelve + ean13_check_digit(first_twelve)


def _ean13_bits(code: str) -> str:
    if len(code) != 13 or not code.isdigit():
        raise ValueError("Штрихкод EAN-13 должен состоять из 13 цифр")
    expected = ean13_check_digit(code[:12])
    if code[-1] != expected:
        raise ValueError("Неверная контрольная цифра штрихкода")
    bits = "101"
    parity = _PARITY[code[0]]
    for index, pattern in enumerate(parity):
        digit = code[index + 1]
        bits += _L[digit] if pattern == "L" else _G[digit]
    bits += "01010"
    for digit in code[7:]:
        bits += _R[digit]
    bits += "101"
    return bits


def render_barcode_image(code: str) -> bytes:
    digits = "".join(char for char in code if char.isdigit())
    if len(digits) == 13:
        try:
            return render_ean13(digits)
        except ValueError:
            pass
    image = Image.new("RGB", (360, 120), "white")
    draw = ImageDraw.Draw(image)
    draw.text((16, 50), code or "без кода", fill="black", font=ImageFont.load_default())
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def render_ean13(code: str) -> bytes:
    bits = _ean13_bits(code)
    module = 3
    quiet = 12
    bar_height = 130
    width = (len(bits) + quiet * 2) * module
    height = bar_height + 48
    image = Image.new("RGB", (width, height), "white")
    draw = ImageDraw.Draw(image)
    x = quiet * module
    for bit in bits:
        if bit == "1":
            draw.rectangle((x, 8, x + module - 1, 8 + bar_height), fill="black")
        x += module
    font = ImageFont.load_default()
    draw.text((width / 2, bar_height + 16), code, fill="black", font=font, anchor="mt")
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def _nearest_color(red: int, green: int, blue: int) -> str:
    best_name = "серый"
    best_distance = 10**9
    for name, (nr, ng, nb) in _NAMED_COLORS:
        distance = (red - nr) ** 2 + (green - ng) ** 2 + (blue - nb) ** 2
        if distance < best_distance:
            best_name = name
            best_distance = distance
    return best_name


def dominant_color_name(image_bytes: bytes) -> str:
    image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    width, height = image.size
    image = image.crop(
        (int(width * 0.2), int(height * 0.2), int(width * 0.8), int(height * 0.8))
    )
    image = image.resize((48, 48))
    pixels = list(image.getdata())
    vivid = [pixel for pixel in pixels if not (pixel[0] > 242 and pixel[1] > 242 and pixel[2] > 242)]
    sample = vivid or pixels
    count = len(sample)
    red = sum(pixel[0] for pixel in sample) // count
    green = sum(pixel[1] for pixel in sample) // count
    blue = sum(pixel[2] for pixel in sample) // count
    return _nearest_color(red, green, blue)


def _read_codes(image: Image.Image) -> list[str]:
    if zxingcpp is None:
        return []
    found: list[str] = []
    for result in zxingcpp.read_barcodes(image):
        text = (result.text or "").strip()
        if text and text not in found:
            found.append(text)
    return found


def decode_barcodes(image_bytes: bytes) -> list[str]:
    image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    found = _read_codes(image)
    if found:
        return found
    # Повтор на выровненном контрасте помогает, когда код снят с экрана.
    boosted = ImageOps.autocontrast(image.convert("L")).convert("RGB")
    return _read_codes(boosted)


def barcode_reader_ready() -> bool:
    return zxingcpp is not None
