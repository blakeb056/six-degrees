// The SVG filters a look's dots use on every map but the Galaxy (which paints
// its own, for thousands of dots): app/globals.css applies them to `.sd-dot`
// under html[data-dots]. Any colour works, since they light the dot's own shape.
//
//   #sd-droplet  a drop of glass: lit from the top left (a specular highlight
//                on the dot's own shape), a little see-through, with a bright rim
//   #sd-glow     a soft light round the dot in its own colour
//
// Rendered once, in the layout, as a hidden <svg>.

export default function ThemeDefs() {
  return (
    <svg width="0" height="0" aria-hidden="true" focusable="false" style={{ position: 'absolute', width: 0, height: 0, pointerEvents: 'none' }}>
      <defs>
        <filter id="sd-droplet" x="-30%" y="-30%" width="160%" height="160%" colorInterpolationFilters="sRGB">
          <feGaussianBlur in="SourceAlpha" stdDeviation="1.4" result="soft" />
          <feSpecularLighting in="soft" surfaceScale="4" specularConstant="1.15" specularExponent="24" lightingColor="#ffffff" result="light">
            <feDistantLight azimuth="225" elevation="52" />
          </feSpecularLighting>
          <feComposite in="light" in2="SourceAlpha" operator="in" result="shine" />
          <feComponentTransfer in="SourceGraphic" result="clear"><feFuncA type="linear" slope="0.72" /></feComponentTransfer>
          <feMorphology in="SourceAlpha" operator="erode" radius="0.8" result="inner" />
          <feComposite in="SourceAlpha" in2="inner" operator="out" result="edge" />
          <feFlood floodColor="#ffffff" floodOpacity="0.55" />
          <feComposite in2="edge" operator="in" result="rim" />
          <feMerge>
            <feMergeNode in="clear" />
            <feMergeNode in="shine" />
            <feMergeNode in="rim" />
          </feMerge>
        </filter>
        <filter id="sd-glow" x="-80%" y="-80%" width="260%" height="260%" colorInterpolationFilters="sRGB">
          <feGaussianBlur in="SourceGraphic" stdDeviation="2.4" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
    </svg>
  );
}
