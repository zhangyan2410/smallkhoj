#!/usr/bin/env python3
"""
从方形生图裁出多个候选竖条（侧栏底图），拼成对比图。
侧栏真实比例参考：宽 60px / 高 800px ≈ 1:13。这里裁不同位置和宽度。
"""
from PIL import Image

im = Image.open("gen_src.png").convert("RGB")
W, H = im.size
print(f"原图 {W}x{H}")

# 目标竖条比例 1:13。裁剪窗口：宽 = H/13 左右
target_ratio = 13
strip_w = max(40, int(H / target_ratio))   # 约 59px 等效，但裁的时候放大点更清晰

# 候选：不同横向起始位置（用比例），不同裁剪宽度
candidates = [
    ("center-narrow", 0.50, 0.07),   # 正中，窄
    ("center-med",    0.50, 0.12),   # 正中，中
    ("left-sun",      0.30, 0.10),   # 偏左，阳光强区
    ("right",         0.72, 0.10),   # 偏右
    ("wide-preview",  0.50, 0.22),   # 宽版预览
]

strips = []
for name, cx, width_ratio in candidates:
    w = int(W * width_ratio)
    x0 = int(W * cx) - w // 2
    x0 = max(0, min(x0, W - w))
    crop = im.crop((x0, 0, x0 + w, H))
    # 放大到统一展示宽度（80px），高度按原比例
    disp_w = 80
    disp_h = int(H * (disp_w / w))
    crop_disp = crop.resize((disp_w, disp_h), Image.LANCZOS)
    strips.append((name, crop_disp))
    # 也单独存一份原始裁剪（高清）
    crop.save(f"rail_{name}.png")
    print(f"{name}: 裁剪 x[{x0}:{x0+w}] -> 原始 {crop.size}, 展示 {crop_disp.size}")

# 拼对比图：横排 5 条 + 标签
gap = 20
label_h = 24
total_w = sum(s[1].width for s in strips) + gap * (len(strips) + 1)
max_h = max(s[1].height for s in strips)
canvas = Image.new("RGB", (total_w, max_h + label_h + 20), (245, 245, 248))
from PIL import ImageDraw
d = ImageDraw.Draw(canvas)
x = gap
for name, strip in strips:
    canvas.paste(strip, (x, label_h + 10))
    d.text((x + 4, 4), name, fill=(40, 40, 50))
    x += strip.width + gap
canvas.save("rail_candidates.png")
print("\n对比图: rail_candidates.png  尺寸", canvas.size)
