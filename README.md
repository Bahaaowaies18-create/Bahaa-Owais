# SMILE_JO — قالب صور الإعلانات

قالب بيشتغل مع **ChatGPT**: بيجهّزلك البرومبت، وبعد ما تنزّل الصورة بيركّب
الشعار وبيطلّعها بمقاسات الإنستا.

---

## طريقة الشغل — ٤ خطوات

### ١. جهّز البرومبت

```bash
python prompt.py
```

بيطبعلك البرومبت وبيحفظه كمان بملف `prompt.txt`.

### ٢. روح عـ ChatGPT

- افتح شات جديد
- ارفع **الصورتين** من علامة `+` : `assets/rose.png` و `assets/retainer_case.png`
- اكتب هالسطر أول:
  > Use the FIRST image for the person and the SECOND image only for the
  > product. Generate a vertical 9:16 image.
- الصق البرومبت واضغط إرسال

### ٣. نزّل الصورة

احفظها بأي مكان — مثلاً `output/img1.png`

### ٤. ظبّطها

```bash
python finish.py output/img1.png
```

بيركّب الشعار وبيطلّع:
- `..._story.jpg` — 1080×1920 ستوري وريلز
- `..._4k.png` — 2160×3840 للطباعة

---

## الملفات

| الملف | بتلمسه؟ | الوظيفة |
|---|---|---|
| **`config.py`** | ✅ **هاد اللي بتغيّره** | الصور، الأوصاف، الهوية، المقاسات |
| `prompt.py` | ▶️ بتشغّله | يجهّز البرومبت |
| `finish.py` | ▶️ بتشغّله | شعار + مقاسات |
| `prompts.py` | ❌ | نص البرومبت + بلوك الواقعية |
| `branding.py` | ❌ | تركيب الشعار والكتابة |
| `arabic_text.py` | ❌ | يخلّي العربي ينكتب موصول ومن اليمين |
| `upscale_image.py` | ❌ | التكبير والشحذ |
| `cutout_logo.py` | 🔧 | يفرّغ خلفية أي شعار جديد |
| `assets/` | ✅ | صورك المرجعية |
| `output/` | — | الملفات الجاهزة |

---

## تغيير الصورة أو المنتج

بملف `config.py`:

```python
PERSON_IMAGE = "assets/sara.png"     # ← صورتك الجديدة

PERSON_DESCRIPTION = """
A woman in her thirties with shoulder-length straight black hair,
fair skin, dark brown eyes.
"""
```

**ما في منتج؟** حط `PRODUCT_IMAGE = None` والبرومبت بيتجاهله لحاله.

---

## تغيير اللبس

اللبس بملف لحاله عن وصف الوجه، فبتغيّره بدون ما تلمس إشي تاني:

```python
OUTFIT = """
A navy blue medical scrub top with short sleeves, crisp and clean.
"""
```

**وإذا الصورة طالعة معك وبدك تبدّل اللبس بس؟** ارفعها لـ ChatGPT مع هاد
البرومبت — بيبدّل اللبس وبيخلي الوجه والخلفية والوقفة زي ما هم:

```bash
python prompt.py --edit-outfit
```

---

## الستايلات

```bash
python prompt.py --style main      # ماسكة المنتج جنب وجهها
python prompt.py --style closeup   # كلوز أب على المنتج
python prompt.py --style social    # ستوري مع مساحة للكتابة
python prompt.py --style portrait  # بورتريه بدون منتج
python prompt.py --style candid    # عفوية — كأنها صورة مسروقة بلحظتها

python prompt.py --short           # برومبت أقصر (لو الطويل ما ظبط)
```

**`candid`** هو الستايل العفوي: ضحكة طبيعية، إضاءة شباك حقيقية، خلفية
عيادة مش ستوديو، وكادر مايل شوي — وبيترك الثلث السفلي فاضي للكتابة.

---

## المقاسات

بملف `config.py`:

```python
ASPECT_RATIO = "9:16"               # اللي بتطلبه من ChatGPT
OUTPUT_SIZES = ["story", "4k"]      # اللي بيطلّعه finish.py
```

| الاسم | المقاس | لوين |
|---|---|---|
| `story` | 1080×1920 | ستوري وريلز |
| `post` | 1080×1350 | بوست عمودي |
| `square` | 1080×1080 | مربع |
| `4k` | 2160×3840 | طباعة وشاشات كبيرة |

```bash
python finish.py صورتي.png --preset post     # مقاس واحد بس
python finish.py *.png                       # كذا صورة مع بعض
python finish.py صورتي.png --no-brand        # بدون شعار
python finish.py صورتي.png --no-caption      # بدون كتابة
python finish.py صورتي.png --logo-pos top-left  # الشعار عاليسار لهالصورة بس
python finish.py صورتي.png --sharpen 1.4     # شحذ أقوى
```

---

## الهوية البصرية

الشعار بينحط **بعد** التوليد مش بالبرومبت — لأن موديلات الصور بتشوّه
الشعارات والكتابة. هيك بيطلع مظبوط كل مرة.

| اللون | الكود |
|---|---|
| أزرق المثلث | `#014FC9` |
| أصفر العلبة | `#F9C03C` |
| الغامق | `#23232A` |
| الأبيض | `#F7F7F7` |

```python
BRAND_ENABLED   = True
BRAND_POSITION  = "top-right"   # أو bottom-left، bottom-center...
BRAND_LOGO_SIZE = 0.22
BRAND_TEXT      = ""            # "" = الشعار لحاله
BRAND_BAR       = True          # شريط لون تحت الصورة
```

**ملفات الشعار:** `logo.png` (للخلفيات الغامقة) و `logo_dark.png` (للفاتحة).
الكود بيختار لحاله.

**شعار جديد؟**
```bash
python cutout_logo.py الشعار.jpg --dark-variant
```

---

## الكتابة على الصورة

نفس فكرة الشعار: الجملة والاسم بينكتبوا بـ `finish.py` بعد التوليد، مش
بالبرومبت — هيك الإملاء مظبوطة والعربي بيطلع موصول ومن اليمين لليسار.

بملف `config.py`:

```python
CAPTION_ENABLED  = True
CAPTION_TEXT     = "ابتسامتك تستاهل الأفضل"   # الجملة
CAPTION_NAME     = "روز"                      # الاسم تحتها
CAPTION_POSITION = "bottom-right"             # bottom-left مع الإنجليزي
CAPTION_SIZE     = 0.058                      # حجم الجملة
CAPTION_SCRIM    = True                       # تظليل خفيف تحتها
```

أو غيّرها بسرعة من سطر الأوامر بدون ما تفتح `config.py`:

```bash
python finish.py صورتي.png --caption "ابتسامة بتفرق" --name "روز"
python finish.py صورتي.png --no-caption      # بدون كتابة
python finish.py صورتي.png --no-brand        # بدون شعار
```

**الخط:** الكود بيدوّر على خط عربي بجهازك لحاله. إذا ما لقي بيحكيلك،
ووقتها حط مسار خط بـ `CAPTION_FONT`.

---

## الواقعية

بلوك `REALISM` بملف `prompts.py` بينحط تلقائياً بكل برومبت. بيطلب:

- **ثبات الملامح:** نفس الفك والأنف والعيون والحواجب — بدون تنحيف ولا تجميل
- **بشرة حقيقية:** مسام، ملمس، احمرار طبيعي — بدون فلتر ولا تنعيم
- **تفاصيل:** انعكاس ضوء بالعين، رموش منفصلة، شعيرات عند خط الشعر
- **ممنوعات:** بشرة بلاستيكية، أصابع زيادة، شعار مشوّه، علامات مائية

---

## التنصيب (مرة وحدة)

```bash
pip install pillow
```

بس. ما في مفاتيح ولا اشتراكات — التوليد بيصير عندك على ChatGPT.

---

## نصائح

1. **ولّد ٣–٤ نسخ** بـ ChatGPT واختار الأحسن — اليدين أكتر إشي بيطلع مشوّه.
2. **إذا الصورة طلعت فيها كتابة** من ChatGPT، شغّل `finish.py --no-brand`
   عشان ما يتكرر الشعار.
3. **إذا الوجه تغيّر**، احكيلي وبشدّد بلوك الواقعية أكتر.
4. **الصور اللي بتطلع من ChatGPT** عادةً حوالي 1024px — أقل من مقاس الإنستا.
   `finish.py` بيكبّرها للمقاس الصح، بس التفاصيل بتضل حسب الأصل.

---

## ملاحظة

`generate_rose_image.py` للتوليد عن طريق API — **مش مستعمل حالياً**.
محتفظين فيه إذا يوم حبيت تولّد تلقائياً بدل ما تنسخ وتلصق.
