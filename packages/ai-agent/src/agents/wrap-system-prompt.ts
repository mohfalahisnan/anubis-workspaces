export function wrapPromptWithSystem(
  userPrompt: string,
  system: string | undefined,
): string {
  if (!system || system.trim() === '') return userPrompt
  return `<format-spec>\n${system}\n</format-spec>\n\n<user-prompt>\n${userPrompt}\n</user-prompt>`
}
