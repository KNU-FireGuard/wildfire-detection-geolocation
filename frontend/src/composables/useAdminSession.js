import { computed, ref } from 'vue'

// 관리자 토큰은 메모리에만 보관합니다. 새로고침하면 다시 로그인해야 합니다.
const token = ref('')

export function useAdminSession() {
  return {
    token,
    isLoggedIn: computed(() => token.value !== ''),
    signIn(value) { token.value = value },
    signOut() { token.value = '' },
  }
}
