<template>
  <div class="login-wrap">
    <el-card class="box">
      <h2 style="text-align:center;margin-top:0">🎓 校园优选</h2>
      <el-tabs v-model="tab">
        <el-tab-pane label="登录" name="login">
          <el-form :model="loginForm" label-width="0">
            <el-input v-model="loginForm.username" placeholder="账号" :prefix-icon="User" />
            <el-input v-model="loginForm.password" type="password" placeholder="密码" :prefix-icon="Lock" style="margin-top:12px" />
            <el-button type="primary" style="width:100%;margin-top:18px" @click="doLogin">登录</el-button>
          </el-form>
        </el-tab-pane>
        <el-tab-pane label="注册" name="register">
          <el-form :model="regForm" label-width="0">
            <el-input v-model="regForm.username" placeholder="设置账号" :prefix-icon="User" />
            <el-input v-model="regForm.nickname" placeholder="昵称（可选）" :prefix-icon="Avatar" style="margin-top:12px" />
            <el-input v-model="regForm.password" type="password" placeholder="设置密码" :prefix-icon="Lock" style="margin-top:12px" />
            <el-button type="primary" style="width:100%;margin-top:18px" @click="doRegister">注册</el-button>
          </el-form>
        </el-tab-pane>
      </el-tabs>
      <p class="tip">演示账号：user001 / 123456 ｜ 后台：admin / admin123</p>
    </el-card>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { User, Lock, Avatar } from '@element-plus/icons-vue';
import http from '../api';

const router = useRouter();
const tab = ref('login');
const loginForm = ref({ username: '', password: '' });
const regForm = ref({ username: '', nickname: '', password: '' });

async function doLogin() {
  const res = await http.post('/auth/login', loginForm.value);
  if (res.code === 0) {
    localStorage.setItem('token', res.data.token);
    localStorage.setItem('user', JSON.stringify(res.data.user));
    router.push('/');
  } else ElMessage.error(res.msg);
}
async function doRegister() {
  const res = await http.post('/auth/register', regForm.value);
  if (res.code === 0) { ElMessage.success('注册成功，请登录'); tab.value = 'login'; }
  else ElMessage.error(res.msg);
}
</script>

<style scoped>
.login-wrap { display: flex; justify-content: center; padding-top: 60px; }
.box { width: 360px; }
.tip { font-size: 12px; color: #999; text-align: center; margin: 10px 0 0; }
</style>
