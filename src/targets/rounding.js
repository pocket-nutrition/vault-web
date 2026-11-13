// SPDX-License-Identifier: AGPL-3.0-or-later
// Ported from the sandbox's src/lib/rounding.ts (MPL-2.0). Keep the two in step.

/**
 * The one rounding rule this platform uses: a tie always goes to the larger value
 * (`roundHalfUp(12.5) === 13`, `roundHalfUp(-0.5) === 0`). The `rounding` vector suite pins it.
 * @param {number} value
 * @returns {number}
 */
export function roundHalfUp(value) {
  return Math.floor(value + 0.5);
}
