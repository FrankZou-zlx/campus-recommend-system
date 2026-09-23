<template>
  <el-card v-loading="loading">
    <div v-if="p" class="detail">
      <div class="cover">
        <img v-if="p.cover" :src="p.cover" @error="erred = true" />
        <div v-else class="cover-fallback">{{ (p.title || '?').slice(0,2) }}</div>
      </div>
      <div class="info">
        <h2 style="margin:0 0 8px">{{ p.title }}</h2>
        <div class="price">¥{{ p.price }} <span class="stock">库存 {{ p.stock }}</span></div>
        <el-tag v-if="p.category_name" size="small">{{ p.category_name }}</el-tag>
        <p class="desc">{{ p.description }}</p>
        <div class="seller">卖家：{{ p.seller_name || '匿名' }}</div>
        <div class="actions">
          <el-button type="warning" @click="favorite" :disabled="!user">收藏</el-button>
          <el-button type="primary" @click="addCart" :disabled="!user">加入购物车</el-button>
          <el-button @click="contact" :disabled="!user || p.seller_id===uid">私信卖家</el-button>
        </div>
        <el-alert v-if="!user" title="请先登录后再操作" type="info" :closable="false" style="margin-top:12px" />
      </div>
    </div>
    <el-empty v-if="!loading && !p" description="商品不存在或已下架" />
  </el-card>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import http from '../api';

const route = useRoute();
const router = useRouter();
const p = ref(null);
const loading = ref(true);
const erred = ref(false);
const user = ref(JSON.parse(localStorage.getItem('user') || 'null'));
const uid = ref(user.value?.id || 0);

async function load() {
  loading.value = true;
  const res = await http.get('/product/detail/' + route.params.id);
  p.value = res.code === 0 ? res.data : null;
  loading.value = false;
}
async function favorite() {
  const res = await http.post('/product/favorite/' + route.params.id);
  ElMessage.success(res.msg || '已收藏');
}
async function addCart() {
  const res = await http.post('/cart/add', { product_id: route.params.id, quantity: 1 });
  if (res.code === 0) ElMessage.success('已加入购物车');
  else ElMessage.error(res.msg);
}
function contact() {
  router.push({ path: '/message', query: { to: p.value.seller_id } });
}
onMounted(load);
</script>

<style scoped>
.detail { display: flex; gap: 30px; }
.cover { width: 320px; height: 320px; background: #f0f0f0; border-radius: 10px; flex-shrink: 0; }
.cover img { width: 100%; height: 100%; object-fit: cover; border-radius: 10px; }
.info { flex: 1; }
.price { color: #f56c6c; font-size: 26px; font-weight: 700; margin: 10px 0; }
.stock { color: #999; font-size: 13px; font-weight: 400; margin-left: 10px; }
.desc { color: #606266; line-height: 1.7; }
.seller { color: #909399; margin: 12px 0; }
.actions { display: flex; gap: 10px; }
@media (max-width: 768px) { .detail { flex-direction: column; } .cover { width: 100%; height: 240px; } }
</style>
