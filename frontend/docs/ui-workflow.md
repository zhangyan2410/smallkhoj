# Frontend UI Redesign Workflow

A repeatable, **token-driven** process for improving the look of any page — written for engineers who don't hand-write CSS. The idea: turn visual work into **choices fed through one config layer**, not per-element styling.

Mental model (backend analogy):
- **Design tokens** (`app/globals.css`) ≈ a central config / constants file. Change a value here → the whole app restyles.
- **Component library** (`components/ui/*`) ≈ a shared SDK. Reuse, don't re-implement.
- **Reference image** ≈ an acceptance spec. You compare the result against it.

---

## The 5 steps

### 1. Pick a reference (don't design from scratch)
Find an image/product whose look you want — a screenshot, a photo, a product you admire. Taste is hard to invent but easy to *copy*. Drop the image somewhere and look at it while working.

If the reference is a photo, extract its real colors instead of guessing:
```bash
# sample dominant colors from an image
python - <<'PY'
from PIL import Image
from collections import Counter
im = Image.open('reference.jpg').convert('RGB').resize((160,160))
q = im.quantize(colors=10).convert('RGB')
for c,n in Counter(q.getdata()).most_common(10):
    print('#%02x%02x%02x'%c, n)
PY
```

### 2. Lock the color tokens (biggest lever)
All color lives in `app/globals.css` under `:root` (light) and `.dark` (dark). The values are **oklch**. Convert a hex palette to oklch with the helper at the bottom of this doc, then edit only the token values — never hardcode colors in components.

Rules that keep it looking good:
- **Big surfaces stay light/neutral** (background, sidebar, cards). Don't fill large areas with a saturated brand color — that's the #1 thing that makes a UI look cheap.
- **Brand color = accent only**: active nav item, primary button, links, badges. Small areas.
- **Gradients = tiny moments** (logo, a hero), never large panels.
- Keep both light + dark in sync.

Then hunt down hardcoded colors that bypass tokens and replace them:
```bash
# find one-off colors that won't follow the theme
grep -rn "bg-sky-\|border-slate-\|text-cyan-\|bg-emerald-" app components
# replace with semantic tokens: bg-muted, border-border, text-primary, bg-accent, etc.
```

### 3. Load a real font
A proper sans font instantly lifts the whole app. Use `next/font` in `app/layout.tsx`:
```tsx
import { Inter } from "next/font/google"
const inter = Inter({ subsets: ["latin"], variable: "--font-sans", display: "swap" })
// <html className={inter.variable}> ; globals.css already maps --font-sans
```

### 4. Reuse components, especially avatars
Use `components/ui/*` (shadcn). For people/agents, use `components/ui/avatar.tsx` — pass a `name` and it renders deterministic initials + a soft hashed color. Never hand-build avatar blocks inline.

Standard app layout = **icon rail (col 0) + sidebar + content + right context panel**. Copy the rail/sidebar structure from `app/chat/[channel]/channel-client.tsx`.

### 5. Review by running the app
```bash
# from repo root, start the services, then open the page and look
```
Compare against your step-1 reference. Adjust **token values only** and re-look. Iterate on color here — it's cheap because it's one layer.

---

## Semantic tokens cheat-sheet

| Token (Tailwind class) | Use for |
|---|---|
| `bg-background` / `text-foreground` | page base |
| `bg-card` | raised surfaces, cards |
| `bg-sidebar` / `bg-sidebar-accent` | left nav surfaces + hover |
| `bg-muted` / `text-muted-foreground` | quiet fills, secondary text |
| `bg-primary` / `text-primary` | brand accent (small areas) |
| `bg-accent` | subtle hover background |
| `border-border` | all borders |
| `ring-ring` | focus rings |

Avoid: `bg-sky-50`, `border-slate-200`, `text-blue-600`, etc. — they don't follow the theme.

---

## Helper: hex → oklch

```bash
python - <<'PY'
import math
def lin(c):
    c/=255; return c/12.92 if c<=0.04045 else ((c+0.055)/1.055)**2.4
def oklch(hx):
    hx=hx.lstrip('#'); r,g,b=[lin(int(hx[i:i+2],16)) for i in (0,2,4)]
    l=(0.4122214708*r+0.5363325363*g+0.0514459929*b)**(1/3)
    m=(0.2119034982*r+0.6806995451*g+0.1073969566*b)**(1/3)
    s=(0.0883024619*r+0.2817188376*g+0.6299787005*b)**(1/3)
    L=0.2104542553*l+0.7936177850*m-0.0040720468*s
    a=1.9779984951*l-2.4285922050*m+0.4505937099*s
    bb=0.0259040371*l+0.7827717662*m-0.8086757660*s
    C=math.hypot(a,bb); H=math.degrees(math.atan2(bb,a))%360
    return f'oklch({L:.3f} {C:.3f} {H:.1f})'
for hx in ['#fbfcfe','#2c6ad0','#f6f8fb']:  # edit this list
    print(hx, '->', oklch(hx))
PY
```
