import { ZodError } from 'zod'

export function apiErrorMessage(error: unknown): string {
  if (error instanceof ZodError)
    return error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('\n')
  return error instanceof Error ? error.message : String(error)
}
