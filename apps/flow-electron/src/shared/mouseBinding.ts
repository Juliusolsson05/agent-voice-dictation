export const MOUSE_BUTTONS = [
  { value: 'MOUSE_MIDDLE', label: 'Middle mouse button' },
  { value: 'MOUSE_4', label: 'Mouse button 4 (Back)' },
  { value: 'MOUSE_5', label: 'Mouse button 5 (Forward)' },
] as const
export const MOUSE_MODIFIERS = ['Cmd', 'Ctrl', 'Option', 'Shift'] as const

// Store native vocabulary, never DOM button numbers (middle is DOM 1 but CG 2).
// Normal clicks are deliberately excluded: globally consuming left/right clicks
// would make the app difficult to configure or recover from.
export function normalizeMouseBinding(value: unknown): string | null {
  if (value == null || value === '') return null
  if (typeof value !== 'string') throw new Error('Invalid mouse shortcut.')
  const parts = value.split('+')
  const button = parts.pop()
  if (!MOUSE_BUTTONS.some(item => item.value === button)
    || new Set(parts).size !== parts.length
    || parts.some(part => !MOUSE_MODIFIERS.some(mod => mod === part))) {
    throw new Error('Choose a supported mouse button and optional modifiers.')
  }
  return [...MOUSE_MODIFIERS.filter(mod => parts.includes(mod)), button].join('+')
}

export function displayMouseBinding(value: string): string {
  return value.replace('MOUSE_MIDDLE', 'Middle click').replace('MOUSE_4', 'Mouse 4')
    .replace('MOUSE_5', 'Mouse 5').replaceAll('+', ' + ')
}
