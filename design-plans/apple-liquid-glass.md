# Liquid Glass implementation notes

Reviewed Apple's official design guidance on 2026-11-09:

- [Meet Liquid Glass, WWDC25](https://developer.apple.com/videos/play/wwdc2025/219/): lensing, interaction light, fluid transitions, regular versus clear material, and accessibility.
- [Get to know the new design system](https://developer.apple.com/videos/play/wwdc2025/356/): navigation hierarchy, concentric shapes, and platform continuity.
- [Materials](https://developer.apple.com/design/human-interface-guidelines/materials): control materials versus content surfaces.

The workspace follows the regular-material direction: floating capsule navigation, a moving selection lens, neutral light/dark palettes, system typography, restrained blue primary actions, green switches, and standard content surfaces. Avoid glass-on-glass card stacks. The media player uses a clear treatment with local dimming and bright foreground controls; its larger menu has more substantial tint for legibility. Page selection controls and saved badges follow the same shapes and typography.

Reduced motion disables animated selection and press deformation. Reduced transparency replaces glass with opaque surfaces. Increased contrast strengthens outlines. Native selects, keyboard focus, semantic status colors, and all existing download workflows are retained.

This is a web interpretation, not Apple's native Liquid Glass renderer. CSS backdrop blur, highlights and layered shadows approximate its optical appearance; they do not reproduce Apple's real-time lensing, automatic per-pixel background adaptation or native material morphing. No Apple fonts or SF Symbols are redistributed. System fonts use the platform font when available, and the existing Lucide icon assets are retained.
