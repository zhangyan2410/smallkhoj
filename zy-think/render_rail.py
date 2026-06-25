#!/usr/bin/env python3
"""
直接用 Pillow 画出侧边栏 PNG：深海青顶 → 中海蓝 → 透亮青 → 暖沙底，
+ 3 条波浪水纹 + 斜射阳光 + 水面亮线。不依赖浏览器，输出清晰大图。
"""
import math
from PIL import Image, ImageDraw, ImageFilter

W, H = 200, 2000   # 放大画，看得清；显示时可缩放
img = Image.new("RGB", (W, H), (255, 255, 255))
px = img.load()

# OKLCH -> RGB（简化查表插值），这里直接用预先转好的 RGB 渐变 stops（来自 oklch 值）
# 深#0E2A52 青#0E5B7A 中#0E93A8 浅#7FC4C2 极浅#CFE3D8 暖沙#E8D6B8 沙底#E3D0AE
stops = [
    (0.00, (14,  42,  82)),   # 深海青
    (0.10, (22,  58,  98)),   # 深
    (0.22, (40, 110, 138)),   # 中海蓝
    (0.38, (90, 175, 184)),   # 透亮青
    (0.56, (170,210, 200)),   # 极浅青
    (0.78, (225,210, 175)),   # 暖沙过渡
    (0.92, (232,214, 184)),   # 暖沙
    (1.00, (227,208, 174)),   # 沙底
]
def grad_color(t):
    for i in range(len(stops)-1):
        t0,c0 = stops[i]; t1,c1 = stops[i+1]
        if t0 <= t <= t1:
            f = (t-t0)/(t1-t0)
            return tuple(round(c0[k]+(c1[k]-c0[k])*f) for k in range(3))
    return stops[-1][1]

# 1) 底色渐变（按行）
for y in range(H):
    c = grad_color(y/H)
    for x in range(W):
        px[x,y] = c

# 2) 阳光：从顶部偏左斜射的暖白光柱。用一个 alpha 蒙版叠加
overlay = Image.new("RGB", (W,H), (0,0,0))
od = ImageDraw.Draw(overlay)
# 光柱是一个斜的多边形（梯形），从顶部 25% 宽，向下右偏移到底部 ~55% 宽
poly = [(W*0.10, -20), (W*0.62, -20), (W*0.78, H*0.55), (W*0.30, H*0.60)]
od.polygon(poly, fill=(255, 248, 220))
# 给光柱做高斯模糊让它柔和
overlay = overlay.filter(ImageFilter.GaussianBlur(18))
# 把光柱以 screen 方式叠到底色上（提亮）
for y in range(H):
    for x in range(W):
        r,g,b = px[x,y]
        sr,sg,sb = overlay.getpixel((x,y))
        # screen: 255 - (255-a)*(255-b)/255，这里用简单的加法+限制
        a = 0.42
        nr = min(255, r + sr*a)
        ng = min(255, g + sg*a)
        nb = min(255, b + sb*a)
        px[x,y] = (int(nr), int(ng), int(nb))

# 3) 水纹：3 条正弦波浪线（横向），用亮色描
def draw_wave(y_center, amp, period, color, width):
    d = ImageDraw.Draw(img)
    pts = []
    for x in range(-5, W+6, 2):
        y = y_center + amp*math.sin((x/period)*2*math.pi)
        pts.append((x,y))
    for i in range(len(pts)-1):
        d.line([pts[i],pts[i+1]], fill=color, width=width)

draw_wave(int(H*0.33), 6, W*0.9, (232,250,248), 4)   # 上水线，最亮
draw_wave(int(H*0.51), 5, W*0.9, (230,248,245), 3)   # 中水线
draw_wave(int(H*0.67), 4, W*0.9, (228,246,242), 3)   # 下水线，较淡

# 4) 水面顶部亮线
d = ImageDraw.Draw(img)
d.rectangle([0,0,W,5], fill=(220,250,248))

# 5) 右下角标注每个区段（便于你对应）
# 缩到展示尺寸
img.thumbnail((120, 1200), Image.LANCZOS)
img.save("/Users/code/project/smallkhoj/zy-think/rail_render.png")
print("已生成: zy-think/rail_render.png  尺寸:", img.size)
