# Fit artwork into a Tesla wrap template: art inside the panels (template alpha), transparent elsewhere.
# usage: python3 -I wrap.py <art.png> <template.png> <out.png>
# Tesla rules: PNG, 512..1024 px, max 1 MB (we aim for < 950 KB), the template's own size.
import io, sys
from PIL import Image, ImageOps

MAX = 950_000


def build(art_path, tpl_path):
    tpl = Image.open(tpl_path).convert('RGBA')
    W, H = tpl.size
    art = ImageOps.fit(Image.open(art_path).convert('RGB'), (W, H), Image.LANCZOS)
    mask = tpl.getchannel('A')
    out = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    out.paste(art, (0, 0), mask)
    return out


def encode(img):
    b = io.BytesIO(); img.save(b, 'PNG', optimize=True)
    if b.tell() <= MAX: return b.getvalue()
    # too big: a 256-colour palette keeps the look and almost always lands well under 1 MB
    for colors in (256, 192, 128):
        q = img.quantize(colors=colors, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.FLOYDSTEINBERG)
        b = io.BytesIO(); q.save(b, 'PNG', optimize=True)
        if b.tell() <= MAX: return b.getvalue()
    raise SystemExit('wrap image stays over 1 MB')


if __name__ == '__main__':
    data = encode(build(sys.argv[1], sys.argv[2]))
    open(sys.argv[3], 'wb').write(data)
    print(len(data))
