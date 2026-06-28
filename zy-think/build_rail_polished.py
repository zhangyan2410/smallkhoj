#!/usr/bin/env python3
"""
精致版侧栏预览：
1. 底图 rail_texture.png 处理：顶部/底部做轻微羽化便于视觉延展
2. 用 SVG 精致线性图标（lucide 风格 path）嵌入，按 y 位置精准配色
3. 激活态：深青圆角块 + 青色外光晕 + 左侧高亮条
输出高保真 PNG。
"""
from PIL import Image, ImageFilter

# 底图
tex = Image.open("rail_texture.png").convert("RGB")
TW, TH = tex.size  # 80x800

# ===== 放大底图到工作尺寸（渲染更清晰），宽 120 高 1200 =====
SW, SH = 120, 1200
base = tex.resize((SW, SH), Image.LANCZOS)
px = base.load()

# ===== 按区域给图标配色：分析每行的明度，决定图标用白还是深色 =====
def region_color(y_frac):
    """根据纵向位置返回图标颜色（白 / 深青 / 深棕）"""
    if y_frac < 0.15:
        return (255, 255, 255)        # 顶部深区：白
    elif y_frac < 0.78:
        return (8, 55, 75)            # 中浅区：深青
    else:
        return (95, 72, 40)           # 底部沙区：深棕

# ===== 用 SVG 画整张图（底图 + 图标 + 激活态）=====
# 把底图转 base64 嵌入 SVG
import io, base64
buf = io.BytesIO()
base.save(buf, format="PNG")
b64 = base64.b64encode(buf.getvalue()).decode()

# lucide 风格图标 path（24x24 viewBox，stroke 线性图标）
ICONS = {
    "search": '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
    "chat": '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    "tasks": '<path d="m3 3 2 2 4-4"/><path d="M11 4h10"/><path d="m3 11 2 2 4-4"/><path d="M11 11h10"/><path d="m3 18 2 2 4-4"/><path d="M11 18h10"/>',
    "members": '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    "computer": '<rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/>',
    "bell": '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
    "settings": '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
}

# 图标布局：cx 居中，图标 size 26，垂直分布
def icon_svg(name, cx, cy, color, size=26, active=False, stroke_width=2):
    half = size / 2
    path = ICONS.get(name, ICONS["search"])
    # 颜色转 stroke
    fill_c = "none"
    stroke_c = f"rgb({color[0]},{color[1]},{color[2]})"
    # active 时图标用白色
    if active:
        stroke_c = "rgb(245,253,252)"
    return f'''<g transform="translate({cx-half},{cy-half}) scale({size/24})">
        <g fill="{fill_c}" stroke="{stroke_c}" stroke-width="{stroke_width*24/size}" stroke-linecap="round" stroke-linejoin="round">{path}</g>
    </g>'''

# 计算每个图标 y 位置
PAD_TOP = 70
ICON_SLOTS = 6
SLOT_H = 52
slots_y = [PAD_TOP + i * SLOT_H for i in range(ICON_SLOTS)]
# logo 在最顶
logo_y = 35
# 底部 avatar + settings
avatar_y = SH - 100
settings_y = SH - 40

cx = SW // 2
active_idx = 1  # chat 激活

# 激活态背景块
ab_y = slots_y[active_idx]
ab_h = 40
active_block = f'''<rect x="{cx-22}" y="{ab_y-20}" width="44" height="{ab_h}" rx="12"
    fill="rgb(8,70,88)" fill-opacity="0.92"/>
<rect x="{cx-22}" y="{ab_y-20}" width="44" height="{ab_h}" rx="12"
    fill="rgb(90,200,200)" fill-opacity="0.25" filter="url(#glow)"/>
<rect x="{cx-30}" y="{ab_y-10}" width="3" height="20" rx="1.5"
    fill="rgb(90,210,205)"/>'''

# 图标 SVG 片段
icons_svg = ""
# logo（菱形标记）
icons_svg += f'<g transform="translate({cx-12},{logo_y-12})"><path d="M12 2 L22 12 L12 22 L2 12 Z" fill="rgb(235,248,246)" stroke="rgb(8,90,110)" stroke-width="1.5"/></g>'
# 6 导航
nav_names = ["search","chat","tasks","members","computer","bell"]
for i, name in enumerate(nav_names):
    col = region_color(slots_y[i]/SH)
    is_active = (i == active_idx)
    icons_svg += icon_svg(name, cx, slots_y[i], col, size=26, active=is_active)
# avatar（圆形 + 字母）
av_col = region_color(avatar_y/SH)
icons_svg += f'<circle cx="{cx}" cy="{avatar_y}" r="15" fill="rgb(255,255,255)" fill-opacity="0.55" stroke="rgb({av_col[0]},{av_col[1]},{av_col[2]})" stroke-width="1.5"/><text x="{cx}" y="{avatar_y+5}" font-family="-apple-system,sans-serif" font-size="14" font-weight="600" fill="rgb({av_col[0]},{av_col[1]},{av_col[2]})" text-anchor="middle">L</text>'
# settings
icons_svg += icon_svg("settings", cx, settings_y, region_color(settings_y/SH), size=24)

svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="{SW}" height="{SH}" viewBox="0 0 {SW} {SH}">
<defs>
  <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
    <feGaussianBlur stdDeviation="4"/>
  </filter>
</defs>
<image href="data:image/png;base64,{b64}" width="{SW}" height="{SH}" preserveAspectRatio="none"/>
{active_block}
{icons_svg}
</svg>'''

# 用 cairosvg 渲染（如果有），否则存 svg 让用户看
try:
    import cairosvg
    cairosvg.svg2png(bytestring=svg.encode(), write_to="rail_polished.png", output_width=SW*3, output_height=SH*3)
    print("rail_polished.png 渲染完成 (cairosvg)")
except ImportError:
    with open("rail_polished.svg","w") as f:
        f.write(svg)
    print("cairosvg 未装，已存 rail_polished.svg（用浏览器/看图器打开）")
    print("装 cairosvg 可直接渲染 PNG: pip install cairosvg")
