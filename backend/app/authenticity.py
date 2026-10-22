"""Is this listing likely the original product? Evidence only from the data we have:
the seller's own title and description, the price against other shops for the same product, and
whether a warranty is given. The dataset has no user reviews, so they are never claimed as evidence.
The verdict is an estimate with a confidence, never presented as fact; only the shop's own answer to
an inquiry can confirm a copy ("confirmed_copy")."""
from __future__ import annotations

import re
from functools import lru_cache

from . import db
from .timegeo import fa_digits

_COPY = re.compile(r"(?<![\w])(کپی|مستر کپی|های ?کپی|طرح اصلی|طرح اورجینال|فیک|رپلیکا|replica|copy|aaa|غیر ?اصل)(?![\w])")
_ORIGINAL = re.compile(r"(?<![\w])(اورجینال|original|اصل|پلمپ|اکبند|گارانتی شرکتی|رجیستر|ریجستر)(?![\w])")

LABELS = {
    "declared_copy": "فروشنده خودش نوشته غیراصل است",
    "suspicious": "مشکوک به غیراصل",
    "likely_original": "به احتمال زیاد اصل",
    "unknown": "اصالت نامعلوم",
}


def assess(o: dict, median: int | None, n_priced: int) -> dict:
    text = db.normalize_fa(" ".join(x for x in (o.get("seller_title"), o.get("description")) if x), split_alnum=False)
    copy = _COPY.search(text)
    orig = _ORIGINAL.search(text.replace(copy.group(0), "") if copy else text)
    price = o.get("price_toman") if o.get("price_ok") else None
    ratio = price / median if price and median and n_priced >= 3 else None
    warranty = bool(o.get("warranty_desc") or o.get("warranty_months") or o.get("warranty_provider"))
    reasons: list[str] = []
    if copy:
        status, conf = "declared_copy", 90
        reasons.append(f"در عنوان یا توضیح فروشنده آمده «{copy.group(0)}»")
    elif ratio is not None and ratio < 0.6:
        status, conf = "suspicious", 70
        reasons.append(f"قیمتش {fa_digits(round((1 - ratio) * 100))}٪ پایین‌تر از میانهٔ فروشگاه‌های دیگر است")
    elif ratio is not None and ratio < 0.78 and not orig and not warranty:
        status, conf = "suspicious", 55
        reasons.append(f"قیمتش {fa_digits(round((1 - ratio) * 100))}٪ زیر میانه است و نشانه‌ای از اصالت یا گارانتی ندارد")
    elif orig or warranty:
        status, conf = "likely_original", 70 if (orig and warranty) else 60
        if orig:
            reasons.append(f"فروشنده نوشته «{orig.group(0)}»")
        if warranty:
            reasons.append("گارانتی ثبت کرده")
    else:
        status, conf = "unknown", 0
        reasons.append("نشانهٔ روشنی در دادهٔ ترب نیست")
    return {"status": status, "confidence": conf, "label": LABELS[status], "reasons": reasons}


# A whole product card, not one shop's listing: its own title says it is a copy of a brand («گوشی طرح
# سامسونگ»), or it costs a fraction of the same model elsewhere in the catalogue (an «S25 اولترا» at 19
# million when every other S25 Ultra is near 300). Shown as «احتمالاً غیراصل», never as fact.
_BRAND_COPY = re.compile(r"(?<![\w])طرح (?=(?:\w+ )?(?:سامسونگ|اپل|آیفون|ایرپاد|شیائومی|هواوی|آنر|نوکیا|سونی|نایک|آدیداس|رولکس"
                         r"|samsung|apple|iphone|airpods|xiaomi|huawei|sony|nike|adidas|rolex)(?![\w]))")
_CODE = re.compile(r"(?<![a-z0-9])([a-z]{1,2}) ?(\d{1,3})(?![0-9a-z])")  # «S25», «A 26»; not the «HD 4» of «HD 4K»
_IPHONE = re.compile(r"(?:iphone|آیفون) ?(\d{1,2})(?![0-9])")
_VARIANTS = {"ultra": "ultra", "اولترا": "ultra", "pro": "pro", "پرو": "pro", "max": "max", "مکس": "max",
             "plus": "plus", "پلاس": "plus", "fe": "fe", "lite": "lite", "لایت": "lite", "mini": "mini", "مینی": "mini"}
_WORDS = re.compile(r"[a-z]+|[؀-ۿ]+")
_CPU = re.compile(r"^(?:i|r|m)[0-9]$")  # «i7», «r5», «m2» name the processor, not the model
_USED = re.compile(r"استوک|کارکرده|دست ?دوم|refurbished|open ?box")  # a used one is cheap for a reason
FAR_BELOW = 0.4  # under this share of the same model's usual price
# devices only: a case or a screen guard for «iPhone 16» is cheap next to other cases for good reason
DEVICE_CATS = ("گوشی موبایل", "تبلت", "ساعت و مچ بند هوشمند", "هدفون، هدست و هندزفری", "لپ تاپ و نوت بوک", "تلویزیون",
               "دوربین عکاسی و فیلمبرداری", "کنسول بازی")


def _declares_copy(title: str) -> bool:
    t = db.normalize_fa(title, split_alnum=False)
    return bool(_COPY.search(t) or _BRAND_COPY.search(t))


def _model_key(title: str) -> tuple[str, frozenset] | None:
    t = title.lower()
    m = _IPHONE.search(t)
    code = f"iphone {m.group(1)}" if m else None
    if not code:
        code = next((f"{a} {n}" for a, n in _CODE.findall(t) if not _CPU.match(a + n)), None)
    if not code:
        return None
    return code, frozenset(_VARIANTS[w] for w in _WORDS.findall(t) if w in _VARIANTS)


@lru_cache(maxsize=1024)
def _model_median(category: str, brand: str, code: str, variants: frozenset) -> int | None:
    # same brand too: cheap phones from small brands are also called «S25 Ultra»
    rows = db.q("SELECT p.title, p.median_price_toman AS price FROM products_fts JOIN products p ON p.pid = products_fts.rowid"
                " WHERE products_fts MATCH ? AND p.category_name = ? AND p.brand = ? AND p.median_price_toman > 0"
                " AND p.is_redacted = 0 LIMIT 300", (f'title : "{db.normalize_fa(code)}"', category, brand))
    prices = sorted(r["price"] for r in rows if _model_key(r["title"]) == (code, variants)
                    and not _declares_copy(r["title"]) and not _USED.search(r["title"].lower()))
    return prices[len(prices) // 2] if len(prices) >= 3 else None


def product_hint(title: str | None, category: str | None, brand: str | None, price: int | None) -> str | None:
    """Why this product is probably not the original, or None."""
    if not title:
        return None
    if _declares_copy(title):
        return "توی اسمش اومده طرح یا کپی"
    device = bool(category and brand and price) and category.startswith(DEVICE_CATS)
    key = _model_key(title) if device and not _USED.search(title.lower()) else None
    med = _model_median(category, brand, *key) if key else None
    if med and price < FAR_BELOW * med:
        return f"قیمتش فقط {fa_digits(round(100 * price / med))}٪ قیمت معمول همین مدل توی تربه"
    return None
