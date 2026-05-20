# WAK Solutions — Brand System

Reference for engineers consuming the visual system. The tokens are wired
in [app/globals.css](app/globals.css) and exposed via Tailwind utilities in
[tailwind.config.ts](tailwind.config.ts).

> **WAK Solutions** — World of Automation and Kinetics ·
> **عالم الأتمتة والريوبوتات** · `wak-solutions.com`
>
> Intelligent automation and robotics for a smarter, more efficient, and
> sustainable future.

---

## Color palette

All colors live as both raw CSS variables (`--color-*`) and Tailwind
classes (`bg-brand-*`, `text-brand-*`, `border-brand-*`). For semantic
work prefer the shadcn tokens (`bg-primary`, `text-accent`, etc.) — they
remap automatically if the palette ever shifts.

| Token             | Value     | Tailwind class       | Use                                 |
| ----------------- | --------- | -------------------- | ----------------------------------- |
| `--color-cyan`    | `#00C8FF` | `brand-cyan`         | Hover lift, accents, focus rings    |
| `--color-blue`    | `#0066FF` | `brand-blue`         | Primary CTAs, links, active states  |
| `--color-navy`    | `#0B1D33` | `brand-navy`         | Card / surface in dark mode         |
| `--color-ink`     | `#0F172A` | `brand-ink`          | Background canvas                   |
| `--color-cyan-2`  | `#22D3EE` | `brand-cyan-2`       | Secondary accent                    |
| `--color-emerald` | `#10B981` | `brand-emerald`      | Success state                       |
| `--color-amber`   | `#F59E0B` | `brand-amber`        | Warning state                       |
| `--color-violet`  | `#8B5CF6` | `brand-violet`       | Tertiary highlight (aurora gradient)|
| `--color-slate`   | `#64748B` | `brand-slate`        | Muted text, placeholder             |

### shadcn semantic mapping (`app/globals.css`)

| Variable                | Maps to       |
| ----------------------- | ------------- |
| `--background`          | `--color-ink` |
| `--foreground`          | white         |
| `--card` / `--popover`  | `--color-navy`|
| `--primary`             | `--color-blue`|
| `--accent` / `--ring`   | `--color-cyan`|
| `--muted-foreground`    | `--color-slate`|
| `--sidebar`             | `--color-ink` |

## Gradients

Available as utility classes (defined in [app/globals.css](app/globals.css#L130)).

| Class                    | Stops                                             |
| ------------------------ | ------------------------------------------------- |
| `bg-gradient-primary`    | `#00C8FF → #0066FF` · primary CTAs, hero headings |
| `bg-gradient-cool`       | `#00C8FF → #10B981` · success-leaning gradient    |
| `bg-gradient-aurora`     | `#0066FF → #8B5CF6` · marketing flourishes        |
| `bg-brand-aurora`        | Radial blue/cyan glow on ink · hero / 404 / empty |
| `text-gradient-primary`  | Same stops as `bg-gradient-primary`, clipped to text |
| `text-gradient-aurora`   | Aurora stops clipped to text                      |
| `shadow-glow-cyan`       | Cyan focus/hover glow for elevated cards          |

## Typography

Fonts come from `next/font/google` in [app/layout.tsx](app/layout.tsx) — no
external `<link>` or CSS `@import`. The variables get wired into the brand
font stacks in [app/globals.css](app/globals.css).

- **Inter** — default, English-first. Weights 400, 600. CSS var `--font-inter`.
- **Cairo** — auto-applies on `html[lang="ar"]` and `html[dir="rtl"]`.
  Weights 400, 700. CSS var `--font-cairo-google`.

Type scale:

| Role           | Size     | Line height | Weight   |
| -------------- | -------- | ----------- | -------- |
| H1             | `3rem`   | `1.1`       | `600`    |
| H2             | `2.25rem`| `1.2`       | `600`    |
| H3             | `1.5rem` | `1.3`       | `600`    |
| Body           | `1rem`   | `1.6`       | `400`    |
| Small          | `0.875rem`| `1.5`      | `400`    |
| Chat message   | `0.9375rem`| `1.6`     | `400`    |

## Spacing & layout

- Spacing scale (Tailwind units): `2` (8) · `4` (16) · `6` (24) · `8` (32) ·
  `12` (48) · `16` (64) · `24` (96) · `32` (128).
- Container max: `1280px` (`max-w-7xl`) for marketing/landing.
- Chat / form column: `~768px` (`max-w-3xl`).
- Card radii: `rounded-lg` (12px), `rounded-md` (8px), `rounded-2xl` (20px).

## RTL / Arabic

- `html[lang="ar"]` and `html[dir="rtl"]` auto-switch the body font to Cairo.
- Use logical CSS properties: `ms-*`, `me-*`, `start-*`, `end-*`, `border-s`,
  `border-e`. Avoid `left-*` / `right-*` when the position matters.
- Add the `.icon-directional` class to any icon that points (`Send`,
  `ArrowRight`, `ChevronRight`, etc.). It gets `transform: scaleX(-1)` under
  RTL — see [app/globals.css](app/globals.css#L120).

## Usage examples

### `<Logo />`

```tsx
import { Logo } from '@/components/ui/Logo';

// Header — above the fold, request high-priority load.
<Logo size="md" priority />

// Footer / supporting placement.
<Logo size="sm" />

// Hero feature with custom height.
<Logo size={96} className="drop-shadow-glow" />
```

The `mark` variant renders [public/wak-logo-mark.png](public/wak-logo-mark.png).
A `lockup` / `wordmark` variant will join once the design team delivers an SVG;
the component's prop surface is already shaped for that drop-in.

### Button — primary CTA

```tsx
<button className="inline-flex items-center justify-center rounded-xl bg-gradient-primary px-5 py-2.5 text-sm font-semibold text-white hover:brightness-110 transition-all">
  Get started
</button>
```

### Card — brand surface with hover glow

```tsx
<div className="rounded-2xl border border-white/[0.06] bg-card p-6 transition-shadow hover:shadow-glow-cyan">
  ...
</div>
```

### Input — chat composer / form field

```tsx
<input
  className="w-full rounded-xl bg-card border border-white/[0.08] px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-cyan/40 focus:border-brand-cyan/40"
  placeholder="Type a message…"
/>
```

## Asset pipeline

Brand icons + favicon + OG image are derived from
[public/wak-logo-mark.png](public/wak-logo-mark.png) via
[scripts/generate-icons.mjs](scripts/generate-icons.mjs):

```sh
node scripts/generate-icons.mjs
```

Outputs (all under `/public/`): `favicon.ico` (multi-size 16/32/48),
`icon.png`, `apple-icon.png`, `icon-192.png`, `icon-512.png`, `og-image.png`.
Re-run whenever the source mark changes.

## What's intentionally NOT branded

- [components/chat-area.tsx](components/chat-area.tsx) — the agent's
  customer-message pane is deliberately styled to mimic WhatsApp Web so
  agents recognise it instantly. The brand tokens flow through (font,
  scrollbars, surrounding chrome), but the wallpaper, bubble tails, and
  message colours stay WhatsApp-native.
- All `/app/api/` HTML email templates — out of scope for this batch;
  rebranding inbound customer emails is a separate review.
