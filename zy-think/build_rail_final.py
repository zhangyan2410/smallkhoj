#!/usr/bin/env python3
"""
把 center-narrow 底图做成完整侧栏：
1. 裁出纯净底图（水+光+沙），单独存为贴图
2. 渲染一张「底图 + 图标 + 激活态」的完整侧栏 PNG，证明方案可行
图标用代码画白色线性图标，激活态用青色光晕。
"""
from PIL import Image, ImageDraw, ImageFilter

# ===== 1. 准备底图 =====
src = Image.open("gen_src.png").convert("RGB")
W, H = src.size  # 777x767
# center-narrow 的裁剪参数（跟 crop_rail.py 一致）：cx=0.50, width=0.07
cx, width_ratio = 0.50, 0.07
w = int(W * width_ratio)
x0 = max(0, min(int(W * cx) - w // 2, W - w))
texture = src.crop((x0, 0, x0 + w, H))  # 54x767

# 放大到底图工作尺寸（宽 80，高按比例拉到 800，模拟侧栏）
TW, TH = 80, 800
texture_big = texture.resize((TW, TH), Image.LANCZOS)
# 存为贴图（落地时用这个）
texture_big.save("rail_texture.png")
print(f"贴图 rail_texture.png: {texture_big.size}")

# ===== 2. 在底图上叠加 UI，渲染完整侧栏 =====
# 复制一份做完整渲染
rail = texture_big.copy()
draw = ImageDraw.Draw(rail)

# 图标位置（从上到下）：logo / 6 nav / spacer / avatar / settings
# 每个图标 38x38，间距 5，居中
ICON = 38
GAP = 5
cw = TW  # 80
cx_icon = (cw - ICON) // 2  # 21
y = 14

def icon_slot(active=False):
    global y
    box = (cx_icon, y, cx_icon + ICON, y + ICON)
    if active:
        # 激活态：深青圆角块 + 外发光
        glow = Image.new("RGBA", (cw, TH), (0,0,0,0))
        gd = ImageDraw.Draw(glow)
        gd.rounded_rectangle(box, radius=11, fill=(8, 80, 95, 255))
        glow = glow.filter(ImageFilter.GaussianBlur(3))
        # 青色光晕（外圈）
        halo = Image.new("RGBA", (cw, TH), (0,0,0,0))
        hd = ImageDraw.Draw(halo)
        hd.rounded_rectangle([box[0]-3, box[1]-3, box[2]+3, box[3]+3], radius=13, fill=(90,200,200,120))
        halo = halo.filter(ImageFilter.GaussianBlur(4))
        rail.paste(Image.alpha_composite(Image.new("RGBA",(cw,TH),(0,0,0,0)), halo).convert("RGB"),
                   (0,0), halo)
    y += ICON + GAP
    return box

# logo（顶部，深色区，白底圆角）
logo_box = (cx_icon, y, cx_icon+ICON, y+ICON)
draw.rounded_rectangle(logo_box, radius=11, fill=(235, 248, 246))
y += ICON + 14

# 6 个导航图标（第2个激活）
boxes = []
for i in range(6):
    active = (i == 1)
    boxes.append((icon_slot(active), active))

# 底部
y = TH - 14 - ICON - GAP - ICON  # avatar + settings
avatar_box = (cx_icon, y, cx_icon+ICON, y+ICON); y += ICON + GAP
settings_box = (cx_icon, y, cx_icon+ICON, y+ICON)

# ===== 3. 画图标（简单线性图标，白色 / 激活态深色） =====
def draw_icon(box, kind, color):
    x1,y1,x2,y2 = box
    cx,cy = (x1+x2)//2, (y1+y2)//2
    s = 11  # 图标半径
    lw = 2
    if kind == "search":
        draw.ellipse([cx-s, cy-s, cx+s, cy+s], outline=color, width=lw)
        draw.line([cx+s-3, cy+s-3, cx+s+5, cy+s+5], fill=color, width=lw+1)
    elif kind == "chat":
        draw.rounded_rectangle([cx-s, cy-s+1, cx+s, cy+s-2], radius=4, outline=color, width=lw)
        draw.polygon([(cx-4,cy+s-2),(cx,cy+s+3),(cx+4,cy+s-2)], fill=color)
    elif kind == "tasks":
        draw.rectangle([cx-s, cy-s+2, cx+s, cy+s-2], outline=color, width=lw)
        for i,oy in enumerate([-4,0,4]):
            yy = cy+oy
            draw.line([cx-7,yy,cx-3,yy], fill=color, width=lw)
    elif kind == "members":
        draw.ellipse([cx-6,cy-s, cx+6,cy-1], outline=color, width=lw)
        draw.arc([cx-9,cy-2,cx+9,cy+s+3], 0, 180, fill=color, width=lw)
    elif kind == "computer":
        draw.rounded_rectangle([cx-s,cy-s+1,cx+s,cy+4], radius=2, outline=color, width=lw)
        draw.line([cx,cy+4,cx,cy+s-2], fill=color, width=lw)
        draw.line([cx-5,cy+s-2,cx+5,cy+s-2], fill=color, width=lw)
    elif kind == "bell":
        draw.polygon([(cx-7,cy+4),(cx-7,cy-2),(cx,cy-s),(cx+7,cy-2),(cx+7,cy+4)], outline=color, width=lw)
        draw.arc([cx-3,cy+3,cx+3,cy+9], 0, 180, fill=color, width=lw)

# 深色区图标用白色；浅色区用深青；沙区用深棕
WHITE = (255,255,255)
DEEP = (10, 50, 70)
SAND_INK = (90, 70, 40)

# logo 里画个小标记
lx = (logo_box[0]+logo_box[2])//2
ly = (logo_box[1]+logo_box[3])//2
draw.polygon([(lx,ly-8),(lx+7,ly+5),(lx-7,ly+5)], fill=(10,90,110))

# 图标配色按 y 位置判断区域
def color_at(box):
    cy = (box[1]+box[3])//2
    frac = cy / TH
    if frac < 0.16: return WHITE      # 顶部深区
    elif frac < 0.78: return DEEP     # 中浅区
    else: return SAND_INK             # 底部沙区

# 先画激活态背景块（在第2个图标）
ab, _ = boxes[1]
# 重新画激活块（覆盖在纹理上）
overlay = Image.new("RGBA", (cw, TH), (0,0,0,0))
od = ImageDraw.Draw(overlay)
od.rounded_rectangle(ab, radius=11, fill=(8, 70, 88, 235))
overlay = overlay.filter(ImageFilter.GaussianBlur(1.5))
rail.paste(overlay, (0,0), overlay)

# 画图标
draw = ImageDraw.Draw(rail)
kinds = ["search","chat","tasks","members","computer","bell"]
for i,(box,active) in enumerate(boxes):
    col = (255,255,255) if active else color_at(box)
    draw_icon(box, kinds[i], col)

# avatar
draw.ellipse(avatar_box, outline=color_at(avatar_box), width=2)
ax = (avatar_box[0]+avatar_box[2])//2
ay = (avatar_box[1]+avatar_box[3])//2
draw.text((ax-4, ay-7), "L", fill=color_at(avatar_box))
# settings（齿轮简化）
draw_icon(settings_box, "search", color_at(settings_box))  # 复用一个形状占位

rail.save("rail_final.png")
print(f"完整侧栏 rail_final.png: {rail.size}")

# 放大 3x 方便看清
big = rail.resize((cw*3, TH*3), Image.LANCZOS)
big.save("rail_final_3x.png")
print(f"放大版 rail_final_3x.png: {big.size}")
