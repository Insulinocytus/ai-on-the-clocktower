interface ApiErrorBody {
  message?: string
  data?: { issues?: { path: (string | number)[]; message: string }[] }
}

/** Human-readable text for a failed `$fetch` to our API, listing validation issues when present. */
export function apiErrorMessage(error: unknown): string {
  const body = (error as { data?: ApiErrorBody } | null)?.data
  const issues = body?.data?.issues
  if (issues?.length) return issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n')
  return body?.message ?? String(error)
}
