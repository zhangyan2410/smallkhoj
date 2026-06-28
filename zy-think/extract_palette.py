#!/usr/bin/env python3
"""
从自然照片中客观提取主色，并映射为 UI 设计 token。
用法: python3 extract_palette.py <image> [--clusters N] [--out-colors colors.png]
输出: 每个主色的 hex / rgb / oklch / 占比 / 推测的 UI 角色，并生成色卡预览图。
"""
import sys, math, argparse
from PIL import Image
import numpy as np
from sklearn.cluster import MiniBatchKMeans

# ---- sRGB -> linear -> OKLCH ----
def srgb_to_linear(c):
    c = c / 255.0
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

def rgb_to_oklch(r, g, b):
    rL, gL, bL = srgb_to_linear(r), srgb_to_linear(g), srgb_to_linear(b)
    l = 0.4122214708 * rL + 0.5363325363 * gL + 0.0514459929 * bL
    m = 0.2119034982 * rL + 0.6806995451 * gL + 0.1073969566 * bL
    s = 0.0883024619 * rL + 0.2817188376 * gL + 0.6299787005 * bL
    l_, m_, s_ = l ** (1/3), m ** (1/3), s ** (1/3)
    L = 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_
    a = 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_
    bb = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_
    C = math.sqrt(a * a + bb * bb)
    H = (math.degrees(math.atan2(bb, a)) + 360) % 360
    return L, C, H

def fmt_oklch(L, C, H):
    return f"oklch({L:.3f} {C:.3f} {H:.1f})"

# ---- 把色相映射到 UI 角色 ----
def ui_role(L, C, H):
    # 冷蓝：hue 180-260
    is_blue = 175 <= H <= 265
    # 暖色：hue 30-90（沙/黄/橙）
    is_warm = 25 <= H <= 100
    # 近白/浅中性
    if L >= 0.92 and C <= 0.03:
        return "背景/天空（near-white）"
    if is_warm and L >= 0.85 and C <= 0.06:
        return "暖沙表面（surface）"
    if is_blue and L >= 0.75 and C <= 0.10:
        return "淡蓝表面/浅滩（rail bg）"
    if is_blue and 0.45 <= L <= 0.72:
        return "中海蓝强调（primary）"
    if is_blue and L <= 0.45:
        return "深海蓝（deep accent）"
    if L <= 0.35:
        return "深色文字/墨色（foreground）"
    if L >= 0.55 and C <= 0.04:
        return "中性灰文字（muted）"
    return "其他"

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("image")
    ap.add_argument("--clusters", type=int, default=8)
    ap.add_argument("--out-colors", default="palette_colors.png")
    ap.add_argument("--sample", type=int, default=20000, help="采样像素数")
    args = ap.parse_args()

    img = Image.open(args.image).convert("RGB")
    W, Hh = img.size
    arr = np.asarray(img).reshape(-1, 3).astype(np.float32)

    # 采样加速
    if len(arr) > args.sample:
        idx = np.random.default_rng(0).choice(len(arr), args.sample, replace=False)
        sample = arr[idx]
    else:
        sample = arr

    km = MiniBatchKMeans(n_clusters=args.clusters, random_state=0, n_init=8)
    km.fit(sample)
    counts = np.bincount(km.labels_, minlength=args.clusters)
    order = np.argsort(-counts)

    print(f"图像: {args.image}  尺寸: {W}x{Hh}  聚类: {args.clusters}\n")
    print(f"{'#':<3}{'HEX':<9}{'RGB':<18}{'OKLCH':<28}{'占比':<8}{'推测 UI 角色'}")
    print("-" * 100)

    rows = []
    for rank, ci in enumerate(order, 1):
        rgb = km.cluster_centers_[ci]
        r, g, b = int(round(rgb[0])), int(round(rgb[1])), int(round(rgb[2]))
        hexv = f"#{r:02X}{g:02X}{b:02X}"
        L, C, H = rgb_to_oklch(r, g, b)
        pct = counts[ci] / counts.sum() * 100
        role = ui_role(L, C, H)
        print(f"{rank:<3}{hexv:<9}{str((r,g,b)):<18}{fmt_oklch(L,C,H):<28}{pct:>5.1f}%   {role}")
        rows.append((hexv, (r, g, b), pct))

    # ---- 色卡预览图 ----
    n = len(rows)
    card_w, card_h, gap = 220, 150, 12
    canvas = Image.new("RGB", (n * card_w + (n + 1) * gap, card_h + 2 * gap), (245, 245, 245))
    for i, (hexv, (r, g, b), pct) in enumerate(rows):
        x = gap + i * (card_w + gap)
        block = Image.new("RGB", (card_w, card_h - 46), (r, g, b))
        canvas.paste(block, (x, gap))
        # 文字标签（简单绘制）
        from PIL import ImageDraw
        d = ImageDraw.Draw(canvas)
        label_y = gap + card_h - 42
        d.text((x + 8, label_y), hexv, fill=(30, 30, 30))
        d.text((x + 8, label_y + 18), f"{pct:.1f}%", fill=(90, 90, 90))
    canvas.save(args.out_colors)
    print(f"\n色卡预览已保存: {args.out_colors}")

if __name__ == "__main__":
    main()
