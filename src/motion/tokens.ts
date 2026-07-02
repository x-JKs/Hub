// Motion Token System — "Obsidian Arsenal" motion language
//
// Physics-first: spring presets define character, not duration.
// Every animation in the app references these tokens so motion is cohesive.
//
// Spring math: we use CSS `linear()` approximations of spring curves
// for GPU-composited animations (transform/opacity only).

// --- Spring presets (mass/stiffness/damping → feel) ---
// These map to CSS easing functions approximated via linear() polyfills.
// Named by character, not by speed.

export const SPRING = {
    // Snappy micro-interactions: hovers, presses, toggles
    // ~180ms settle, slight overshoot. Buttons, chips, controls.
    snappy: "cubic-bezier(0.175, 0.885, 0.32, 1.1)",

    // Standard motion: panels, cards, tab switches
    // ~280ms settle, natural decel. The workhorse.
    standard: "cubic-bezier(0.16, 1, 0.3, 1)",

    // Gentle entrances: overlays, modals, page-level transitions
    // ~400ms settle, soft overshoot. Dramatic but not slow.
    gentle: "cubic-bezier(0.34, 1.56, 0.64, 1)",

    // Expressive: hero moments, shared-element transitions
    // ~500ms with visible overshoot. Celebratory.
    expressive: "cubic-bezier(0.175, 0.885, 0.32, 1.275)",
} as const

// --- Duration tokens ---
// Springs settle on their own, but CSS needs explicit durations.
// Paired with the spring easings above.

export const DURATION = {
    instant: "100ms",   // Opacity flips, color changes
    micro: "180ms",     // Hover states, press feedback
    fast: "280ms",      // Tab switches, chip toggles, small reveals
    medium: "400ms",    // Card entrances, panel slides, overlays
    slow: "550ms",      // Page transitions, hero moments
    count: "1200ms",    // Number count-up (stat reveal)
} as const

// --- Stagger tokens ---
// Cascade delays for list/grid entrances. Small enough to feel
// choreographed, not sluggish.

export const STAGGER = {
    tight: 30,    // ms between items in a dense grid (stat cards)
    normal: 50,   // ms between items in a standard list
    relaxed: 80,  // ms between major sections
} as const

// --- CSS custom properties (injected once at :root) ---
// Components use var(--m-*) so motion is centrally tunable.

export const MOTION_VARS = `
    --m-spring-snappy: ${SPRING.snappy};
    --m-spring-standard: ${SPRING.standard};
    --m-spring-gentle: ${SPRING.gentle};
    --m-spring-expressive: ${SPRING.expressive};
    --m-dur-instant: ${DURATION.instant};
    --m-dur-micro: ${DURATION.micro};
    --m-dur-fast: ${DURATION.fast};
    --m-dur-medium: ${DURATION.medium};
    --m-dur-slow: ${DURATION.slow};
    --m-dur-count: ${DURATION.count};
    --m-stagger-tight: ${STAGGER.tight}ms;
    --m-stagger-normal: ${STAGGER.normal}ms;
    --m-stagger-relaxed: ${STAGGER.relaxed}ms;
`
