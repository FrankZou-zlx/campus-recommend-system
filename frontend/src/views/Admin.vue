<template>
  <div>
    <!-- 管理员登录 -->
    <el-card v-if="!isAdmin" style="max-width:360px;margin:40px auto">
      <h2 style="text-align:center;margin-top:0">后台管理登录</h2>
      <el-input v-model="admin.username" placeholder="管理员账号" />
      <el-input v-model="admin.password" type="password" placeholder="密码" style="margin-top:12px" />
      <el-button type="primary" style="width:100%;margin-top:16px" @click="adminLogin">登录</el-button>
      <p style="text-align:center;color:#999;font-size:12px;margin-top:10px">默认：admin / admin123</p>
    </el-card>

    <!-- 仪表盘 -->
    <template v-else>
      <el-row :gutter="16">
        <el-col :span="4" v-for="s in statCards" :key="s.label">
          <el-card shadow="hover" style="text-align:center">
            <div style="font-size:24px;font-weight:700;color:#5b8def">{{ s.value }}</div>
            <div style="color:#909399;font-size:13px">{{ s.label }}</div>
          </el-card>
        </el-col>
      </el-row>

      <el-card style="margin-top:16px">
        <el-tabs>
          <el-tab-pane label="用户管理">
            <el-table :data="users" size="small">
              <el-table-column prop="id" label="ID" width="60" />
              <el-table-column prop="username" label="账号" />
              <el-table-column prop="nickname" label="昵称" />
              <el-table-column prop="email" label="邮箱" />
              <el-table-column label="角色" width="100">
                <template #default="{row}">
                  <el-select :model-value="row.role" @change="v => setRole(row,v)" size="small" style="width:80px">
                    <el-option :value="0" label="用户" />
                    <el-option :value="1" label="卖家" />
                  </el-select>
                </template>
              </el-table-column>
            </el-table>
          </el-tab-pane>

          <el-tab-pane label="商品管理">
            <el-table :data="products" size="small">
              <el-table-column prop="id" label="ID" width="60" />
              <el-table-column prop="title" label="标题" />
              <el-table-column prop="price" label="价格" width="90" />
              <el-table-column label="状态" width="110">
                <template #default="{row}">
                  <el-switch :model-value="row.status===1" @change="v => setProductStatus(row, v)" />
                  <span style="margin-left:4px">{{ row.status===1?'在售':'下架' }}</span>
                </template>
              </el-table-column>
            </el-table>
          </el-tab-pane>

          <el-tab-pane label="公告发布">
            <el-input v-model="notice.title" placeholder="公告标题" style="max-width:400px" />
            <el-input v-model="notice.content" type="textarea" :rows="3" placeholder="公告内容" style="max-width:400px;margin-top:10px" />
            <el-button type="primary" style="margin-top:10px" @click="addNotice">发布</el-button>
          </el-tab-pane>

          <el-tab-pane label="行为数据(推荐)">
            <el-alert type="info" :closable="false" title="下表为协同过滤算法的输入：用户对各商品的行为与权重（view=1/favorite=3/cart=4/buy=5）" style="margin-bottom:10px" />
            <el-table :data="interactions" size="small" height="400">
              <el-table-column prop="nickname" label="用户" width="100" />
              <el-table-column prop="title" label="商品" />
              <el-table-column prop="type" label="行为" width="100" />
              <el-table-column prop="score" label="权重" width="80" />
              <el-table-column prop="created_at" label="时间" />
            </el-table>
          </el-tab-pane>
        </el-tabs>
      </el-card>
    </template>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import http from '../api';

const user = JSON.parse(localStorage.getItem('user') || 'null');
const isAdmin = computed(() => user && user.role === 'admin');
const admin = ref({ username: 'admin', password: 'admin123' });

const statCards = ref([]);
const users = ref([]);
const products = ref([]);
const interactions = ref([]);
const notice = ref({ title: '', content: '' });

async function adminLogin() {
  const res = await http.post('/auth/admin/login', admin.value);
  if (res.code === 0) {
    localStorage.setItem('token', res.data.token);
    localStorage.setItem('user', JSON.stringify({ role: 'admin', username: admin.value.username }));
    location.reload();
  } else ElMessage.error(res.msg);
}
async function loadStats() {
  const r = await http.get('/admin/stats');
  const d = r.data || {};
  statCards.value = [
    { label: '用户数', value: d.users }, { label: '商品数', value: d.products },
    { label: '订单数', value: d.orders }, { label: '成交额', value: '¥' + d.revenue },
    { label: '私信数', value: d.messages }, { label: '行为数', value: (await http.get('/admin/interactions')).data.length }
  ];
}
async function loadUsers() { const r = await http.get('/admin/users'); users.value = r.data || []; }
async function loadProducts() { const r = await http.get('/admin/products'); products.value = r.data || []; }
async function loadInteractions() { const r = await http.get('/admin/interactions'); interactions.value = r.data || []; }
async function setRole(row, v) { await http.put('/admin/user/' + row.id + '/role', { role: v }); ElMessage.success('已更新'); }
async function setProductStatus(row, v) { await http.put('/admin/product/' + row.id + '/status', { status: v ? 1 : 0 }); ElMessage.success('已更新'); loadProducts(); }
async function addNotice() { await http.post('/admin/notice', notice.value); ElMessage.success('已发布'); notice.value = { title: '', content: '' }; }

onMounted(() => {
  if (isAdmin.value) { loadStats(); loadUsers(); loadProducts(); loadInteractions(); }
});
</script>
