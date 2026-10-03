# Factsheeter mascot

Original plush bull 3D-style raster mascot generated with the built-in image-generation tool. The PNG has an alpha channel. This is a rendered image, not a rigged 3D model or an animation sprite sheet.

Open preview.html to see the CSS entrance, gentle floating and hover tilt. Reduced-motion settings disable animation. These effects move the whole image; they do not articulate its hand, eyes or legs.

## Integrating with the app

Copy factsheeter-bull.png into the app's public asset directory and import mascot.css (or adapt it to the existing styling system). Use three nested elements with the classes mascot-enter, mascot-float and mascot-image, as shown in preview.html. Keep the transforms on their separate elements so entrance, idle and hover effects compose correctly. Set --mascot-width to approximately 90–140px in the research header. The supplied preview uses 180px to show the asset clearly.

If used purely as decoration next to the title, set the image alt to an empty string. Do not cover table controls or enlarge the header just to accommodate the mascot. Preserve aspect ratio. Do not interpret the whole-image tilt as an independently animated wave.

Blinking, hand waving and walking require additional consistent animation frames or a rigged 3D asset. Avoid attempting to animate individual body parts of this flat PNG.

The earlier human concept is preserved as factsheeter-mascot.png. The default preview uses factsheeter-bull.png.

## Original human generation prompt

Use case: stylized-concept. Asset type: transparent PNG mascot for Factsheeter, a modern ETF research web app. Create one original friendly human research companion, premium softly rendered 3D collectible character style: oversized expressive head, small full body, short textured dark brown hair, kind curious expression, olive green sweatshirt, charcoal trousers, off-white rounded sneakers, holding a small simple ivory tablet tucked in one arm and gently greeting with the other hand. Understated, tasteful character design suitable for a sophisticated black/off-white financial research interface. Matte clay-like materials, refined soft studio lighting, softly sculpted facial features, polished dimensional rendering. Three-quarter front view, entire body visible, centered, compact clear silhouette legible at small sizes. Genuine transparent alpha background with no scene, no floor, no opaque backdrop and no painted checkerboard. No text, letters, logos, coins, money signs, watermarks, extra characters or decorative elements. This is a single ready-to-use website image asset, not a website screenshot.
