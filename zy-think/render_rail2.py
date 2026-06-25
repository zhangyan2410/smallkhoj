#!/usr/bin/env python3
"""
直接渲染侧边栏 PNG，颜色全部用 rgb_to_oklch 的逆函数程序算（不手填）。
深海青顶 → 中海蓝 → 透亮青 → 暖沙底 + 波浪水纹 + 斜射阳光。
"""
import math
from PIL import Image, ImageDraw, ImageFilter

# ---- OKLCH -> sRGB（标准逆变换）----
def oklch_to_rgb(L, C, h):
    h_rad = math.radians(h)
    a = C * math.cos(h_rad)
    b = C * math.sin(h_rad)
    # OKLab
    L_ = L + 0.3963377774 * a + 0.2158037573 * b
    M_ = L - 0.1055613458 * a - 0.0638541728 * b
    S_ = L - 0.0894841775 * a - 1.2914855480 * b
    l = L_**3; m = M_**3; s = S_**3
    r = +4.0767416621*l - 3.3077115913*m + 0.2309699292*s
    g = -1.2684380046*l + 2.6097574011*m - 0.3413193965*s
    bl= -0.0041960863*l - 0.7034186147*m + 1.7076147010*s
    def lin2srgb(c):
        c = max(0, c)
        return 0 if c <= 0.0031308 else 1.055*(c**(1/2.4)) - 0.055
    R = round(lin2srgb(r)*255)
    G = round(lin2srgb(g)*255)
    B = round(lin2srgb(bl)*255)
    return (max(0,min(255,R)), max(0,min(255,G)), max(0,min(255,B)))

W, H = 240, 2400
img = Image.new("RGB", (W, H), (255,255,255))
px = img.load()

# 用准确的 OKLCH 渐变 stops（来自之前提取并验证过的色相）
# 深 L0.26 h226 → 中 L0.52 h208 → 透 L0.70 h198 → 极浅 L0.82 h195 → 暖沙 L0.90 h70
stops = [
    (0.00, (0.26, 0.095, 226)),
    (0.10, (0.34, 0.105, 220)),
    (0.22, (0.52, 0.115, 208)),
    (0.38, (0.70, 0.110, 198)),
    (0.56, (0.82, 0.085, 195)),
    (0.78, (0.88, 0.060, 120)),
    (0.92, (0.90, 0.045, 80)),
    (1.00, (0.91, 0.040, 70)),
]
def grad_oklch(t):
    for i in range(len(stops)-1):
        t0,c0 = stops[i]; t1,c1 = stops[i+1]
        if t0 <= t <= t1:
            f = (t-t0)/(t1-t0)
            return tuple(c0[k]+(c1[k]-c0[k])*f for k in range(3))
    return stops[-1][1]

# 1) 底色
for y in range(H):
    L,C,h = grad_oklch(y/H)
    c = oklch_to_rgb(L,C,h)
    for x in range(W):
        px[x,y] = c

# 2) 阳光：斜光柱，先画在蒙版上模糊，再 screen 叠加
sun = Image.new("RGB", (W,H), (0,0,0))
sd = ImageDraw.Draw(sun)
poly = [(W*0.08, -30), (W*0.60, -30), (W*0.80, H*0.50), (W*0.28, H*0.58)]
sd.polygon(poly, fill=(255, 246, 215))
sun = sun.filter(ImageFilter.GaussianBlur(22))
sun_px = sun.load()
for y in range(H):
    for x in range(W):
        r,g,b = px[x,y]
        sr,sg,sb = sun_px[x,y]
        a = 0.45
        nr = min(255, r + sr*a)
        ng = min(255, g + sg*a)
        nb = min(255, b + sb*a)
        px[x,y] = (int(nr), int(ng), int(nb))

# 3) 水纹：3 条正弦波浪
def draw_wave(y_center, amp, period, color, width):
    d = ImageDraw.Draw(img)
    pts = [(x, y_center + amp*math.sin((x/period)*2*math.pi)) for x in range(-8, W+9, 2)]
    for i in range(len(pts)-1):
        d.line([pts[i],pts[i+1]], fill=color, width=width)

draw_wave(int(H*0.33), 7, W*0.85, oklch_to_rgb(0.97, 0.03, 188), 4)
draw_wave(int(H*0.51), 6, W*0.85, oklch_to_rgb(0.96, 0.03, 188), 3)
draw_wave(int(H*0.67), 5, W*0.85, oklch_to_rgb(0.95, 0.03, 188), 3)

# 4) 水面顶部亮线
ImageDraw.Draw(img).rectangle([0,0,W,6], fill=oklch_to_rgb(0.98, 0.05, 180))

img.thumbnail((130, 1300), Image.LANCZOS)
img.save("/Users/code/project/smallkhoj/zy-think/rail_render2.png")
print("已生成 rail_render2.png 尺寸", img.size)
