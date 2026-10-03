# Animated plush bull — Claude integration

Files: bull-animations.png (transparent 4×4 sprite sheet), bull-animator.js (dependency-free custom element), animations-preview.html (working demo). The sheet was generated using the built-in image-generation tool; the exact prompt is in animation-generation-prompt.txt. The original still image and earlier CSS preview remain unchanged.

Copy bull-animator.js and bull-animations.png together into a public asset directory. Include the script once, then use:

```html
<script src="/mascot/bull-animator.js" defer></script>
<bull-mascot id="companion" state="idle" style="--bull-size:120px"></bull-mascot>
```

The image URL defaults to the same folder as the script. Override with a src attribute if needed. The element is decorative by default; set aria-label if it conveys content. Announce search status separately as text, never solely through the mascot.

After the component is defined, trigger an animation:

```js
await customElements.whenDefined('bull-mascot');
const mascot = document.querySelector('#companion');
mascot.setAttribute('state', 'read'); // loop while fetching
mascot.setAttribute('state', 'nod');  // once on success, then idle
mascot.setAttribute('state', 'idle'); // stop reading on failure/cancel
mascot.play('wave');                 // replay once even if state is unchanged
```

States: idle (periodic blink), wave (one greeting), read (looped glance down), nod (one acknowledgment). Wave/nod return visually to idle at completion and emit mascot-finished with detail.state. Their state attribute stays as requested unless the consumer changes it; use play() for repeated actions. Keep state synchronized in the app if visibility changes should not replay an action.

All motion is disabled when prefers-reduced-motion is enabled. Timers are cleaned up on disconnect and playback pauses while the tab is hidden. Use a compact 100–160px size alongside the header, never over the table. Four-frame sequences provide a flipbook style; slight pose/texture variation remains because these are generated images rather than a rigid 3D rig. The notebook is glanced at, not opened or page-turned. No walking animation is included.
