import axios from 'axios'
import { useAppStore } from '@/store/useAppStore'

const BASE = '/api'
export const REFRESH_STORAGE_KEY = 'clarity_refresh_token'

export const api = axios.create({
  baseURL: BASE,
  headers: { 'Content-Type': 'application/json' },
  timeout: 60_000,
})

// ── Request interceptor: attach Bearer token from Zustand store ───────────────
api.interceptors.request.use((config) => {
  const token: string | undefined = useAppStore.getState().user?.token
  if (token) {
    config.headers = config.headers ?? {}
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// ── Response interceptor: silent token refresh on 401 ────────────────────────
let _refreshing = false
const _queue: Array<(token: string) => void> = []

api.interceptors.response.use(
  (res) => res,
  async (err) => {
    const original = err.config

    if (err?.response?.status === 401 && !original._retry) {
      original._retry = true

      if (_refreshing) {
        // Queue this request until the in-flight refresh completes
        return new Promise((resolve) => {
          _queue.push((token: string) => {
            original.headers = original.headers ?? {}
            original.headers.Authorization = `Bearer ${token}`
            resolve(api(original))
          })
        })
      }

      _refreshing = true
      const refreshToken = localStorage.getItem(REFRESH_STORAGE_KEY)

      if (!refreshToken) {
        _refreshing = false
        useAppStore.getState().logout()
        window.location.href = '/login'
        return Promise.reject(err)
      }

      try {
        const { data } = await axios.post(`${BASE}/auth/refresh`, {
          refresh_token: refreshToken,
        })
        const store = useAppStore.getState()
        store.login({
          id:       data.user_id,
          username: data.username,
          role:     data.role,
          token:    data.access_token,
        })
        localStorage.setItem(REFRESH_STORAGE_KEY, data.refresh_token)
        original.headers = original.headers ?? {}
        original.headers.Authorization = `Bearer ${data.access_token}`
        _queue.forEach((cb) => cb(data.access_token))
        _queue.length = 0
        return api(original)
      } catch {
        useAppStore.getState().logout()
        localStorage.removeItem(REFRESH_STORAGE_KEY)
        window.location.href = '/login'
        return Promise.reject(err)
      } finally {
        _refreshing = false
      }
    }

    const msg =
      err?.response?.data?.detail ||
      err?.response?.data?.message ||
      err?.message ||
      'An unexpected error occurred'
    return Promise.reject(new Error(typeof msg === 'string' ? msg : JSON.stringify(msg)))
  },
)
