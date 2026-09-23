<template>
  <div>
    <!-- 猜你喜欢（协同过滤推荐位） -->
    <el-card class="rec-card" v-if="user">
      <template #header>
        <div class="rec-head">
          <span>✨ 猜你喜欢</span>
          <span class="rec-sub">基于协同过滤算法 · 根据你的浏览/收藏/购买习惯推荐</span>
        </div>
      </template>
      <div v-loading="recLoading" class="grid">
        <ProductCard v-for="p in recommends" :key="'r'+p.id" :product="p" @open="open" />
      </div>
    </el-card>

    <!-- 筛选 + 列表 -->
    <el-card>
      <div class="filter-bar">
        <el-input v-model="kw" placeholder="搜索商品" clearable style="width:220px" @keyup.enter="load" />
        <el-select v-model="cat" placeholder="全部分类" clearable style="width:160px" @change="load">
          <el-option v-for="c in cats" :key="c.id" :label="c.name" :value="c.id" />
        </el-select>
        <el-button type="primary" @click="load">查询</el-button>
      </div>
      <div v-loading="loading" class="grid" style="margin-top:14px">
        <ProductCard v-for="p in list" :key="p.id" :product="p" @open="open" />
        <el-empty v-if="!loading && !list.length" description="暂无商品" />
      </div>
      <el-pagination v-if="total > size" layout="prev, pager, next" :total="total" :page-size="size"
        @current-change="page => { cur = page; load(); }" style="justify-content:center;margin-top:14px" />
    </el-card>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import ProductCard from '../components/ProductCard.vue';
import http from '../api';

const router = useRouter();
const user = ref(JSON.parse(localStorage.getItem('user') || 'null'));

const cats = ref([]);
const cat = ref('');
const kw = ref('');
const list = ref([]);
const loading = ref(false);
const total = ref(0);
const size = 12;
const cur = ref(1);

const recommends = ref([]);
const recLoading = ref(false);

function open(id) { router.push('/product/' + id); }

async function loadCats() {
  const res = await http.get('/category/list');
  cats.value = res.data || [];
}
async function load() {
  loading.value = true;
  const res = await http.get('/product/list', { params: { category_id: cat.value, keyword: kw.value, page: cur.value, size } });
  list.value = res.data.list;
  total.value = res.data.total;
  loading.value = false;
}
async function loadRecommend() {
  if (!user.value) return;
  recLoading.value = true;
  const res = await http.get('/recommend/for-you', { params: { limit: 8 } });
  recommends.value = res.data || [];
  recLoading.value = false;
}

onMounted(() => { loadCats(); load(); loadRecommend(); });
</script>

<style scoped>
.rec-card { margin-bottom: 16px; border: 1px solid #f3d9ec; }
.rec-head { display: flex; align-items: baseline; gap: 10px; font-weight: 700; font-size: 16px; }
.rec-sub { font-size: 12px; color: #eb2f96; font-weight: 400; }
.grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; }
.filter-bar { display: flex; gap: 10px; flex-wrap: wrap; }
@media (max-width: 768px) { .grid { grid-template-columns: repeat(2, 1fr); } }
</style>
