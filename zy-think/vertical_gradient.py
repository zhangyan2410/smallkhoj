#!/usr/bin/env python3
"""
沿垂直方向采样颜色，还原「水面→水底」的连续渐变带。
证明水的颜色是一条渐变，不是单色。输出渐变带预览图 + 关键采样点。
"""
import sys, math
from PIL import Image, ImageDraw
import numpy as np

def srgb_to_linear(c):
    c = c / 255.0
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

def rgb_to_oklch(r, g, b):
    rL, gL, bL = srgb_to_linear(r), srgb_to_linear(g), srgb_to_linear(b)
    l = 0.4122214708*rL + 0.5363325363*gL + 0.0514459929*bL
    m = 0.2119034982*rL + 0.6806995451*gL + 0.1073969566*bL
    s = 0.0883024619*rL + 0.2817188376*gL + 0.6299787005*bL
    l_,m_,s_ = l**(1/3), m**(1/3), s**(1/3)
    L = 0.2104542553*l_ + 0.7936177850*m_ - 0.0040720468*s_
    a = 1.9779984951*l_ - 2.4285922050*m_ + 0.4505937099*s_
    bb = 0.0259040371*l_ + 0.7827717662*m_ - 0.8086757660*s_
    C = math.sqrt(a*a + bb*bb)
    H = (math.degrees(math.atan2(bb, a)) + 360) % 360
    return L, C, H

def main():
    img = Image.open(sys.argv[1]).convert("RGB")
    W, Hh = img.size
    arr = np.asarray(img).astype(np.float32)
    # 取画面中央纵向带（避开边缘），宽度 40% 居中
    x0, x1 = int(W*0.3), int(W*0.7)
    band = arr[:, x0:x1, :]            # (H, w, 3)
    row_mean = band.mean(axis=(1,))    # 每一行（每个高度）的平均色 (H,3)

    n_samples = 24
    step = max(1, Hh // n_samples)
    print(f"图像 {W}x{Hh}，中央纵向带 x[{x0}:{x1}]，每行取平均色\n")
    print(f"{'高度%':<7}{'HEX':<9}{'OKLCH(L C H)':<28}{'说明'}")
    print("-"*78)
    samples = []
    for y in range(0, Hh, step):
        r,g,b = [int(round(v)) for v in row_mean[y]]
        hexv = f"#{r:02X}{g:02X}{b:02X}"
        L,C,H = rgb_to_oklch(r,g,b)
        # 判断这行属于什么
        if H < 260 and H > 170:
            tag = "蓝（水面/水体）"
        elif 25 <= H <= 110:
            tag = "暖（沙滩/天空）"
        else:
            tag = "过渡/其他"
        print(f"{y/Hh*100:>5.0f}%  {hexv:<9}oklch({L:.3f} {C:.3f} {H:.1f}){'':<10}{tag}")
        samples.append((y/Hh, (r,g,b)))

    # 生成渐变带预览：把整列平均色按高度还原成一条带
    band_h = Hh
    grad = Image.new("RGB", (120, band_h), (255,255,255))
    gd = ImageDraw.Draw(grad)
    for y in range(band_h):
        r,g,b = [int(round(v)) for v in row_mean[y]]
        gd.line([(0,y),(120,y)], fill=(r,g,b))
    # 横向拼：左=渐变带，右=色相曲线示意
    out = Image.new("RGB", (360, band_h), (245,245,245))
    out.paste(grad, (0,0))
    out.save("palette_gradient.png")
    print(f"\n纵向渐变带已保存: palette_gradient.png（左 120px 是从上到下的真实颜色渐变）")

if __name__ == "__main__":
    main()
