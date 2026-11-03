import { computed, ref } from 'vue'

// 관리자 토큰은 메모리에만 보관합니다. 새로고침하면 다시 로그인해야 합니다.
const token = ref('')

// 로그인하지 않았다면 login(username, password)으로 로그인해 토큰을 보관하고, 이미 있으면 그대로 돌려줍니다.
export async function ensureAdminToken(login, username, password) {
  if (token.value) return token.value
  const issued = await login(username, password)
  token.value = issued
  return issued
}

export function useAdminSession() {
  return {
    token,
    isLoggedIn: computed(() => token.value !== ''),
    signIn(value) { token.value = value },
    signOut() { token.value = '' },
  }
}
