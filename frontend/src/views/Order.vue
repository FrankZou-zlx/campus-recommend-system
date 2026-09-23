<template>
  <el-card>
    <template #header>
      <div style="display:flex;justify-content:space-between;align-items:center">
        <b>我的订单</b>
        <el-radio-group v-model="status" @change="load">
          <el-radio-button :value="''">全部</el-radio-button>
          <el-radio-button :value="0">待付款</el-radio-button>
          <el-radio-button :value="1">已付款</el-radio-button>
          <el-radio-button :value="2">已完成</el-radio-button>
          <el-radio-button :value="3">已取消</el-radio-button>
        </el-radio-group>
      </div>
    </template>
    <el-empty v-if="!list.length" description="暂无订单" />
    <el-card v-for="o in list" :key="o.id" shadow="never" style="margin-bottom:12px">
      <div class="head">
        <span>订单号：{{ o.order_no }}</span>
        <el-tag size="small" :type="statusType(o.status)">{{ statusText(o.status) }}</el-tag>
        <span class="time">{{ o.created_at }}</span>
      </div>
      <div v-for="it in o.items" :key="it.id" class="item">
        <span>{{ it.title }}</span>
        <span>¥{{ it.price }} × {{ it.quantity }}</span>
      </div>
      <div class="total">合计：¥{{ o.total }}</div>
      <div class="ops">
        <el-button v-if="o.status===0" size="small" type="primary" @click="setStatus(o,1)">付款</el-button>
        <el-button v-if="o.status===1" size="small" type="success" @click="setStatus(o,2)">确认收货</el-button>
        <el-button v-if="o.status===0" size="small" @click="setStatus(o,3)">取消</el-button>
      </div>
    </el-card>
  </el-card>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import http from '../api';

const list = ref([]);
const status = ref('');

function statusText(s) { return ['待付款','已付款','已完成','已取消'][s] || '未知'; }
function statusType(s) { return ['warning','success','info','info'][s]; }

async function load() {
  const res = await http.get('/order/list', { params: { status: status.value } });
  list.value = res.data || [];
}
async function setStatus(o, s) {
  await http.put('/order/status/' + o.id, { status: s });
  ElMessage.success('已更新'); load();
}
onMounted(load);
</script>

<style scoped>
.head { display: flex; align-items: center; gap: 12px; color: #606266; font-size: 14px; }
.time { color: #c0c4cc; }
.item { display: flex; justify-content: space-between; padding: 6px 0; color: #303133; }
.total { text-align: right; font-weight: 700; color: #f56c6c; margin-top: 6px; }
.ops { margin-top: 8px; }
</style>
