<template>
  <div>
    <el-header class="topbar">
      <div class="topbar-inner">
        <div class="logo" @click="go('/')">🎓 校园优选</div>
        <el-menu mode="horizontal" :ellipsis="false" :default-active="active" class="nav-menu" router>
          <el-menu-item index="/">首页</el-menu-item>
          <el-menu-item index="/publish">发布闲置</el-menu-item>
          <el-menu-item index="/cart">购物车</el-menu-item>
          <el-menu-item index="/order">我的订单</el-menu-item>
          <el-menu-item index="/message">私信</el-menu-item>
        </el-menu>
        <div class="right">
          <template v-if="user">
            <el-button text @click="go('/profile')">{{ user.nickname || user.username }}</el-button>
            <el-button text @click="logout">退出</el-button>
          </template>
          <template v-else>
            <el-button type="primary" @click="go('/login')">登录 / 注册</el-button>
          </template>
        </div>
      </div>
    </el-header>
    <div class="container">
      <router-view />
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';

const route = useRoute();
const router = useRouter();
const active = computed(() => route.path);
const user = computed(() => JSON.parse(localStorage.getItem('user') || 'null'));

function go(p) { router.push(p); }
function logout() {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  router.push('/login');
}
</script>

<style scoped>
.topbar { background: #fff; box-shadow: 0 2px 8px rgba(0,0,0,.06); position: sticky; top: 0; z-index: 100; }
.topbar-inner { max-width: 1180px; margin: 0 auto; display: flex; align-items: center; gap: 12px; height: 60px; }
.logo { font-size: 20px; font-weight: 800; cursor: pointer; white-space: nowrap; }
.nav-menu { flex: 1; border-bottom: none; }
.right { margin-left: auto; display: flex; align-items: center; gap: 8px; }
</style>
