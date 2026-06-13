/**
 * @soccer-manager/design-system
 *
 * Engine-agnostic visual layer for the app: design tokens + global styles
 * (see ./styles.css) and pure presentational React primitives. Nothing here
 * may import from the game engine or store — these are reusable building
 * blocks that take plain props.
 */
export { ovrClass } from './primitives/ovrClass';
export { OvrBadge } from './primitives/OvrBadge';
export { PosBadge } from './primitives/PosBadge';
export { ConditionBar } from './primitives/ConditionBar';
export { FormDots } from './primitives/FormDots';
