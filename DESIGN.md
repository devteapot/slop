# Design System Specification: The Synthesized Sentinel

## 1. Overview & Creative North Star
### The Creative North Star: "The Nocturnal Observer"
This design system is built for the high-performance developer who operates in the "flow state"—often deep into the night. It eschews the bright, flat aesthetics of consumer SaaS in favor of a "Nocturnal Observer" aesthetic: a sophisticated, dark-mode-first environment that mimics the focused, predatory precision of an owl.

To move beyond a "template" look, we utilize **Intentional Asymmetry**. Layouts should not be perfectly centered; instead, use heavy left-aligned typography contrasted with floating, glassmorphic elements on the right. Large-scale typography and overlapping containers create an editorial feel, where the UI feels like a curated dashboard rather than a generic app.

---

## 2. Color Strategy
The palette is rooted in the deep void of a midnight sky, punctuated by the "AI Vision" of the owl’s glowing gaze.

### Palette Roles
- **Surface & Void:** The foundation is `surface` (#111319), a deep navy charcoal.
- **Primary Action (The Glow):** `primary` (#91db37) is reserved strictly for high-intent actions. It represents the "eyes" of the AI—searching, finding, and acting.
- **Secondary Accents:** `secondary` (#adc6ff) and its containers provide the "body" of the interface, used for navigation and subtle categorization.

### The "No-Line" Rule
**1px solid borders are prohibited for sectioning.** 
Structural boundaries must be defined solely through background color shifts. To separate a sidebar from a main content area, use `surface_container_low` against `surface`. This creates a soft, sophisticated transition that feels like light hitting different depths of a physical object.

### The Glass & Gradient Rule
Floating elements (modals, popovers, hovering cards) must utilize **Glassmorphism**.
- **Background:** `surface_variant` at 60% opacity.
- **Effect:** `backdrop-filter: blur(12px)`.
- **Signature Texture:** Primary CTAs should not be flat. Use a subtle linear gradient from `primary` to `primary_container` at a 135-degree angle to provide "soul" and depth.

---

## 3. Typography
We use a high-contrast pairing to balance human readability with machine precision.

| Level | Font Family | Case | Weight | Intent |
| :--- | :--- | :--- | :--- | :--- |
| **Display** | Space Grotesk | Sentence | 700 | Editorial impact and hero sections. |
| **Headline** | Space Grotesk | Sentence | 600 | Clear section headers. |
| **Title** | Space Grotesk | Sentence | 500 | Component-level titles. |
| **Body** | Space Grotesk | Sentence | 400 | Long-form reading and descriptions. |
| **Label** | JetBrains Mono | ALL CAPS | 500 | Technical metadata, tags, and micro-copy. |
| **Code** | JetBrains Mono | n/a | 400 | Snippets and developer input. |

**The Identity Link:** Headlines should use tight letter-spacing (-0.02em) to feel authoritative. Labels in JetBrains Mono should have increased letter-spacing (+0.05em) to maintain a "blueprint" or "terminal" aesthetic.

---

## 4. Elevation & Depth
Depth is achieved through **Tonal Layering** rather than traditional drop shadows.

### The Layering Principle
Think of the UI as stacked sheets of frosted obsidian. 
- **Level 0 (Base):** `surface`
- **Level 1 (In-page Section):** `surface_container_low`
- **Level 2 (Cards/Containers):** `surface_container`
- **Level 3 (Interactive/Floating):** `surface_container_highest`

### Ambient Shadows & Ghost Borders
- **Shadows:** When a float is required, use a diffused shadow: `box-shadow: 0 20px 40px rgba(0, 0, 0, 0.4)`. 
- **The Ghost Border:** If a container requires a perimeter for accessibility, use a "Ghost Border": `outline-variant` at 15% opacity. This provides a hint of a boundary without cluttering the visual field.
- **The "Vision" Glow:** High-priority cards can utilize a `drop-shadow` mimicking the owl's green eyes: `filter: drop-shadow(0 0 8px rgba(171, 248, 83, 0.25))`.

---

## 5. Components

### Buttons
- **Primary:** Neon Green (`primary`). Sharp corners (4px). On hover: A subtle outer glow (`0 0 15px primary`).
- **Secondary:** Glassmorphic Blue. `secondary_container` at 40% opacity with `backdrop-blur`.
- **Tertiary:** Ghost style. No background, `label-md` JetBrains Mono text with an underline that appears only on hover.

### Input Fields
- **Container:** `surface_container_highest`. 
- **Typography:** User input should always be `JetBrains Mono` to emphasize the developer-centric nature.
- **States:** On focus, the bottom edge gains a 2px `primary` (Neon Green) glow line. No full-box borders.

### Cards & Lists
- **Rule:** Never use dividers. 
- **Execution:** Separate list items using a `1.5` (0.3rem) vertical gap and a subtle background shift to `surface_container_low` on hover. Use negative space (Spacing Scale `4` or `5`) to define content groups.

### Terminal/Code Blocks
- **Background:** `surface_container_lowest` (#0c0e14).
- **Accents:** Use the secondary blue scale for syntax highlighting, with `primary` green reserved for search results or "success" logs.

---

## 6. Do's and Don'ts

### Do:
- **Use Large Margins:** Embrace the spacing scale (e.g., `20` or `24`) for page gutters to create a premium, uncrowded feel.
- **Layer via Tone:** Always try to use a slightly lighter or darker surface color before reaching for a border.
- **Mix Fonts Intentionally:** Use Space Grotesk for the "Human" side (marketing, headers) and JetBrains Mono for the "Machine" side (data, code, system status).

### Don't:
- **Don't use 100% Black:** Pure `#000000` is too harsh. Stick to the `#111319` base.
- **Don't use Rounded Corners > 8px:** This system is built on precision. Roundness should feel like a "softened sharp" (4px), not a pill shape (unless it's a Chip).
- **Don't Overuse the Neon Green:** It is a high-frequency color. If it's everywhere, it loses its "AI Vision" significance. Use it only for what truly matters.