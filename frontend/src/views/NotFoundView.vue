<template>
  <div class="catalog-page">
    <section class="dashboard-panel not-found" aria-labelledby="not-found-title">
      <h1 id="not-found-title">페이지를 찾을 수 없습니다</h1>
      <p>주소가 바뀌었거나 없는 화면입니다.</p>
      <RouterLink class="primary-button" to="/">대시보드로 이동</RouterLink>
    </section>
  </div>
</template>

<style scoped>
.not-found { display: grid; gap: 14px; max-width: 520px; justify-items: start; }
h1 { margin: 0; font-size: 22px; font-weight: 800; letter-spacing: -0.6px; }
p { margin: 0; color: var(--text-2); font-size: 14px; }
.primary-button { display: inline-flex; width: fit-content; }
</style>
