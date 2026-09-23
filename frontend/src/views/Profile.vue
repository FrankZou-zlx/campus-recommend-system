<template>
  <el-card>
    <template #header><b>个人中心</b></template>
    <el-tabs>
      <el-tab-pane label="我的资料">
        <el-form :model="form" label-width="80px" style="max-width:480px">
          <el-form-item label="昵称"><el-input v-model="form.nickname" /></el-form-item>
          <el-form-item label="邮箱"><el-input v-model="form.email" /></el-form-item>
          <el-form-item label="手机"><el-input v-model="form.phone" /></el-form-item>
          <el-button type="primary" @click="save">保存</el-button>
        </el-form>
      </el-tab-pane>
      <el-tab-pane label="收货地址">
        <el-button type="primary" size="small" @click="showAddr = true">新增地址</el-button>
        <el-table :data="addrs" style="margin-top:12px">
          <el-table-column prop="name" label="收货人" />
          <el-table-column prop="phone" label="电话" />
          <el-table-column prop="detail" label="地址" />
          <el-table-column label="默认">
            <template #default="{row}"><el-tag v-if="row.is_default" type="success" size="small">默认</el-tag></template>
          </el-table-column>
          <el-table-column label="操作" width="120">
            <template #default="{row}">
              <el-button text type="danger" size="small" @click="delAddr(row)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>
      <el-tab-pane label="修改密码">
        <el-form :model="pwd" label-width="90px" style="max-width:420px">
          <el-form-item label="原密码"><el-input v-model="pwd.oldPwd" type="password" /></el-form-item>
          <el-form-item label="新密码"><el-input v-model="pwd.newPwd" type="password" /></el-form-item>
          <el-button type="primary" @click="changePwd">修改</el-button>
        </el-form>
      </el-tab-pane>
    </el-tabs>

    <el-dialog v-model="showAddr" title="新增收货地址" width="420px">
      <el-form :model="addrForm" label-width="70px">
        <el-form-item label="收货人"><el-input v-model="addrForm.name" /></el-form-item>
        <el-form-item label="电话"><el-input v-model="addrForm.phone" /></el-form-item>
        <el-form-item label="地址"><el-input v-model="addrForm.detail" /></el-form-item>
        <el-form-item label="设为默认"><el-switch v-model="addrForm.is_default" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showAddr=false">取消</el-button>
        <el-button type="primary" @click="addAddr">保存</el-button>
      </template>
    </el-dialog>
  </el-card>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import http from '../api';

const user = JSON.parse(localStorage.getItem('user') || '{}');
const form = ref({ nickname: '', email: '', phone: '' });
const pwd = ref({ oldPwd: '', newPwd: '' });
const addrs = ref([]);
const showAddr = ref(false);
const addrForm = ref({ name: '', phone: '', detail: '', is_default: false });

async function loadProfile() {
  const res = await http.get('/user/profile');
  if (res.code === 0) { form.value = res.data; }
}
async function loadAddrs() {
  const res = await http.get('/user/address');
  addrs.value = res.data || [];
}
async function save() { await http.put('/user/profile', form.value); ElMessage.success('已保存'); }
async function changePwd() {
  const res = await http.put('/user/password', pwd.value);
  if (res.code === 0) { ElMessage.success('密码已修改'); pwd.value = { oldPwd: '', newPwd: '' }; }
  else ElMessage.error(res.msg);
}
async function addAddr() {
  await http.post('/user/address', addrForm.value);
  showAddr.value = false; addrForm.value = { name: '', phone: '', detail: '', is_default: false };
  loadAddrs();
}
async function delAddr(row) { await http.delete('/user/address/' + row.id); loadAddrs(); }
onMounted(() => { loadProfile(); loadAddrs(); });
</script>
