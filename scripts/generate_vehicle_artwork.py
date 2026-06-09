from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public" / "vehicles"

CARS = [
    ("vw-id3-pro-2023", "Volkswagen ID.3", "#0f8f72", "#f0b429"),
    ("bmw-i4-edrive40-2022", "BMW i4", "#1f6feb", "#c7e2ff"),
    ("mercedes-eqa-250-2024", "Mercedes EQA", "#4b5563", "#d1d5db"),
    ("audi-q4-40-2023", "Audi Q4", "#7c3f58", "#f2c6d6"),
    ("tesla-model-3-rwd-2024", "Tesla Model 3", "#df675c", "#ffe0d2"),
    ("kia-ev6-air-2022", "Kia EV6", "#0b7285", "#c5f6fa"),
    ("hyundai-ioniq5-2023", "Hyundai Ioniq 5", "#2f9e44", "#d8f5a2"),
    ("mg4-luxury-2024", "MG4", "#7048e8", "#e5dbff"),
    ("byd-atto3-design-2024", "BYD Atto 3", "#d9480f", "#ffe8cc"),
    ("xpeng-g6-rwd-2024", "XPeng G6", "#087f5b", "#c3fae8"),
    ("nio-et5-touring-2024", "NIO ET5", "#364fc7", "#dbe4ff"),
    ("polestar-2-longrange-2023", "Polestar 2", "#343a40", "#f1f3f5"),
    ("renault-megane-etech-2023", "Renault Megane", "#fab005", "#fff3bf"),
    ("skoda-enyaq-85-2024", "Skoda Enyaq", "#2b8a3e", "#d3f9d8"),
    ("volvo-ex30-extended-2024", "Volvo EX30", "#1864ab", "#d0ebff"),
    ("fiat-500e-icon-2022", "Fiat 500e", "#c92a2a", "#ffe3e3"),
]


def hex_to_rgb(value: str) -> tuple[int, int, int]:
    value = value.lstrip("#")
    return tuple(int(value[i : i + 2], 16) for i in (0, 2, 4))


def blend(a: tuple[int, int, int], b: tuple[int, int, int], t: float) -> tuple[int, int, int]:
    return tuple(round(a[i] * (1 - t) + b[i] * t) for i in range(3))


def font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for candidate in [
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
        "/System/Library/Fonts/Supplemental/Arial.ttf",
    ]:
        try:
            return ImageFont.truetype(candidate, size=size)
        except OSError:
            pass
    return ImageFont.load_default()


def draw_car(draw: ImageDraw.ImageDraw, accent: str, soft: str) -> None:
    accent_rgb = hex_to_rgb(accent)
    soft_rgb = hex_to_rgb(soft)
    ink = (24, 32, 29)
    car_body = [
        (178, 461),
        (178, 442),
        (192, 417),
        (247, 392),
        (262, 392),
        (297, 312),
        (430, 271),
        (697, 271),
        (840, 316),
        (875, 392),
        (947, 392),
        (1002, 417),
        (1016, 442),
        (1016, 482),
        (178, 482),
    ]
    draw.polygon(car_body, fill=accent_rgb)
    draw.rounded_rectangle((310, 292, 809, 382), radius=18, fill=blend(soft_rgb, (255, 255, 255), 0.45))
    draw.rectangle((238, 424, 310, 442), fill=(255, 255, 255))
    draw.rectangle((900, 424, 972, 442), fill=(255, 255, 255))
    for x in (361, 845):
        draw.ellipse((x - 60, 427, x + 60, 547), fill=ink)
        draw.ellipse((x - 28, 459, x + 28, 515), fill=soft_rgb)


def generate() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    title_font = font(34)
    caption_font = font(20)

    for vehicle_id, name, accent, soft in CARS:
        accent_rgb = hex_to_rgb(accent)
        soft_rgb = hex_to_rgb(soft)
        image = Image.new("RGB", (1200, 675), soft_rgb)
        pixels = image.load()
        for y in range(image.height):
            for x in range(image.width):
                t = (x / image.width + y / image.height) / 2
                pixels[x, y] = blend(soft_rgb, (255, 255, 255), t)

        draw = ImageDraw.Draw(image, "RGBA")
        draw.rounded_rectangle((74, 72, 1126, 603), radius=28, fill=(255, 255, 255, 106), outline=(24, 32, 29, 36), width=2)
        draw_car(draw, accent, soft)
        draw.text((92, 92), name, fill=(24, 32, 29), font=title_font)
        draw.text((92, 142), "FlowRyd alpha inventory artwork", fill=(102, 115, 108), font=caption_font)
        image.save(OUT / f"{vehicle_id}.png", "PNG", optimize=True)


if __name__ == "__main__":
    generate()
