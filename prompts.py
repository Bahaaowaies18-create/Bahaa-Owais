"""نصوص الـ prompts المستخدمة بتوليد صور روز مع علبة الفنير المتحرك."""

# البرومبت الأساسي: صورة روز وهي ماسكة علبة الفنير المتحرك
MAIN_PROMPT = """Create one photorealistic vertical commercial photograph.

SUBJECT (from the FIRST reference image):
Keep the exact same woman from the first reference image — identical face,
skin tone, freckles, eyebrows, eye color and shape, lips, and her long dark
wavy hair falling over her left shoulder. Keep her cream/ivory tailored
blazer over the ivory satin button-down shirt. She must be instantly
recognizable as the same person. Do not beautify, slim, reshape, or age her
face. Natural warm smile, looking straight into the camera.

PRODUCT (from the SECOND reference image):
She is holding up the yellow orthodontic retainer / clear-aligner case from
the second reference image. Reproduce the product exactly: glossy bright
yellow plastic clamshell case, two small dark hinge dots on the top edge,
and the round white sticker on the front with the blue triangle outline and
the black "SMILE_JO" monogram logo inside it. The logo and text must stay
sharp, upright, correctly spelled and fully readable.

IMPORTANT: use ONLY the product from the second image. Do NOT copy the woman,
hair, clothing, lighting, or background from the second image.

POSE AND FRAMING:
Waist-up vertical portrait. She holds the closed yellow case up beside her
face at about cheek height with her right hand, fingers relaxed and natural
(five correct fingers, no distortion), the sticker side facing the camera and
not covered by her fingers. Her face stays fully visible and unobstructed.

LIGHTING AND BACKGROUND:
Same clean studio look as the first reference image: soft warm beige seamless
background, soft large key light from the front-left with a gentle fill,
smooth natural skin texture with realistic pores, no harsh shadows.

STYLE:
High-end dental clinic advertising photography, shot on 85mm lens, shallow
depth of field, product and face both in sharp focus, true-to-life colors.
No text overlays, no watermarks, no logos other than the one on the case,
no extra hands or people in the frame."""


# نسخة بديلة: كلوز أب أكثر على المنتج
CLOSEUP_PROMPT = """Photorealistic vertical close-up commercial photo.

Keep the exact same woman from the FIRST reference image (identical face,
features, dark wavy hair and cream blazer with ivory satin shirt) — same
person, unmodified face.

She is holding the yellow orthodontic retainer case from the SECOND reference
image close to the camera with her right hand: glossy yellow clamshell case,
two dark hinge dots on top, round white sticker with a blue triangle outline
and the black "SMILE_JO" monogram inside. Use only the product from the second
image, nothing else from it.

The case is slightly closer to the lens than her face, sticker facing the
camera and fully readable, her smiling face soft-focused just behind it.
Soft warm beige studio background, soft frontal key light, natural skin
texture, realistic hand with five well-formed fingers.
Clean dental-brand advertising look. No text overlays, no watermarks."""


# نسخة عمودية للسوشال (ستوري/ريل) مع مساحة فاضية للكتابة
SOCIAL_PROMPT = """Photorealistic 9:16 social media advertising photo for a
dental clinic.

Keep the exact same woman from the FIRST reference image — identical face,
features, long dark wavy hair, cream tailored blazer over ivory satin shirt.
Same person, natural confident smile, looking at the camera.

She holds up the yellow orthodontic retainer case from the SECOND reference
image next to her face: glossy yellow clamshell, two dark hinge dots on the
top edge, round white sticker with a blue triangle outline and the black
"SMILE_JO" monogram, sharp and readable. Use only the product from the second
image.

Compose her in the lower two thirds of the frame, slightly to the right, so
the upper-left area stays as clean empty beige background for text. Soft warm
beige seamless studio backdrop, soft diffused key light, shallow depth of
field, premium commercial retouching.
No text, no captions, no watermarks in the image itself."""


PROMPTS = {
    "main": MAIN_PROMPT,
    "closeup": CLOSEUP_PROMPT,
    "social": SOCIAL_PROMPT,
}
