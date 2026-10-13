import type { ComponentType } from 'react'
import type { FormName } from '../moment'
import { Field } from './Field'

/**
 * Each colour's universe. Home has none: it is the floating world you arrive in.
 * Every colour is a field — a space to look into rather than at — in its own mood.
 */
export const UNIVERSES: Partial<Record<FormName, ComponentType>> = {
  jagged: Field,
  eroded: Field,
  radiant: Field,
  grown: Field,
  glacial: Field,
  arcane: Field,
}
