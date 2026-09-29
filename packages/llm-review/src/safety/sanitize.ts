/**
 * Sanitize repository content before embedding in LLM prompts.
 * Prevents prompt injection via closing XML delimiters, null bytes, and control characters.
 */
export function sanitizeRepoContent(content: string): string {
  return (
    content
      // Escape closing data tag to prevent XML injection
      .replace(/<\/data>/g, '<\\/data>')
      // Strip null bytes
      .replace(/\0/g, '')
      // Strip control characters except tab (\x09) and newline (\x0a)
      .replace(/[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
      // Cap individual lines at 4096 characters
      .split('\n')
      .map((line) => (line.length > 4096 ? line.slice(0, 4096) : line))
      .join('\n')
  );
}
