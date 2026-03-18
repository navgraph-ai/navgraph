import type { MatchResult, ResolveResult, ApiResolver, NavResolver, Capability } from './types'

export interface ResolveOptions {
  baseUrl?:        string
  authToken?:      string
  fetch?:          typeof globalThis.fetch
  dryRun?:         boolean
  adminValidator?: (token: string) => Promise<boolean>
}

export async function resolve(
  matchResult: MatchResult,
  params:  Record<string, unknown> = {},
  options: ResolveOptions          = {}
): Promise<ResolveResult> {
  const { capability } = matchResult

  if (!capability) {
    return { success: false, resolverType: null, error: 'No capability matched — cannot resolve.', dryRun: options.dryRun ?? false }
  }

  const privacyError = await enforcePrivacy(capability, options)
  if (privacyError) return { success: false, resolverType: capability.resolver.type, error: privacyError, dryRun: options.dryRun ?? false }

  const mergedParams = { ...matchResult.extractedParams, ...params }
  const resolver     = capability.resolver

  try {
    switch (resolver.type) {
      case 'api':    return await resolveApi(resolver, mergedParams, options)
      case 'nav':    return resolveNav(resolver, mergedParams, options.dryRun ?? false)
      case 'hybrid': {
        const [apiResult, navResult] = await Promise.all([
          resolveApi(resolver.api as ApiResolver, mergedParams, options),
          Promise.resolve(resolveNav(resolver.nav as NavResolver, mergedParams, options.dryRun ?? false)),
        ])
        return { success: apiResult.success && navResult.success, resolverType: 'hybrid', apiCalls: apiResult.apiCalls, navTarget: navResult.navTarget, error: apiResult.error ?? navResult.error, dryRun: options.dryRun ?? false }
      }
    }
  } catch (err) {
    return { success: false, resolverType: resolver.type, error: err instanceof Error ? err.message : String(err), dryRun: options.dryRun ?? false }
  }
}

async function enforcePrivacy(cap: Capability, options: ResolveOptions): Promise<string | null> {
  if (cap.privacy.level === 'public') return null

  if (cap.privacy.level === 'user_owned' && !options.authToken)
    return `Capability "${cap.id}" requires authentication (user_owned). Provide authToken.`

  if (cap.privacy.level === 'admin') {
    if (!options.authToken)
      return `Capability "${cap.id}" requires an auth token.`
    if (options.adminValidator) {
      const isAdmin = await options.adminValidator(options.authToken)
      if (!isAdmin)
        return `Capability "${cap.id}" requires admin privileges.`
    }
    // Note: without adminValidator, only token presence is checked.
  }

  return null
}

async function resolveApi(
  resolver: ApiResolver | Omit<ApiResolver, 'type'>,
  params: Record<string, unknown>, options: ResolveOptions
): Promise<ResolveResult> {
  const apiCalls = resolver.endpoints.map(ep => ({
    method: ep.method,
    url:    buildUrl(options.baseUrl ?? '', ep.path, params),
    params,
  }))

  if (options.dryRun) return { success: true, resolverType: 'api', apiCalls, dryRun: true }

  const fetchFn = options.fetch ?? (typeof globalThis !== 'undefined' ? globalThis.fetch : undefined)
  if (!fetchFn) return { success: true, resolverType: 'api', apiCalls, error: 'No fetch available', dryRun: true }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (options.authToken) headers['Authorization'] = `Bearer ${options.authToken}`

const responses = await Promise.all(
  apiCalls.map(c => fetchFn(c.url, { method: c.method, headers }))
)

const failed = responses.find(r => !r.ok)
if (failed) {
  return {
    success:      false,
    resolverType: 'api',
    apiCalls,
    error:        `API call failed with status ${failed.status}: ${failed.statusText}`,
    dryRun:       false,
  }
}

return { success: true, resolverType: 'api', apiCalls, dryRun: false }
}

function resolveNav(
  resolver: NavResolver | Omit<NavResolver, 'type'>,
  params: Record<string, unknown>, dryRun: boolean
): ResolveResult {
  let destination = resolver.destination
  for (const [k, v] of Object.entries(params)) {
    destination = destination.replace(`{${k}}`, encodeURIComponent(String(v)))
  }
  return { success: true, resolverType: 'nav', navTarget: destination, dryRun }
}

function buildUrl(baseUrl: string, urlPath: string, params: Record<string, unknown>): string {
  let resolved = urlPath
  const unused: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined || String(v).startsWith('[from_')) continue
    if (resolved.includes(`{${k}}`)) resolved = resolved.replace(`{${k}}`, encodeURIComponent(String(v)))
    else unused[k] = v
  }
  const base = `${baseUrl.replace(/\/$/, '')}${resolved}`
  const qs   = Object.entries(unused).filter(([, v]) => v != null).map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&')
  return qs ? `${base}?${qs}` : base
}