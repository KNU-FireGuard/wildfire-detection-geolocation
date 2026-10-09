import { ref } from 'vue'
import { login, getMe } from './api/workflow.js'
export const accessToken = ref('')
export const admin = ref(null)
let expiry
export function logout() { clearTimeout(expiry); accessToken.value = ''; admin.value = null }
export async function signIn(username, password) {
  const result = await login(username, password)
  if (typeof result?.access_token !== 'string' || !result.access_token || result.token_type !== 'Bearer' || !Number.isFinite(result.expires_in) || result.expires_in <= 0 || result.expires_in * 1000 > 2147483647) throw new Error('로그인 API 응답 형식이 올바르지 않습니다.')
  const user = await getMe(result.access_token)
  if (!Number.isInteger(user?.id) || user.id <= 0 || typeof user.username !== 'string' || !user.username) throw new Error('관리자 API 응답 형식이 올바르지 않습니다.')
  logout()
  accessToken.value = result.access_token
  admin.value = user
  expiry = setTimeout(logout, result.expires_in * 1000)
}
