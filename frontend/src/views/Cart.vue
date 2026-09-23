<template>
  <el-card>
    <template #header><b>我的购物车</b></template>
    <div v-loading="loading">
      <el-empty v-if="!list.length" description="购物车是空的" />
      <div v-for="it in list" :key="it.id" class="row">
        <el-checkbox v-model="it.checked" />
        <img v-if="it.cover" :src="it.cover" class="thumb" />
        <div v-else class="thumb cover-fallback">{{ (it.title||'?').slice(0,2) }}</div>
        <div class="name">{{ it.title }}</div>
        <div class="price">¥{{ it.price }}</div>
        <el-input-number v-model="it.quantity" :min="1" :max="it.stock" size="small" @change="updateQty(it)" />
        <el-button text type="danger" @click="remove(it)">删除</el-button>
      </div>
      <div v-if="list.length" class="foot">
        <span>已选 {{ selected.length }} 件，合计 <b class="total">¥{{ totalPrice }}</b></span>
        <el-button type="primary" @click="checkout" :disabled="!selected.length">去结算</el-button>
      </div>
    </div>
  </el-card>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import http from '../api';

const list = ref([]);
const loading = ref(false);
const selected = computed(() => list.value.filter(i => i.checked));
const totalPrice = computed(() => selected.value.reduce((s, i) => s + Number(i.price) * i.quantity, 0).toFixed(2));

async function load() {
  loading.value = true;
  const res = await http.get('/cart/list');
  list.value = (res.data || []).map(i => ({ ...i, checked: true }));
  loading.value = false;
}
async function updateQty(it) { await http.put('/cart/update/' + it.id, { quantity: it.quantity }); }
async function remove(it) {
  await http.delete('/cart/' + it.id);
  ElMessage.success('已删除'); load();
}
async function checkout() {
  const items = selected.value.map(i => ({ product_id: i.product_id, quantity: i.quantity }));
  const res = await http.post('/order/create', { items });
  if (res.code === 0) { ElMessage.success('下单成功'); load(); }
  else ElMessage.error(res.msg);
}
onMounted(load);
</script>

<style scoped>
.row { display: flex; align-items: center; gap: 12px; padding: 12px 0; border-bottom: 1px solid #f5f5f5; }
.thumb { width: 60px; height: 60px; object-fit: cover; border-radius: 6px; flex-shrink: 0; }
.name { flex: 1; }
.price { color: #f56c6c; font-weight: 700; width: 80px; }
.foot { display: flex; justify-content: space-between; align-items: center; margin-top: 16px; }
.total { color: #f56c6c; font-size: 18px; }
</style>
