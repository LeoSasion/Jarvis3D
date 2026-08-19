# Global visual effects boundary

This package owns optional decorative screen effects. It does not import or read
Agent, terminal, Explorer, telemetry, taskbar, or workspace state.

The functional React surface remains the source of truth. The global boundary is
a sibling mounted by `main.jsx`; the CSS backend is fixed, `aria-hidden`, and
`pointer-events: none`. Master Off, hidden documents, forced colors, unsupported
surfaces, and the `?fx=off` recovery override produce no overlay DOM.

Current scope is deliberately narrow:

- The versioned preference store is shared by all same-origin WebView2 surfaces.
- The first backend supports only desktop scanlines, film grain, and vignette.
- Scanlines and vignette share one static composite layer. Grain owns a separate
  cadence-limited layer and becomes static under reduced motion.
- No effect filters, captures, or re-rasterizes the functional DOM.

Future WebGL work belongs behind the same render-plan boundary. Bloom must own
and release its downsample targets; temporal effects must own and release their
history buffers; context loss must fall back to CSS or Off. True post-processing
of the DOM requires a separate WebView2/host composition investigation and must
not be simulated by wrapping `#root` in a CSS filter.
